import XCTest
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
}
