import XCTest
@testable import AlarmTalk

/// `LocalAlarmRecord` 의 Codable 라운드트립 + legacy 17필드 JSON 호환.
final class LocalAlarmRecordCodableTests: XCTestCase {

    func test_fullFieldRoundTrip() throws {
        let original = LocalAlarmRecord(
            id: "11111111-1111-1111-1111-111111111111",
            label: "Morning",
            hour: 7,
            minute: 30,
            fireAtMillis: 1_700_000_000_000,
            repeatDaysMask: 0b0011_1110,
            holidayOff: true,
            snoozeEnabled: true,
            snoozeMinutes: 7,
            snoozeRepeatLimit: SnoozeRepeatLimit.five.rawValue,
            snoozeCount: 1,
            vibrationPattern: VibrationPattern.heartbeat.rawValue,
            playMode: AlarmPlayMode.soundThenVoice.rawValue,
            defaultAlarmSoundId: DefaultAlarmSounds.bundledDefault,
            localAudioUri: "file:///tmp/audio.m4a",
            audioCacheKey: "abc123",
            rawAudioUri: "https://example.com/raw.mp3",
            voiceSource: VoiceSource.serverTts.rawValue,
            voiceProfileId: "vp-1",
            voiceText: "좋은 아침",
            voiceCategory: "morning",
            voiceLanguage: "ko",
            voiceRandomPrompt: true,
            voiceRandomContext: RandomPromptContext.wakeFortune.rawValue,
            voiceFortuneGender: "여성",
            voiceFortuneBirthDate: "1990-01-01",
            voiceFortuneBirthTime: "07:30",
            dynamicVoicePreparedForFireAtMillis: 1_700_000_000_000,
            voiceRepeat: false,
            voiceVolumePercent: 72,
            ttsMessageId: "msg-1",
            remoteAlarmId: "remote-1",
            lastSyncedAtMillis: 1_699_999_000_000,
            syncState: AlarmSyncState.synced.rawValue,
            origin: AlarmOrigin.receivedRemote.rawValue,
            alarmVolumePercent: 60,
            alarmSoundUri: "file:///tmp/sound.wav",
            alarmSoundLabel: "default",
            enabled: true,
            state: AlarmRuntimeState.armed.rawValue,
            createdAtMillis: 1_699_998_000_000,
            updatedAtMillis: 1_699_999_500_000,
            alarmKitID: "22222222-2222-2222-2222-222222222222"
        )

        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(LocalAlarmRecord.self, from: encoded)

        XCTAssertEqual(decoded, original)
    }

