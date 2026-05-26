import XCTest
@testable import VoiceAlarm

@MainActor
final class LocalAlarmStoreCopyTests: XCTestCase {

    func test_copyAlarmMovesTenMinutesAndClearsRemoteState() throws {
        let store = makeStore()
        let source = makeAlarm(
            id: "source",
            label: "아침 알람",
            hour: 7,
            minute: 55,
            remoteAlarmId: "remote-1",
            lastSyncedAtMillis: 1234,
            syncState: .synced,
            origin: .receivedRemote
        )
        store.upsert(source)

        let copied = try store.copyAlarm(
            id: source.id,
            nowMillis: millis(2026, 5, 26, 7, 0),
            isHoliday: { _ in false },
            idFactory: { "copy" }
        )

        XCTAssertEqual(copied.id, "copy")
        XCTAssertEqual(copied.label, "아침 알람 복사본")
        XCTAssertEqual(copied.hour, 8)
        XCTAssertEqual(copied.minute, 5)
        XCTAssertNil(copied.remoteAlarmId)
        XCTAssertNil(copied.lastSyncedAtMillis)
        XCTAssertEqual(copied.syncStateEnum, .localOnly)
        XCTAssertEqual(copied.originEnum, .localOwned)
        XCTAssertTrue(copied.enabled)
        XCTAssertEqual(copied.runtimeStateEnum, .armed)
        XCTAssertNil(copied.alarmKitID)
        XCTAssertEqual(copied.audioCacheKey, source.audioCacheKey)
        XCTAssertEqual(store.record(id: "copy")?.id, copied.id)
    }

    func test_copyAlarmWrapsAcrossMidnight() throws {
        let store = makeStore()
        let source = makeAlarm(id: "late", label: "밤 알람", hour: 23, minute: 55)
        store.upsert(source)

        let copied = try store.copyAlarm(
            id: source.id,
            nowMillis: millis(2026, 5, 26, 7, 0),
            isHoliday: { _ in false },
            idFactory: { "copy-late" }
        )

        XCTAssertEqual(copied.hour, 0)
        XCTAssertEqual(copied.minute, 5)
    }

    func test_copyAlarmRejectsDuplicateTargetTime() {
        let store = makeStore()
        let source = makeAlarm(id: "source", label: "원본", hour: 7, minute: 55)
        let collision = makeAlarm(id: "collision", label: "겹침", hour: 8, minute: 5)
        store.upsert(source)
        store.upsert(collision)

        XCTAssertThrowsError(
            try store.copyAlarm(
                id: source.id,
                nowMillis: millis(2026, 5, 26, 7, 0),
                isHoliday: { _ in false },
                idFactory: { "copy" }
            )
        ) { error in
            XCTAssertEqual(error as? LocalAlarmValidationError, .duplicateTime)
        }
        XCTAssertNil(store.record(id: "copy"))
    }

    private func makeStore() -> LocalAlarmStore {
        let url = FileManager.default
            .temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("json")
        return LocalAlarmStore(storageURL: url, loadFromDisk: false)
    }

    private func makeAlarm(
        id: String,
        label: String,
        hour: Int,
        minute: Int,
        remoteAlarmId: String? = nil,
        lastSyncedAtMillis: Int64? = nil,
        syncState: AlarmSyncState = .localOnly,
        origin: AlarmOrigin = .localOwned
    ) -> LocalAlarmRecord {
        LocalAlarmRecord(
            id: id,
            label: label,
            hour: hour,
            minute: minute,
            fireAtMillis: millis(2026, 5, 27, hour, minute),
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            localAudioUri: "\(id).m4a",
            audioCacheKey: "cache-\(id)",
            voiceProfileId: "voice-\(id)",
            remoteAlarmId: remoteAlarmId,
            lastSyncedAtMillis: lastSyncedAtMillis,
            syncState: syncState.rawValue,
            origin: origin.rawValue,
            enabled: false,
            state: AlarmRuntimeState.disabled.rawValue,
            alarmKitID: "11111111-1111-1111-1111-111111111111"
        )
    }

    private func millis(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Int64 {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        var comps = DateComponents()
        comps.year = y
        comps.month = mo
        comps.day = d
        comps.hour = h
        comps.minute = mi
        comps.second = 0
        return Int64(cal.date(from: comps)!.timeIntervalSince1970 * 1000)
    }
}
