import XCTest
@testable import AlarmTalk

/// `LocalAlarmRecord` 의 Codable 라운드트립 + 부분 JSON 폴백.
/// (옛 17필드 legacy 키 매핑은 4d5004a2 에서 삭제됐다 — 아래 테스트 주석 참고.)
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
            playMode: AlarmPlayMode.voiceOnly.rawValue,
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

    /// 현행 `init(from:)` 에 살아 있는 **부분 JSON 보정 3종**.
    ///
    /// 원래 이 자리에는 `test_legacy17FieldJSONCompatibility` 가 있었다. iOS 초기빌드의
    /// 17필드 포맷(`remoteID`/`repeatWeekdays`/`voiceProfileID`/`messageID`/`rawAudioURL`/
    /// `localAudioFilePath`/`updatedAt`)을 새 필드로 매핑하는 legacy 디코더를 지키던 테스트인데,
    /// 그 디코더는 `4d5004a2` 에서 **의도적으로** 삭제됐다. 되살리지 말 것 — 지킬 데이터가
    /// 존재한 적이 없다:
    ///   - 그 포맷의 수명은 `7c9fcd7f`(2026-05-19 04:48) ~ `e350ee63`(같은 날 14:09), 9시간 남짓.
    ///   - 호환 디코더와 그 테스트는 포맷을 갈아엎은 `e350ee63` 이 **동시에** 만든 투기적 호환이었다.
    ///   - 당시 워크스페이스가 Windows 라 iOS 는 컴파일조차 되지 않았고, 지금도 App Store
    ///     출시 이력이 0이다. 그 포맷으로 저장된 기기는 세상에 없다.
    ///
    /// 아래는 그 삭제 이후에도 **현행 디코더에 남아 있는** 보정만 지킨다.
    func test_partialJSON_playModeAlias_syncStateBackfill_fireAtFallback() throws {
        let json = """
        {
            "id": "1A4B0AE6-1F1D-4E14-9A05-E8E5C1F0F9AA",
            "remoteAlarmId": "remote-1",
            "label": "Legacy",
            "hour": 8,
            "minute": 0,
            "repeatDaysMask": 62,
            "enabled": true,
            "snoozeMinutes": 5,
            "playMode": "alarm_voice",
            "voiceProfileId": "vp-1",
            "ttsMessageId": "msg-1",
            "rawAudioUri": "https://example.com/a.mp3",
            "localAudioUri": "msg-1.mp3",
            "voiceText": "hello",
            "voiceLanguage": "ko"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(LocalAlarmRecord.self, from: json)

        XCTAssertEqual(decoded.label, "Legacy")
        XCTAssertEqual(decoded.remoteAlarmId, "remote-1")
        // 62 = 0b0111_1110 = 월~금
        XCTAssertEqual(
            decoded.repeatDaysMask,
            RepeatDay.monday.mask | RepeatDay.tuesday.mask | RepeatDay.wednesday.mask
                | RepeatDay.thursday.mask | RepeatDay.friday.mask
        )
        // ① playMode 별칭: "alarm_voice" → "sound_then_voice"
        XCTAssertEqual(decoded.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(decoded.ttsMessageId, "msg-1")
        XCTAssertEqual(decoded.voiceProfileId, "vp-1")
        XCTAssertEqual(decoded.rawAudioUri, "https://example.com/a.mp3")
        XCTAssertEqual(decoded.localAudioUri, "msg-1.mp3")
        // ② syncState 보정: remoteAlarmId 가 있으면 synced 로 채운다.
        XCTAssertEqual(decoded.syncState, AlarmSyncState.synced.rawValue)
        XCTAssertEqual(decoded.origin, AlarmOrigin.localOwned.rawValue)
        // ③ fireAtMillis 폴백: JSON 에 없으면 0 이 아닌 값으로 채운다.
        XCTAssertGreaterThan(decoded.fireAtMillis, 0)
        // updatedAtMillis 도 없으면 현재 시각으로 채운다(0 이면 동기화 비교가 깨진다).
        XCTAssertGreaterThan(decoded.updatedAtMillis, 0)
    }

    /// `remoteAlarmId` 가 없으면 syncState 는 `local_only` 로 남아야 한다(보정의 반대 방향).
    func test_partialJSON_withoutRemoteId_staysLocalOnly() throws {
        let json = """
        {
            "id": "2B4B0AE6-1F1D-4E14-9A05-E8E5C1F0F9AA",
            "label": "Local",
            "hour": 6,
            "minute": 15,
            "repeatDaysMask": 0,
            "enabled": true
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(LocalAlarmRecord.self, from: json)
        XCTAssertNil(decoded.remoteAlarmId)
        XCTAssertEqual(decoded.syncState, AlarmSyncState.localOnly.rawValue)
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

    func test_generatedSystemPresetAudioIsNotPaidVoiceForDowngrade() {
        let alarm = LocalAlarmRecord(
            label: "Free preset",
            hour: 7,
            minute: 30,
            fireAtMillis: 1_700_000_000_000,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            localAudioUri: "file:///cache/generated.mp3",
            audioCacheKey: "tts-cache",
            rawAudioUri: "r2://tts/generated",
            voiceSource: VoiceSource.ttsProfile.rawValue,
            voiceProfileId: "70000000-0000-4000-9000-000000000001",
            voiceText: "Buddy, wake now",
            voiceCategory: "morning",
            voiceLanguage: "ko",
            voiceRandomPrompt: true,
            voiceRandomContext: RandomPromptContext.preset.rawValue,
            ttsMessageId: "message-1"
        )

        XCTAssertFalse(alarm.isPaidVoiceForDowngrade)
    }

    func test_customSystemGeneratedAudioIsPaidVoiceForDowngrade() {
        let alarm = LocalAlarmRecord(
            label: "Custom",
            hour: 7,
            minute: 30,
            fireAtMillis: 1_700_000_000_000,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            localAudioUri: "file:///cache/custom.mp3",
            audioCacheKey: "tts-cache",
            rawAudioUri: "r2://tts/custom",
            voiceSource: VoiceSource.ttsProfile.rawValue,
            voiceProfileId: "70000000-0000-4000-9000-000000000001",
            voiceText: "Wake up with a custom paid line.",
            voiceCategory: "custom",
            voiceLanguage: "ko",
            voiceRandomPrompt: false,
            voiceRandomContext: nil,
            ttsMessageId: "message-2"
        )

        XCTAssertTrue(alarm.isPaidVoiceForDowngrade)
    }

    /// ⚠ 회귀 방지: `preLockPlayMode`·`ownerUserId`·`bucketId` 는 한때 `CodingKeys` 에
    /// 없어 디스크 왕복에서 조용히 사라졌다. 무료 전환 잠금이 원래 재생 방식을 잃어
    /// 재결제해도 복원되지 않았고, 잠금이 남의 계정 알람을 건드리지 않게 막는 가드도
    /// 늘 통과했다. **새 필드를 추가하면 이 테스트에도 넣을 것.**
    func test_roundTrip_keepsLockAndOwnerAndBucketFields() throws {
        var record = LocalAlarmRecord(label: "테스트", hour: 6, minute: 30, fireAtMillis: 1_000)
        record.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue
        record.ownerUserId = "user-1"
        record.bucketId = "weather"

        let data = try JSONEncoder().encode(record)
        let decoded = try JSONDecoder().decode(LocalAlarmRecord.self, from: data)

        XCTAssertEqual(decoded.preLockPlayMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(decoded.ownerUserId, "user-1")
        XCTAssertEqual(decoded.bucketId, "weather")
    }
}
