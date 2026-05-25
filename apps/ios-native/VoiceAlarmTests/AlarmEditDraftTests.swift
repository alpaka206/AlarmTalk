import XCTest
@testable import VoiceAlarm

final class AlarmEditDraftTests: XCTestCase {

    // MARK: - Round-trip: record → draft → record

    func testRoundTripPreservesEditableFields() throws {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let original = LocalAlarmRecord(
            id: "alarm-42",
            label: "아침",
            hour: 7,
            minute: 15,
            fireAtMillis: now + 60_000,
            repeatDaysMask: (1 << 1) | (1 << 3) | (1 << 5),  // 월/수/금
            holidayOff: true,
            snoozeEnabled: true,
            snoozeMinutes: 7,
            snoozeRepeatLimit: SnoozeRepeatLimit.five.rawValue,
            snoozeCount: 0,
            vibrationPattern: VibrationPattern.heartbeat.rawValue,
            playMode: AlarmPlayMode.soundThenVoice.rawValue,
            defaultAlarmSoundId: DefaultAlarmSounds.bundledDefault,
            localAudioUri: "file:///tmp/voice.m4a",
            audioCacheKey: "sha-abc",
            rawAudioUri: nil,
            voiceSource: VoiceSource.serverTts.rawValue,
            voiceProfileId: "vp-1",
            voiceText: "굿모닝",
            voiceCategory: "morning",
            voiceLanguage: "ko",
            voiceRandomPrompt: false,
            voiceRepeat: true,
            ttsMessageId: "msg-1",
            remoteAlarmId: "remote-1",
            lastSyncedAtMillis: now - 1_000,
            syncState: AlarmSyncState.synced.rawValue,
            origin: AlarmOrigin.localOwned.rawValue,
            alarmVolumePercent: 65,
            alarmSoundUri: nil,
            alarmSoundLabel: nil,
            enabled: true,
            state: AlarmRuntimeState.armed.rawValue,
            createdAtMillis: now - 100_000,
            updatedAtMillis: now - 50_000,
            alarmKitID: "AK-1"
        )

        let draft = AlarmEditDraft(from: original)
        XCTAssertEqual(draft.label, "아침")
        XCTAssertEqual(draft.hour, 7)
        XCTAssertEqual(draft.minute, 15)
        XCTAssertEqual(draft.repeatDaysMask, (1 << 1) | (1 << 3) | (1 << 5))
        XCTAssertEqual(draft.holidayOff, true)
        XCTAssertEqual(draft.playMode, .soundThenVoice)
        XCTAssertTrue(draft.snoozeEnabled)
        XCTAssertEqual(draft.snoozeMinutes, 7)
        XCTAssertEqual(draft.snoozeRepeatLimit, .five)
        XCTAssertEqual(draft.vibrationPattern, .heartbeat)
        XCTAssertEqual(draft.alarmVolumePercent, 65)

        let rebuilt = draft.toRecord(existing: original, fireAtMillis: now + 120_000, nowMillis: now)
        XCTAssertEqual(rebuilt.id, original.id, "ID 는 보존되어야 한다")
        XCTAssertEqual(rebuilt.audioCacheKey, original.audioCacheKey, "audio cache 는 보존되어야 한다")
        XCTAssertEqual(rebuilt.localAudioUri, original.localAudioUri)
        XCTAssertEqual(rebuilt.voiceProfileId, original.voiceProfileId)
        XCTAssertEqual(rebuilt.voiceText, original.voiceText)
        XCTAssertEqual(rebuilt.ttsMessageId, original.ttsMessageId)
        XCTAssertEqual(rebuilt.remoteAlarmId, original.remoteAlarmId)
        XCTAssertEqual(rebuilt.createdAtMillis, original.createdAtMillis, "createdAt 는 보존되어야 한다")

        // 편집 가능 필드는 draft 값으로 반영.
        XCTAssertEqual(rebuilt.label, "아침")
        XCTAssertEqual(rebuilt.hour, 7)
        XCTAssertEqual(rebuilt.minute, 15)
        XCTAssertEqual(rebuilt.snoozeMinutes, 7)
        XCTAssertEqual(rebuilt.snoozeRepeatLimit, SnoozeRepeatLimit.five.rawValue)
        XCTAssertEqual(rebuilt.alarmVolumePercent, 65)

        // remote 가 있던 record 는 dirty 로 마킹.
        XCTAssertEqual(rebuilt.syncState, AlarmSyncState.dirty.rawValue)
    }

