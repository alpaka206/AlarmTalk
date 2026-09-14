import Foundation
import XCTest
@testable import AlarmTalk

@MainActor
final class RemoteAlarmPushCommitTests: XCTestCase {
    override func setUp() {
        super.setUp()
        SessionExpiryStore.clear()
        PendingSignOutStore.removeAll()
    }

    override func tearDown() {
        SessionExpiryStore.clear()
        PendingSignOutStore.removeAll()
        super.tearDown()
    }

    func test_onlyActiveOwnersRowsAreSentAndEligibleLegacyRowsAreClaimed() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("owner-push-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        for (id, owner, remote, hour) in [
            ("a-local", "A", nil as String?, 8), ("a-remote", "A", "remote-a", 9),
            ("b-local", "B", nil, 10), ("legacy", "", nil, 11)
        ] {
            var row = LocalAlarmRecord(id: id, label: id, hour: hour, minute: 0, fireAtMillis: 1)
            row.ownerUserId = owner.nilIfBlank
            row.remoteAlarmId = remote
            row.syncState = (remote == nil ? AlarmSyncState.localOnly : .dirty).rawValue
            store.upsert(row)
        }
        let before = store.alarms.filter { $0.ownerUserId == "A" }
        let writer = HeldAlarmWriter()
        let auth = AuthViewModel()
        auth._setSessionForTesting(AuthSession(token: "token-B", user: AuthUser(id: "B", email: "b@example.test")))
        let result = try await RemoteAlarmPushSync(api: writer, store: store, auth: auth).runOnce()
        XCTAssertEqual(result, .init(attempted: 2, created: 2, updated: 0, failed: 0))
        XCTAssertEqual(writer.writes.map(\.body.time), ["10:00", "11:00"])
        XCTAssertEqual(writer.writes.map(\.token), ["token-B", "token-B"])
        XCTAssertEqual(store.alarms.filter { $0.ownerUserId == "A" }, before)
        let disk = try JSONDecoder().decode([LocalAlarmRecord].self, from: Data(contentsOf: url))
        XCTAssertEqual(disk.first(where: { $0.id == "legacy" })?.ownerUserId, "B")
    }

    func test_pendingPreviousOwnerPreventsLegacyAdoptionUntilSettled() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("legacy-owner-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        let original = store.upsert(LocalAlarmRecord(id: "legacy", label: "old", hour: 8, minute: 0, fireAtMillis: 1))
        let writer = HeldAlarmWriter()
        let auth = AuthViewModel()
        auth._setSessionForTesting(AuthSession(token: "token-B", user: AuthUser(id: "B", email: "b@example.test")))
        let push = RemoteAlarmPushSync(api: writer, store: store, auth: auth)
        SessionExpiryStore.markSessionExpired(userId: "A")
        let expiredResult = try await push.runOnce()
        XCTAssertEqual(expiredResult.attempted, 0)
        SessionExpiryStore.clear()
        PendingSignOutStore.mark("A")
        let pendingResult = try await push.runOnce()
        XCTAssertEqual(pendingResult.attempted, 0)
        XCTAssertTrue(writer.writes.isEmpty)
        XCTAssertEqual(store.record(id: original.id), original)
        store.claimUnownedAlarms(for: "A")
        PendingSignOutStore.clear("A")
        let settledResult = try await push.runOnce()
        XCTAssertEqual(settledResult.attempted, 0, "소유자를 확정한 뒤에도 A의 행은 B에게 전송하지 않는다")
    }

    func test_ownerIsRecheckedForLaterCandidatesAfterAwait() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("owner-change-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        for id in ["first", "second"] {
            var row = LocalAlarmRecord(id: id, label: id, hour: 8, minute: 0, fireAtMillis: 1)
            row.ownerUserId = "B"
            store.upsert(row)
        }
        let first = expectation(description: "첫 행 전송 대기")
        let writer = HeldAlarmWriter(firstRequest: first)
        let auth = AuthViewModel()
        auth._setSessionForTesting(AuthSession(token: "token-B", user: AuthUser(id: "B", email: "b@example.test")))
        let push = RemoteAlarmPushSync(api: writer, store: store, auth: auth)
        let active = Task { @MainActor in try await push.runOnce() }
        await fulfillment(of: [first], timeout: 2)
        var second = try XCTUnwrap(store.record(id: "second"))
        second.ownerUserId = "A"
        store.upsert(second)
        writer.completeFirstWrite()
        let result = try await active.value
        XCTAssertEqual(result.attempted, 1)
        XCTAssertEqual(writer.writes.count, 1)
        XCTAssertNil(store.record(id: "second")?.remoteAlarmId)
    }

    func test_createKeepsConcurrentEditDirtyAndNextPassPatchesTheReturnedID() async throws {
        try await assertPushCommit(existingRemoteID: nil, editDuringWrite: true, cancelAfterWrite: false)
    }

    func test_updateKeepsConcurrentEditDirtyUntilNextPassSendsIt() async throws {
        try await assertPushCommit(existingRemoteID: "remote", editDuringWrite: true, cancelAfterWrite: false)
    }

    func test_cancelledSuccessfulCreatePersistsIDBeforeStoppingThePass() async throws {
        try await assertPushCommit(existingRemoteID: nil, editDuringWrite: false, cancelAfterWrite: true)
    }

    func test_cancelledSuccessfulCreateAlsoPersistsConcurrentEditForTheNextPatch() async throws {
        try await assertPushCommit(existingRemoteID: nil, editDuringWrite: true, cancelAfterWrite: true)
    }

    private func assertPushCommit(
        existingRemoteID: String?, editDuringWrite: Bool, cancelAfterWrite: Bool
    ) async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("push-commit-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        var row = LocalAlarmRecord(id: "local", label: "alarm", hour: 8, minute: 0, fireAtMillis: 1)
        row.ownerUserId = "owner"
        row.remoteAlarmId = existingRemoteID
        row.syncState = (existingRemoteID == nil ? AlarmSyncState.localOnly : .dirty).rawValue
        let sent = store.upsert(row)
        // 취소된 회차가 성공 응답을 기록한 뒤 나머지 후보까지 전송하지 않는지도 확인한다.
        if cancelAfterWrite {
            var following = LocalAlarmRecord(id: "following", label: "next", hour: 10, minute: 0, fireAtMillis: 2)
            following.ownerUserId = "owner"
            store.upsert(following)
        }
        let firstRequest = expectation(description: "서버 쓰기 응답 대기")
        let writer = HeldAlarmWriter(firstRequest: firstRequest)
        let auth = AuthViewModel()
        auth._setSessionForTesting(AuthSession(token: "test-token", user: AuthUser(id: "owner", email: "owner@example.test")))
        let push = RemoteAlarmPushSync(api: writer, store: store, auth: auth)
        let active = Task { @MainActor in try await push.runOnce() }
        await fulfillment(of: [firstRequest], timeout: 2)
        XCTAssertEqual(writer.writes.first?.body.time, "08:00")
        var edited = sent
        if editDuringWrite {
            edited.hour = 9
            edited = store.upsertPreservingServerSyncFields(edited)
        }
        // 전송 경계가 성공 응답을 돌려주는 순간의 취소를 재현한다. 모의 응답은 취소를
        // 던지지 않아 runCycle의 응답 커밋과 취소 확인 순서를 직접 검증할 수 있다.
        if cancelAfterWrite { active.cancel() }
        writer.completeFirstWrite()
        switch await active.result {
        case .success(let result):
            XCTAssertFalse(cancelAfterWrite)
            XCTAssertEqual(result.failed, 0)
        case .failure(let error):
            XCTAssertTrue(cancelAfterWrite)
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertEqual(writer.writes.count, 1)
        let committed = try XCTUnwrap(store.record(id: row.id))
        XCTAssertEqual(committed.remoteAlarmId, "remote")
        XCTAssertEqual(committed.hour, editDuringWrite ? 9 : 8)
        XCTAssertEqual(committed.updatedAtMillis, edited.updatedAtMillis)
        XCTAssertEqual(committed.syncStateEnum, editDuringWrite ? .dirty : .synced)
        // saveNow 없이 비동기 persist만 예약한 구현은 여기서 성공을 보장할 수 없다.
        let disk = try JSONDecoder().decode([LocalAlarmRecord].self, from: Data(contentsOf: url))
        XCTAssertEqual(disk.first(where: { $0.id == row.id }), committed)
        if cancelAfterWrite {
            XCTAssertNil(store.record(id: "following")?.remoteAlarmId)
            store.deferServerSync(id: "following")
        }
        let result = try await push.runOnce()
        XCTAssertEqual(result.created, 0, "기록한 생성 응답은 다음 회차에서 POST하지 않는다")
        XCTAssertEqual(result.updated, editDuringWrite ? 1 : 0)
        if editDuringWrite {
            XCTAssertEqual(writer.writes.last?.remoteID, "remote")
            XCTAssertEqual(writer.writes.last?.body.time, "09:00")
        }
        XCTAssertEqual(store.record(id: row.id)?.syncStateEnum, .synced)
    }

    func test_sameMillisecondEditIsNotMistakenForTheSentSnapshot() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("push-same-time-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        let sent = store.upsert(LocalAlarmRecord(id: "local", label: "alarm", hour: 8, minute: 0, fireAtMillis: 1))
        store.setEnabled(id: sent.id, enabled: false, nowMillis: sent.updatedAtMillis)
        XCTAssertTrue(store.markRemote(snapshot: sent, remoteID: "remote", lastSyncedAtMillis: 100))
        let committed = try XCTUnwrap(store.record(id: sent.id))
        XCTAssertFalse(committed.enabled)
        XCTAssertEqual(committed.updatedAtMillis, sent.updatedAtMillis)
        XCTAssertEqual(committed.syncStateEnum, .dirty)
    }

    func test_diskFailureIsNotReportedAsSuccessfulSyncAndRetainsIDForRetry() async throws {
        let missingDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("absent-\(UUID())")
        let store = LocalAlarmStore(storageURL: missingDirectory.appendingPathComponent("alarms.json"), loadFromDisk: false)
        var row = LocalAlarmRecord(id: "local", label: "alarm", hour: 8, minute: 0, fireAtMillis: 1)
        row.ownerUserId = "owner"
        store.upsert(row)
        let firstRequest = expectation(description: "생성 응답 대기")
        let writer = HeldAlarmWriter(firstRequest: firstRequest)
        let auth = AuthViewModel()
        auth._setSessionForTesting(AuthSession(token: "test-token", user: AuthUser(id: "owner", email: "owner@example.test")))
        let push = RemoteAlarmPushSync(api: writer, store: store, auth: auth)
        let active = Task { @MainActor in try await push.runOnce() }
        await fulfillment(of: [firstRequest], timeout: 2)
        writer.completeFirstWrite()
        let result = try await active.value
        XCTAssertEqual(result, .init(attempted: 1, created: 0, updated: 0, failed: 1))
        XCTAssertEqual(store.record(id: "local")?.remoteAlarmId, "remote")
        XCTAssertEqual(store.record(id: "local")?.syncStateEnum, .syncFailed)
        XCTAssertFalse(FileManager.default.fileExists(atPath: missingDirectory.path))
    }
}

@MainActor
private final class HeldAlarmWriter: RemoteAlarmWriting {
    struct Write {
        var remoteID: String?
        var body: RemoteAlarmWriteRequest
        var token: String
    }
    private let firstRequest: XCTestExpectation?
    private var continuation: CheckedContinuation<RemoteAlarm, Never>?
    private(set) var writes: [Write] = []

    init(firstRequest: XCTestExpectation? = nil) { self.firstRequest = firstRequest }

    func createAlarm(_ body: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm {
        await write(remoteID: nil, body: body, token: token)
    }

    func updateAlarm(id: String, requestBody: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm {
        await write(remoteID: id, body: requestBody, token: token)
    }

    private func write(remoteID: String?, body: RemoteAlarmWriteRequest, token: String) async -> RemoteAlarm {
        writes.append(Write(remoteID: remoteID, body: body, token: token))
        if writes.count == 1, let firstRequest {
            return await withCheckedContinuation {
                continuation = $0
                firstRequest.fulfill()
            }
        }
        return RemoteAlarm(id: remoteID ?? (writes.count == 1 ? "remote" : "remote-\(writes.count)"))
    }

    func completeFirstWrite() {
        continuation?.resume(returning: RemoteAlarm(id: "remote"))
        continuation = nil
    }
}
