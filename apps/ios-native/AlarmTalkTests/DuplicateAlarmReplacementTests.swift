import XCTest
import Combine
@testable import AlarmTalk

@MainActor
final class DuplicateAlarmReplacementTests: XCTestCase {
    func test_remoteFailurePreservesFailedAndRemainingLocalAlarms() async {
        var events: [String] = []
        let succeeded = await removeReplacementConflicts(["first", "failed", "remaining"], deleteRemote: {
            events.append("remote:\($0)")
            return $0 != "failed"
        }, deleteLocal: {
            events.append("local:\($0)")
            return true
        })
        XCTAssertFalse(succeeded)
        XCTAssertEqual(events, ["remote:first", "local:first", "remote:failed"])
    }

    func test_localCancellationFailureStopsReplacement() async {
        var events: [String] = []
        let succeeded = await removeReplacementConflicts(["first", "remaining"], deleteRemote: {
            events.append("remote:\($0)"); return true
        }, deleteLocal: {
            events.append("local:\($0)"); return false
        })
        XCTAssertFalse(succeeded)
        XCTAssertEqual(events, ["remote:first", "local:first"])
    }

    func test_successRequiresBothDeletesForEveryConflict() async {
        var events: [String] = []
        let succeeded = await removeReplacementConflicts(["first", "second"], deleteRemote: {
            events.append("remote:\($0)"); return true
        }, deleteLocal: {
            events.append("local:\($0)"); return true
        })
        XCTAssertTrue(succeeded)
        XCTAssertEqual(events, ["remote:first", "local:first", "remote:second", "local:second"])
    }

    func test_remoteAlarmWithoutSessionIsNotReportedDeleted() async {
        let model = RemoteAlarmSyncViewModel()
        let remote = LocalAlarmRecord(id: "remote", label: "alarm", hour: 8, minute: 0, fireAtMillis: 1,
                                      remoteAlarmId: "server-id")
        let local = LocalAlarmRecord(id: "local", label: "alarm", hour: 8, minute: 0, fireAtMillis: 1)
        let remoteDeleted = await model.deleteRemote(record: remote, session: nil)
        let localDeleted = await model.deleteRemote(record: local, session: nil)
        XCTAssertFalse(remoteDeleted)
        XCTAssertTrue(localDeleted)
    }