    func testRandomPromptFieldsRoundTrip() throws {
        var draft = AlarmEditDraft.newDefault()
        draft.playMode = .soundThenVoice
        draft.voiceRandomPrompt = true
        draft.voiceRandomContext = RandomPromptContext.wakeWeather.rawValue
        draft.voiceWeatherCountry = "대한민국"
        draft.voiceWeatherCity = "서울"

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let record = draft.toRecord(existing: nil, fireAtMillis: now + 60_000, nowMillis: now)

        XCTAssertTrue(record.voiceRandomPrompt)
        XCTAssertEqual(record.voiceRandomContext, RandomPromptContext.wakeWeather.rawValue)
        XCTAssertEqual(record.voiceWeatherCountry, "대한민국")
        XCTAssertEqual(record.voiceWeatherCity, "서울")
        XCTAssertNil(record.voiceFortuneGender)

        let restored = AlarmEditDraft(from: record)
        XCTAssertTrue(restored.voiceRandomPrompt)
        XCTAssertEqual(restored.voiceRandomContext, RandomPromptContext.wakeWeather.rawValue)
        XCTAssertEqual(restored.voiceWeatherCountry, "대한민국")
        XCTAssertEqual(restored.voiceWeatherCity, "서울")
    }

    // MARK: - Validation

    func testValidationFlagsEmptyLabel() {
        var draft = AlarmEditDraft.newDefault()
        draft.label = "   "
        XCTAssertEqual(draft.validate(), [.emptyLabel])
        XCTAssertFalse(draft.isValid)
    }

    func testValidationFlagsInvalidHourMinute() {
        var draft = AlarmEditDraft.newDefault()
        draft.label = "ok"
        draft.hour = 25
        draft.minute = 60
        let errors = Set(draft.validate())
        XCTAssertTrue(errors.contains(.invalidHour))
        XCTAssertTrue(errors.contains(.invalidMinute))
    }

    func testValidationFlagsSnoozeBounds() {
        var draft = AlarmEditDraft.newDefault()
        draft.label = "ok"
        draft.snoozeMinutes = 0
        XCTAssertTrue(draft.validate().contains(.invalidSnoozeMinutes))

        draft.snoozeMinutes = 31
        XCTAssertTrue(draft.validate().contains(.invalidSnoozeMinutes))

        draft.snoozeMinutes = 30
        XCTAssertFalse(draft.validate().contains(.invalidSnoozeMinutes))
    }

    func testValidationPassesForValidDraft() {
        let draft = AlarmEditDraft.newDefault()
        XCTAssertEqual(draft.validate(), [])
        XCTAssertTrue(draft.isValid)
    }

    // MARK: - Empty label fallback in toRecord

    func testToRecordSubstitutesDefaultLabelWhenEmpty() {
        var draft = AlarmEditDraft.newDefault()
        draft.label = "   "
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let record = draft.toRecord(existing: nil, fireAtMillis: now + 1_000, nowMillis: now)
        XCTAssertEqual(record.label, "알람", "공백 라벨은 '알람' 으로 대체")
    }

    // MARK: - New alarm without existing record

    func testNewAlarmInitialDefaults() {
        let draft = AlarmEditDraft.newDefault(referenceDate: Date(timeIntervalSince1970: 0))
        XCTAssertFalse(draft.label.isEmpty)
        XCTAssertEqual(draft.playMode, .alarmOnly)
        XCTAssertTrue(draft.snoozeEnabled)
        XCTAssertEqual(draft.snoozeMinutes, 5)
        XCTAssertEqual(draft.snoozeRepeatLimit, .three)
        XCTAssertEqual(draft.vibrationPattern, .default)
        XCTAssertEqual(draft.alarmVolumePercent, 80)
        XCTAssertEqual(draft.repeatDaysMask, 0)
        XCTAssertFalse(draft.holidayOff)
    }

    func testNewAlarmCanUsePaidDefaultPlayMode() {
        let draft = AlarmEditDraft.newDefault(
            referenceDate: Date(timeIntervalSince1970: 0),
            defaultPlayMode: .soundThenVoice
        )
        XCTAssertEqual(draft.playMode, .soundThenVoice)
    }

    // MARK: - RepeatDay mask consistency with RepeatWeekdayChips

    func testRepeatDayMaskMatchesEnumBits() {
        // RepeatWeekdayChips 가 toggle 할 때 사용하는 동일한 비트 규약을 검증.
        XCTAssertEqual(RepeatDay.sunday.mask, 1 << 0)
        XCTAssertEqual(RepeatDay.monday.mask, 1 << 1)
        XCTAssertEqual(RepeatDay.tuesday.mask, 1 << 2)
        XCTAssertEqual(RepeatDay.wednesday.mask, 1 << 3)
        XCTAssertEqual(RepeatDay.thursday.mask, 1 << 4)
        XCTAssertEqual(RepeatDay.friday.mask, 1 << 5)
        XCTAssertEqual(RepeatDay.saturday.mask, 1 << 6)

        // 전체 켜기
        let all = RepeatDay.allCases.mask
        XCTAssertEqual(all, 0b1111111)
    }
}