    func test_missingOptionalsFallBackToDefaults() throws {
        // 최소 필드만 있는 JSON. 신규 필드 누락 시 default 사용 확인.
        let json = """
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "label": "Minimum",
            "hour": 6,
            "minute": 15,
            "fireAtMillis": 1700000000000
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(LocalAlarmRecord.self, from: json)

        XCTAssertEqual(decoded.label, "Minimum")
        XCTAssertEqual(decoded.hour, 6)
        XCTAssertEqual(decoded.repeatDaysMask, 0)
        XCTAssertFalse(decoded.holidayOff)
        XCTAssertTrue(decoded.snoozeEnabled)
        XCTAssertEqual(decoded.snoozeMinutes, 5)
        XCTAssertEqual(decoded.snoozeRepeatLimit, SnoozeRepeatLimit.three.rawValue)
        XCTAssertEqual(decoded.snoozeCount, 0)
        XCTAssertEqual(decoded.vibrationPattern, VibrationPattern.default.rawValue)
        XCTAssertEqual(decoded.playMode, AlarmPlayMode.alarmOnly.rawValue)
        XCTAssertEqual(decoded.defaultAlarmSoundId, DefaultAlarmSounds.bundledDefault)
        XCTAssertNil(decoded.localAudioUri)
        XCTAssertEqual(decoded.voiceSource, VoiceSource.ttsProfile.rawValue)
        XCTAssertFalse(decoded.voiceRandomPrompt)
        XCTAssertNil(decoded.dynamicVoicePreparedForFireAtMillis)
        XCTAssertTrue(decoded.voiceRepeat)
        XCTAssertEqual(decoded.voiceVolumePercent, 100)
        XCTAssertNil(decoded.remoteAlarmId)
        XCTAssertEqual(decoded.syncState, AlarmSyncState.localOnly.rawValue)
        XCTAssertEqual(decoded.origin, AlarmOrigin.localOwned.rawValue)
        XCTAssertEqual(decoded.alarmVolumePercent, 100)
        XCTAssertTrue(decoded.enabled)
        XCTAssertEqual(decoded.state, AlarmRuntimeState.idle.rawValue)
    }

    func test_legacy17FieldJSONCompatibility() throws {
        // iOS 초기 빌드의 17필드 JSON.  `remoteID`, `repeatWeekdays` (Calendar weekday 1..7),
        // `messageID`, `voiceProfileID`, `rawAudioURL`, `localAudioFilePath`, `updatedAt`
        // 모두 새 필드로 매핑되는지 확인.
        let json = """
        {
            "id": "1A4B0AE6-1F1D-4E14-9A05-E8E5C1F0F9AA",
            "remoteID": "remote-legacy-1",
            "label": "Legacy",
            "hour": 8,
            "minute": 0,
            "repeatWeekdays": [2, 3, 4, 5, 6],
            "enabled": true,
            "snoozeMinutes": 5,
            "playMode": "alarm_voice",
            "voiceProfileID": "vp-legacy",
            "messageID": "msg-legacy",
            "rawAudioURL": "https://example.com/legacy.mp3",
            "localAudioFilePath": "msg-legacy.mp3",
            "voiceText": "hello",
            "voiceLanguage": "ko",
            "updatedAt": 700000000.0
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let decoded = try decoder.decode(LocalAlarmRecord.self, from: json)

        XCTAssertEqual(decoded.label, "Legacy")
        XCTAssertEqual(decoded.remoteAlarmId, "remote-legacy-1")
        // repeatWeekdays [2..6] = Mon..Fri = bit 1..5 = 0b0111_1110 / 2 = 0x3E
        XCTAssertEqual(decoded.repeatDaysMask, RepeatDay.monday.mask | RepeatDay.tuesday.mask | RepeatDay.wednesday.mask | RepeatDay.thursday.mask | RepeatDay.friday.mask)
        // playMode "alarm_voice" → "sound_then_voice"
        XCTAssertEqual(decoded.playMode, AlarmPlayMode.soundThenVoice.rawValue)
        XCTAssertEqual(decoded.ttsMessageId, "msg-legacy")
        XCTAssertEqual(decoded.voiceProfileId, "vp-legacy")
        XCTAssertEqual(decoded.rawAudioUri, "https://example.com/legacy.mp3")
        XCTAssertEqual(decoded.localAudioUri, "msg-legacy.mp3")
        // remoteAlarmId 존재 → syncState 가 synced 로 보정되어야 함.
        XCTAssertEqual(decoded.syncState, AlarmSyncState.synced.rawValue)
        XCTAssertEqual(decoded.origin, AlarmOrigin.localOwned.rawValue)
        // fireAtMillis 가 JSON 에 없으므로 fallback 으로 채워졌어야.
        XCTAssertGreaterThan(decoded.fireAtMillis, 0)
        // legacy "updatedAt" 는 Swift Date 기본 인코딩(.deferredToDate = 2001 기준 초)으로
        // 저장됐다. JSONDecoder 기본 전략도 동일하게 timeIntervalSinceReferenceDate 로 읽으므로
        // 700000000 초(2001 기준) → unix 1678307200 초 → 1678307200000 ms.
        XCTAssertEqual(decoded.updatedAtMillis, 1_678_307_200_000)
    }

    func test_alarmKitID_decodesUUIDObjectFromLegacyJSON() throws {
        // 옛 JSON 은 alarmKitID 를 UUID 객체로 인코딩하기도 했음.
        let json = """
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "label": "L",
            "hour": 1,
            "minute": 2,
            "fireAtMillis": 1234567890000,
            "alarmKitID": "44444444-4444-4444-4444-444444444444"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(LocalAlarmRecord.self, from: json)
        XCTAssertEqual(decoded.alarmKitID?.uppercased(), "44444444-4444-4444-4444-444444444444")
        XCTAssertNotNil(decoded.alarmKitUUID)
    }
}
