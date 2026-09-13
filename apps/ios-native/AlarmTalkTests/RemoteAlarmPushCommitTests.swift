import Foundation
import XCTest
@testable import AlarmTalk

@MainActor
final class RemoteAlarmPushCommitTests: XCTestCase {
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
        store.upsert(LocalAlarmRecord(id: "local", label: "alarm", hour: 8, minute: 0, fireAtMillis: 1))
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
    }
    private let firstRequest: XCTestExpectation
    private var continuation: CheckedContinuation<RemoteAlarm, Never>?
    private(set) var writes: [Write] = []

    init(firstRequest: XCTestExpectation) { self.firstRequest = firstRequest }

    func createAlarm(_ body: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm {
        await write(remoteID: nil, body: body)
    }

    func updateAlarm(id: String, requestBody: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm {
        await write(remoteID: id, body: requestBody)
    }

    private func write(remoteID: String?, body: RemoteAlarmWriteRequest) async -> RemoteAlarm {
        writes.append(Write(remoteID: remoteID, body: body))
        if writes.count == 1 {
            return await withCheckedContinuation {
                continuation = $0
                firstRequest.fulfill()
            }
        }
        return RemoteAlarm(id: "remote")
    }

    func completeFirstWrite() {
        continuation?.resume(returning: RemoteAlarm(id: "remote"))
        continuation = nil
    }
}
