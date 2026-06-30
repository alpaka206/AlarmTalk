import XCTest
@testable import AlarmTalk

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
            voiceVolumePercent: 72,
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
        XCTAssertTrue(draft.voiceRepeat)
        XCTAssertEqual(draft.voiceVolumePercent, 72)

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
        XCTAssertTrue(rebuilt.voiceRepeat)
        XCTAssertEqual(rebuilt.voiceVolumePercent, 72)

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
        XCTAssertNil(record.dynamicVoicePreparedForFireAtMillis)

        let restored = AlarmEditDraft(from: record)
        XCTAssertTrue(restored.voiceRandomPrompt)
        XCTAssertEqual(restored.voiceRandomContext, RandomPromptContext.wakeWeather.rawValue)
        XCTAssertEqual(restored.voiceWeatherCountry, "대한민국")
        XCTAssertEqual(restored.voiceWeatherCity, "서울")
    }

    func testAlarmOnlyClearsVoiceFieldsLikeAndroid() throws {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let original = LocalAlarmRecord(
            label: "음성 알람",
            hour: 7,
            minute: 0,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.soundThenVoice.rawValue,
            localAudioUri: "voice.m4a",
            audioCacheKey: "voice-key",
            rawAudioUri: "https://example.com/voice.m4a",
            voiceSource: VoiceSource.serverTts.rawValue,
            voiceProfileId: "voice-1",
            voiceText: "일어나세요",
            voiceCategory: "custom",
            voiceLanguage: "ko",
            voiceRandomPrompt: true,
            voiceRandomContext: RandomPromptContext.wakeWeather.rawValue,
            voiceWeatherCountry: "대한민국",
            voiceWeatherCity: "서울",
            dynamicVoicePreparedForFireAtMillis: now + 60_000,
            voiceRepeat: false,
            voiceVolumePercent: 70,
            ttsMessageId: "msg-1",
            createdAtMillis: now,
            updatedAtMillis: now
        )

        var draft = AlarmEditDraft(from: original)
        draft.playMode = .alarmOnly
        let record = draft.toRecord(existing: original, fireAtMillis: now + 120_000, nowMillis: now)

        XCTAssertEqual(record.playModeEnum, .alarmOnly)
        XCTAssertNil(record.localAudioUri)
        XCTAssertNil(record.audioCacheKey)
        XCTAssertNil(record.rawAudioUri)
        XCTAssertEqual(record.voiceSourceEnum, .localAudio)
        XCTAssertNil(record.voiceProfileId)
        XCTAssertNil(record.voiceText)
        XCTAssertNil(record.voiceCategory)
        XCTAssertNil(record.voiceLanguage)
        XCTAssertFalse(record.voiceRandomPrompt)
        XCTAssertNil(record.voiceRandomContext)
        XCTAssertNil(record.voiceWeatherCountry)
        XCTAssertNil(record.voiceWeatherCity)
        XCTAssertNil(record.dynamicVoicePreparedForFireAtMillis)
        XCTAssertTrue(record.voiceRepeat)
        XCTAssertEqual(record.voiceVolumePercent, 100)
        XCTAssertNil(record.ttsMessageId)
    }

    // MARK: - Validation

    func testValidationAllowsEmptyLabelLikeAndroid() {
        var draft = AlarmEditDraft.newDefault()
        draft.label = "   "
        XCTAssertEqual(draft.validate(), [])
        XCTAssertTrue(draft.isValid)
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

    func testValidationFlagsRepeatMaskAndAlarmVolumeLikeAndroid() {
        var draft = AlarmEditDraft.newDefault()
        draft.repeatDaysMask = 0x80
        draft.alarmVolumePercent = 101

        let errors = Set(draft.validate())

        XCTAssertTrue(errors.contains(.invalidRepeatDaysMask))
        XCTAssertTrue(errors.contains(.invalidAlarmVolume))
    }

    func testValidationFlagsVoiceVolumeBelowAndroidMinimumForVoiceModes() {
        var draft = AlarmEditDraft.newDefault(defaultPlayMode: .soundThenVoice)
        draft.voiceVolumePercent = 29
        XCTAssertTrue(draft.validate().contains(.invalidVoiceVolume))

        draft.voiceVolumePercent = 30
        XCTAssertFalse(draft.validate().contains(.invalidVoiceVolume))
    }

    func testVoiceVolumeLoadsAndSavesAtAndroidMinimum() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let original = LocalAlarmRecord(
            label: "작은 목소리",
            hour: 7,
            minute: 0,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.soundThenVoice.rawValue,
            localAudioUri: "voice.m4a",
            audioCacheKey: "voice-key",
            voiceVolumePercent: 0,
            createdAtMillis: now,
            updatedAtMillis: now
        )

        let draft = AlarmEditDraft(from: original)
        XCTAssertEqual(draft.voiceVolumePercent, 30)

        let record = draft.toRecord(existing: original, fireAtMillis: now + 120_000, nowMillis: now)
        XCTAssertEqual(record.voiceVolumePercent, 30)
    }

    func testCanReuseExistingTtsAudioForUnchangedManualVoice() {
        let record = makeTtsRecord(
            voiceProfileId: "voice-1",
            voiceText: "일어나세요",
            voiceCategory: "custom",
            voiceLanguage: "ko"
        )

        XCTAssertTrue(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: record,
            selectedProfileID: "voice-1",
            text: "  일어나세요  ",
            randomPrompt: false,
            randomContext: nil,
            language: "en",
            translateText: false,
            // 고정 문구는 fireAt 무관 — 임의 값이어도 재사용 가능해야 한다.
            fireAtMillis: 0,
            listenerTitle: nil
        ))
    }

    func testCanReuseExistingTtsAudioRejectsChangedTextOrProfile() {
        let record = makeTtsRecord(
            voiceProfileId: "voice-1",
            voiceText: "일어나세요",
            voiceCategory: "custom",
            voiceLanguage: "ko"
        )

        XCTAssertFalse(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: record,
            selectedProfileID: "voice-1",
            text: "좋은 아침",
            randomPrompt: false,
            randomContext: nil,
            language: "ko",
            translateText: false,
            fireAtMillis: 0,
            listenerTitle: nil
        ))
        XCTAssertFalse(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: record,
            selectedProfileID: "voice-2",
            text: "일어나세요",
            randomPrompt: false,
            randomContext: nil,
            language: "ko",
            translateText: false,
            fireAtMillis: 0,
            listenerTitle: nil
        ))
    }

    func testCanReuseExistingTtsAudioMatchesSavedListenerTitle() {
        let record = makeTtsRecord(
            voiceProfileId: "voice-1",
            voiceText: "일어나세요",
            voiceCategory: "custom",
            voiceLanguage: "ko",
            voiceListenerTitle: "공주님"
        )

        XCTAssertTrue(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: record,
            selectedProfileID: "voice-1",
            text: "일어나세요",
            randomPrompt: false,
            randomContext: nil,
            language: "ko",
            translateText: false,
            fireAtMillis: 0,
            listenerTitle: "  공주님  "
        ))
        XCTAssertFalse(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: record,
            selectedProfileID: "voice-1",
            text: "일어나세요",
            randomPrompt: false,
            randomContext: nil,
            language: "ko",
            translateText: false,
            fireAtMillis: 0,
            listenerTitle: "친구"
        ))
        XCTAssertFalse(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: record,
            selectedProfileID: "voice-1",
            text: "일어나세요",
            randomPrompt: false,
            randomContext: nil,
            language: "ko",
            translateText: false,
            fireAtMillis: 0,
            listenerTitle: nil
        ))
    }

    func testCanReuseExistingTtsAudioForUnchangedRandomPrompt() {
        let preparedFireAt: Int64 = 1_700_000_000_000
        let record = makeTtsRecord(
            voiceProfileId: "voice-1",
            voiceText: "오늘 날씨에 맞춰 일어나세요",
            voiceCategory: RandomPromptContext.wakeWeather.ttsCategory,
            voiceLanguage: "ko",
            voiceRandomPrompt: true,
            voiceRandomContext: RandomPromptContext.wakeWeather.rawValue,
            dynamicVoicePreparedForFireAtMillis: preparedFireAt
        )

        // 같은 발화 시각이면 랜덤 클립도 재사용 가능.
        XCTAssertTrue(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: record,
            selectedProfileID: "voice-1",
            text: "",
            randomPrompt: true,
            randomContext: RandomPromptContext.wakeWeather.rawValue,
            language: "ko",
            translateText: false,
            fireAtMillis: preparedFireAt,
            listenerTitle: nil
        ))
    }

    func testCanReuseExistingTtsAudioRejectsRandomPromptWithDifferentFireAt() {
        let preparedFireAt: Int64 = 1_700_000_000_000
        let record = makeTtsRecord(
            voiceProfileId: "voice-1",
            voiceText: "오늘 날씨에 맞춰 일어나세요",
            voiceCategory: RandomPromptContext.wakeWeather.ttsCategory,
            voiceLanguage: "ko",
            voiceRandomPrompt: true,
            voiceRandomContext: RandomPromptContext.wakeWeather.rawValue,
            dynamicVoicePreparedForFireAtMillis: preparedFireAt
        )

        // 다른 발화 시각용 클립은 stale 이므로 재사용을 막아 재합성하게 한다.
        XCTAssertFalse(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: record,
            selectedProfileID: "voice-1",
            text: "",
            randomPrompt: true,
            randomContext: RandomPromptContext.wakeWeather.rawValue,
            language: "ko",
            translateText: false,
            fireAtMillis: preparedFireAt + 60_000,
            listenerTitle: nil
        ))

        // 준비 시각이 비어 있으면(아직 refresh 안 됨) 재사용하지 않는다.
        let unpreparedRecord = makeTtsRecord(
            voiceProfileId: "voice-1",
            voiceText: "오늘 날씨에 맞춰 일어나세요",
            voiceCategory: RandomPromptContext.wakeWeather.ttsCategory,
            voiceLanguage: "ko",
            voiceRandomPrompt: true,
            voiceRandomContext: RandomPromptContext.wakeWeather.rawValue
        )
        XCTAssertFalse(AlarmEditDraft.canReuseExistingTtsAudio(
            existing: unpreparedRecord,
            selectedProfileID: "voice-1",
            text: "",
            randomPrompt: true,
            randomContext: RandomPromptContext.wakeWeather.rawValue,
            language: "ko",
            translateText: false,
            fireAtMillis: preparedFireAt,
            listenerTitle: nil
        ))
    }

    func testValidationPassesForValidDraft() {
        let draft = AlarmEditDraft.newDefault()
        XCTAssertEqual(draft.validate(), [])
        XCTAssertTrue(draft.isValid)
    }

    func testAlarmSoundControlsHiddenOnlyForVoiceOnlyMode() {
        var draft = AlarmEditDraft.newDefault(defaultPlayMode: .soundThenVoice)
        XCTAssertTrue(draft.showsAlarmSoundControls)

        draft.playMode = .alarmOnly
        XCTAssertTrue(draft.showsAlarmSoundControls)

        draft.playMode = .voiceOnly
        XCTAssertFalse(draft.showsAlarmSoundControls)
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
        let draft = AlarmEditDraft.newDefault()
        XCTAssertEqual(draft.label, "")
        XCTAssertEqual(draft.hour, 6)
        XCTAssertEqual(draft.minute, 0)
        XCTAssertEqual(draft.playMode, .alarmOnly)
        XCTAssertTrue(draft.snoozeEnabled)
        XCTAssertEqual(draft.snoozeMinutes, 5)
        XCTAssertEqual(draft.snoozeRepeatLimit, .three)
        XCTAssertEqual(draft.vibrationPattern, .default)
        XCTAssertEqual(draft.alarmVolumePercent, 100)
        XCTAssertTrue(draft.voiceRepeat)
        XCTAssertEqual(draft.voiceVolumePercent, 100)
        XCTAssertEqual(draft.repeatDaysMask, 0)
        XCTAssertFalse(draft.holidayOff)
    }

    func testNewAlarmCanUsePaidDefaultPlayMode() {
        let draft = AlarmEditDraft.newDefault(defaultPlayMode: .soundThenVoice)
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

    private func makeTtsRecord(
        voiceProfileId: String,
        voiceText: String,
        voiceCategory: String,
        voiceLanguage: String,
        voiceListenerTitle: String? = nil,
        voiceRandomPrompt: Bool = false,
        voiceRandomContext: String? = nil,
        dynamicVoicePreparedForFireAtMillis: Int64? = nil
    ) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            label: "음성 알람",
            hour: 7,
            minute: 0,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.soundThenVoice.rawValue,
            localAudioUri: "voice.m4a",
            audioCacheKey: "voice-cache",
            voiceSource: VoiceSource.serverTts.rawValue,
            voiceProfileId: voiceProfileId,
            voiceListenerTitle: voiceListenerTitle,
            voiceText: voiceText,
            voiceCategory: voiceCategory,
            voiceLanguage: voiceLanguage,
            voiceRandomPrompt: voiceRandomPrompt,
            voiceRandomContext: voiceRandomContext,
            dynamicVoicePreparedForFireAtMillis: dynamicVoicePreparedForFireAtMillis,
            ttsMessageId: "message-1",
            createdAtMillis: now,
            updatedAtMillis: now
        )
    }
}