    func test_stagingDoesNotPersistFakeSyncedState() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("replacement-\(UUID()).json")
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        let alarm = LocalAlarmRecord(id: "new", label: "alarm", hour: 8, minute: 0, fireAtMillis: 1)
        store.deferServerSync(id: alarm.id)
        store.upsertPreservingServerSyncFields(alarm)
        XCTAssertTrue(store.isServerSyncDeferred(id: alarm.id))
        XCTAssertNotEqual(store.record(id: alarm.id)?.syncStateEnum, .synced)
        store.resumeServerSync(id: alarm.id)
        XCTAssertFalse(store.isServerSyncDeferred(id: alarm.id))
    }

    func test_automatic401RestoresEditedAlarmAndItsLiveOldHandle() async {
        await assertRollbackAfterUnauthorized(isNew: false)
    }

    func test_automatic401RemovesNewStagedAlarmWithCancelledHandle() async {
        await assertRollbackAfterUnauthorized(isNew: true)
    }

    private func assertRollbackAfterUnauthorized(isNew: Bool) async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ReplacementUnauthorizedURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); SessionExpiryStore.clear() }
        let api = AlarmTalkAPI(baseURL: URL(string: "https://replacement.example.test/api/")!, session: session)
        let auth = AuthViewModel(api: api)
        auth._setSessionForTesting(AuthSession(token: UUID().uuidString, user: AuthUser(id: "owner", email: "owner@example.test")))
        let expired = expectation(description: "conflict DELETE 401 clears the active session")
        let observation = auth.$session.dropFirst().filter { $0 == nil }.sink { _ in expired.fulfill() }
        defer { observation.cancel() }
        let sync = RemoteAlarmSyncViewModel(api: api)
        let store = replacementStore()
        let old = replacementRecord(label: "before", handle: "old-handle")
        let staged = store.upsert(replacementRecord(label: "staged", handle: "new-handle"))
        let conflict = LocalAlarmRecord(id: "conflict", label: "conflict", hour: 8, minute: 0,
                                        fireAtMillis: 1, remoteAlarmId: "conflict")
        store.upsert(conflict)
        // 보류 직전 시작한 push 응답이 뒤늦게 도착해도 서버 연결을 잃지 않는다.
        store.markRemote(localID: staged.id, remoteID: "latest-server-id", lastSyncedAtMillis: 123)
        let conflictsRemoved = await removeReplacementConflicts([conflict], deleteRemote: {
            await sync.deleteRemote(record: $0, session: auth.session)
        }, deleteLocal: { _ in
            XCTFail("401인 충돌을 로컬에서 지우면 안 된다")
            return false
        })
        XCTAssertFalse(conflictsRemoved)
        await fulfillment(of: [expired], timeout: 1)
        XCTAssertNil(auth.session)
        XCTAssertEqual(SessionExpiryStore.expiredOwnerUserId, "owner")
        var cancelled: [String?] = []
        await rollbackAlarmReplacement(staged: staged, previous: isNew ? nil : old, store: store) {
            cancelled.append($0.alarmKitID)
            return true
        }
        XCTAssertEqual(cancelled, ["new-handle"], "기존 예약은 살아 있어야 한다")
        XCTAssertNotNil(store.record(id: conflict.id))
        if isNew {
            XCTAssertNil(store.record(id: staged.id))
        } else {
            XCTAssertEqual(store.record(id: staged.id)?.label, "before")
            XCTAssertEqual(store.record(id: staged.id)?.alarmKitID, "old-handle")
            XCTAssertEqual(store.record(id: staged.id)?.ownerUserId, "owner")
            XCTAssertEqual(store.record(id: staged.id)?.enabled, true)
            XCTAssertEqual(store.record(id: staged.id)?.remoteAlarmId, "latest-server-id")
            XCTAssertEqual(store.record(id: staged.id)?.lastSyncedAtMillis, 123)
        }
    }

    func test_rollbackPreservesConcurrentDeletionDisableOwnerAndScheduleChanges() async {
        for change in ["delete", "disable", "owner", "schedule", "edit"] {
            let store = replacementStore()
            let old = replacementRecord(label: "before", handle: "old-handle")
            let staged = store.upsert(replacementRecord(label: "staged", handle: "new-handle"))
            switch change {
            case "delete": store.deleteByID(staged.id)
            case "disable": store.setEnabled(id: staged.id, enabled: false)
            case "schedule": store.markScheduled(localID: staged.id, alarmKitID: "newer-handle")
            default:
                var changed = staged
                if change == "owner" { changed.ownerUserId = "other" }
                else { changed.label = "newer-edit" }
                store.upsert(changed)
            }
            let expected = store.record(id: staged.id)
            var cancelled: [String?] = []
            await rollbackAlarmReplacement(staged: staged, previous: old, store: store) {
                cancelled.append($0.alarmKitID)
                return true
            }
            XCTAssertEqual(store.record(id: staged.id), expected, change)
            XCTAssertEqual(cancelled, change == "owner" || change == "edit" ? [] : ["new-handle"], change)
        }
    }

    func test_changeDuringCancellationKeepsNewContentWithoutDeadHandle() async {
        let store = replacementStore()
        let old = replacementRecord(label: "before", handle: "old-handle")
        let staged = store.upsert(replacementRecord(label: "staged", handle: "new-handle"))
        await rollbackAlarmReplacement(staged: staged, previous: old, store: store) { _ in
            var changed = staged
            changed.label = "changed-during-cancel"
            store.upsert(changed)
            return true
        }
        XCTAssertEqual(store.record(id: staged.id)?.label, "changed-during-cancel")
        XCTAssertNil(store.record(id: staged.id)?.alarmKitID)
    }

    private func replacementStore() -> LocalAlarmStore {
        LocalAlarmStore(storageURL: FileManager.default.temporaryDirectory.appendingPathComponent("replacement-\(UUID()).json"),
                        loadFromDisk: false)
    }

    private func replacementRecord(label: String, handle: String) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(id: "edited", label: label, hour: 8, minute: 0,
                                      fireAtMillis: 1, state: AlarmRuntimeState.armed.rawValue, alarmKitID: handle)
        record.ownerUserId = "owner"
        return record
    }
}

/// 원격 충돌 삭제의 실제 401 중앙 처리를 사용하며, 로그아웃 요청도 외부로 보내지 않는다.
private final class ReplacementUnauthorizedURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let isConflict = url.path == "/api/alarm/conflict" && request.httpMethod == "DELETE"
        let response = HTTPURLResponse(url: url, statusCode: isConflict ? 401 : 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((isConflict ? #"{"error":"expired"}"# : #"{"success":true}"#).utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
