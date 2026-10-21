import XCTest
@testable import AlarmTalk

/// 내 알람을 서버에 올리는 본문(`RemoteAlarmMapper.toRemoteRequest`)이 안드로이드
/// `RemoteAlarmMapperTest.kt` 와 같은 규약인지 본다. 알람 동기화는 올리기만 한다.
final class RemoteAlarmMapperTests: XCTestCase {

    // MARK: - repeatDays

    func test_repeatDays_mapsMaskToServerDays() {
        let mask = RepeatDay.monday.mask | RepeatDay.tuesday.mask | RepeatDay.friday.mask
        XCTAssertEqual(RemoteAlarmMapper.repeatDays(fromMask: mask), [1, 2, 5])
        XCTAssertEqual(RemoteAlarmMapper.repeatDays(fromMask: 0), [])
    }

    // MARK: - toRemoteRequest

    func test_toRemoteRequest_withTtsMessage_setsTtsMode() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let local = LocalAlarmRecord(
            label: "morning",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            repeatDaysMask: RepeatDay.monday.mask | RepeatDay.wednesday.mask,
            snoozeMinutes: 5,
            vibrationPattern: VibrationPattern.heartbeat.rawValue,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceSource: VoiceSource.serverTts.rawValue,
            voiceProfileId: "vp-1",
            ttsMessageId: "m-1",
            createdAtMillis: now,
            updatedAtMillis: now
        )
        let req = RemoteAlarmMapper.toRemoteRequest(local)
        XCTAssertEqual(req.time, "07:30")
        XCTAssertEqual(req.repeatDays, [1, 3])
        XCTAssertEqual(req.mode, "tts")
        // 목소리 알람이므로 voice_only 로 나간다. 안드로이드도 같은 매핑이다
        // (RemoteAlarmMapper.kt: VOICE_ONLY -> "voice_only", 그 외 -> "sound_then_voice").
        XCTAssertEqual(req.wakeMode, "voice_only")
        XCTAssertEqual(req.vibrationPattern, VibrationPattern.heartbeat.rawValue)
        XCTAssertEqual(req.messageId, "m-1")
        XCTAssertEqual(req.voiceProfileId, "vp-1")
    }

    func test_toRemoteRequest_withoutVoice_setsSoundOnly() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let local = LocalAlarmRecord(
            label: "wake",
            hour: 6,
            minute: 0,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.alarmOnly.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        let req = RemoteAlarmMapper.toRemoteRequest(local)
        XCTAssertEqual(req.mode, "sound-only")
        XCTAssertNil(req.messageId)
    }

    func test_toRemoteRequest_localAudioSource_doesNotSendVoiceProfileID() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let local = LocalAlarmRecord(
            label: "local",
            hour: 8,
            minute: 0,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            localAudioUri: "file:///tmp/x.m4a",
            voiceSource: VoiceSource.localAudio.rawValue,
            voiceProfileId: "should-be-stripped",
            createdAtMillis: now,
            updatedAtMillis: now
        )
        let req = RemoteAlarmMapper.toRemoteRequest(local)
        XCTAssertNil(req.voiceProfileId)
    }

    func test_toRemoteRequest_trimsIdentifiersLikeAndroid() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let local = LocalAlarmRecord(
            label: "trim",
            hour: 8,
            minute: 10,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceSource: VoiceSource.ttsProfile.rawValue,
            voiceProfileId: "  vp-1  ",
            ttsMessageId: "  m-1  ",
            createdAtMillis: now,
            updatedAtMillis: now
        )

        let req = RemoteAlarmMapper.toRemoteRequest(local)

        XCTAssertEqual(req.mode, "tts")
        XCTAssertEqual(req.messageId, "m-1")
        XCTAssertEqual(req.voiceProfileId, "vp-1")
    }

    func test_toRemoteRequest_blankIdentifiersBecomeNilLikeAndroid() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let local = LocalAlarmRecord(
            label: "blank",
            hour: 8,
            minute: 10,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceSource: VoiceSource.ttsProfile.rawValue,
            voiceProfileId: "   ",
            ttsMessageId: "   ",
            createdAtMillis: now,
            updatedAtMillis: now
        )

        let req = RemoteAlarmMapper.toRemoteRequest(local)

        XCTAssertEqual(req.mode, "tts")
        XCTAssertNil(req.messageId)
        XCTAssertNil(req.voiceProfileId)
    }

    /// 서버에 실제로 나가는 본문 — 앱과 같은 인코더(`convertToSnakeCase`).
    private func sentBody(_ local: LocalAlarmRecord) throws -> [String: Any] {
        let data = try AlarmTalkAPI.makeJSONEncoder().encode(RemoteAlarmMapper.toRemoteRequest(local))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    /// 무료 잠금이 오디오 없이 기본 목소리로 바꾼 알람(Codex #820). 서버 `PATCH /alarm` 은 빠진 필드를
    /// 그대로 두므로 비어 있는 문구·테마를 **null 로 실어야** 클론의 `message_id`·`bucket_id` 가 기본
    /// 목소리 옆에 남지 않는다. 안드로이드 `RemoteAlarmMapperTest` 짝.
    func test_toRemoteRequest_audiolessDefaultVoiceLock_clearsServerMessageAndTheme() throws {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var clone = LocalAlarmRecord(
            label: "locked",
            hour: 8,
            minute: 10,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceSource: VoiceSource.ttsProfile.rawValue,
            voiceProfileId: "clone-a",
            ttsMessageId: "clone-greeting",
            createdAtMillis: now,
            updatedAtMillis: now
        )
        clone.bucketId = "greeting"
        var locked = clone
        locked.preLockVoice = LockedPaidVoice(of: clone)
        locked.voiceProfileId = bundledSystemVoiceProfiles()[0].id
        locked.ttsMessageId = nil
        locked.bucketId = nil

        let body = try sentBody(locked)

        XCTAssertTrue(body["message_id"] is NSNull, "\(body)")
        XCTAssertTrue(body["bucket_id"] is NSNull, "\(body)")
        XCTAssertEqual(body["voice_profile_id"] as? String, bundledSystemVoiceProfiles()[0].id)
        // 나머지 빈 값은 예전처럼 빠진다 — 지우는 것은 이 두 키뿐이다.
        XCTAssertNil(body["target_user_id"])
        XCTAssertNil(body["clears_missing_voice_references"], "본문에 실리지 않는 표시")

        // 잠금이 아닌 알람은 예전처럼 빈 값을 서버에 맡긴다.
        let plain = try sentBody(clone.withMessage(nil))
        XCTAssertNil(plain["message_id"])
        XCTAssertEqual(plain["bucket_id"] as? String, "greeting")
        XCTAssertEqual(plain["repeat_days"] as? [Int], [])
    }

    /// 잠금이 **확정**됐거나 목소리를 잃어 **미나**로 바꾼 알람에는 보관본이 없다 — 보관본으로만 가리면
    /// 그 알람의 켜기·끄기가 기본 목소리 id 만 올려 클론의 `greeting` 테마 옆에 앉히고, 서버는 토글마다
    /// `INVALID_BUCKET_ID` 로 거절한다. 기본 목소리 알람이면 빈 문구·테마를 지운다. 안드로이드
    /// `RemoteAlarmMapperTest.aDefaultVoiceAlarmWithoutASnapshotStillClearsTheServersMessageAndTheme` 짝.
    func test_toRemoteRequest_defaultVoiceAlarmWithoutSnapshot_clearsServerMessageAndTheme() throws {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let converted = LocalAlarmRecord(
            label: "converted",
            hour: 8,
            minute: 10,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceSource: VoiceSource.ttsProfile.rawValue,
            voiceProfileId: substituteSystemVoiceID,
            createdAtMillis: now,
            updatedAtMillis: now
        )

        let body = try sentBody(converted)

        XCTAssertTrue(body["message_id"] is NSNull, "\(body)")
        XCTAssertTrue(body["bucket_id"] is NSNull, "\(body)")
        XCTAssertEqual(body["voice_profile_id"] as? String, substituteSystemVoiceID)
    }
}

private extension LocalAlarmRecord {
    func withMessage(_ id: String?) -> LocalAlarmRecord {
        var copy = self
        copy.ttsMessageId = id
        return copy
    }
}