import XCTest
@testable import AlarmTalk

@MainActor
final class DuplicateAlarmReplacementTests: XCTestCase {
    // 서버에는 알람 사본이 없다(2026-10-29) — 교체가 지우는 것은 기기의 예약과 행뿐이다.
    func test_localCancellationFailureStopsReplacement() async {
        var events: [String] = []
        let succeeded = await removeReplacementConflicts(["first", "remaining"], deleteLocal: {
            events.append("local:\($0)"); return false
        })
        XCTAssertFalse(succeeded)
        XCTAssertEqual(events, ["local:first"])
    }

    func test_successRequiresEveryConflictDeleted() async {
        var events: [String] = []
        let succeeded = await removeReplacementConflicts(["first", "second"], deleteLocal: {
            events.append("local:\($0)"); return true
        })
        XCTAssertTrue(succeeded)
        XCTAssertEqual(events, ["local:first", "local:second"])
    }

    func test_failedConflictDeleteRestoresEditedAlarmAndItsLiveOldHandle() async {
        await assertRollbackAfterFailedConflictDelete(isNew: false)
    }

    func test_failedConflictDeleteRemovesNewStagedAlarmWithCancelledHandle() async {
        await assertRollbackAfterFailedConflictDelete(isNew: true)
    }

    private func assertRollbackAfterFailedConflictDelete(isNew: Bool) async {
        let store = replacementStore()
        let old = replacementRecord(label: "before", handle: "old-handle")
        let staged = store.upsert(replacementRecord(label: "staged", handle: "new-handle"))
        let conflict = LocalAlarmRecord(id: "conflict", label: "conflict", hour: 8, minute: 0, fireAtMillis: 1)
        store.upsert(conflict)
        let conflictsRemoved = await removeReplacementConflicts([conflict], deleteLocal: { _ in false })
        XCTAssertFalse(conflictsRemoved)
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
