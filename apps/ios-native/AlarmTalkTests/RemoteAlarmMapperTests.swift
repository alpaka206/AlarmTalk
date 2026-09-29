import XCTest
@testable import AlarmTalk

/// Android `RemoteAlarmMapperTest.kt` 와 동일 의도. 매핑 표가 양방향으로
/// 무손실인지 검증한다.
final class RemoteAlarmMapperTests: XCTestCase {

    // MARK: - resolveOrigin

    func test_resolveOrigin_targetIsMe_returnsReceivedRemote() {
        let remote = RemoteAlarm(
            id: "r1",
            time: "07:30",
            repeatDays: [1, 2, 3, 4, 5],
            isActive: true,
            snoozeMinutes: 5,
            mode: "tts",
            vibrationPattern: "default",
            wakeMode: "sound_then_voice",
            voiceProfileId: "vp",
            messageId: "m1",
            messageText: "good morning",
            category: "morning",
            messageAudioUrl: nil,
            targetUserId: "me",
            senderUserId: "other",
            senderName: "Sender",
            senderEmail: nil,
            isFamilyAlarm: false,
            isReceivedFamilyAlarm: true
        )
        XCTAssertEqual(RemoteAlarmMapper.resolveOrigin(remote, currentUserID: "me"), .receivedRemote)
    }

    func test_resolveOrigin_targetIsOther_returnsLocalOwned() {
        let remote = RemoteAlarm(
            id: "r1", time: "07:30", repeatDays: nil, isActive: true, snoozeMinutes: nil,
            mode: nil, vibrationPattern: nil, wakeMode: nil, voiceProfileId: nil,
            messageId: nil, messageText: nil, category: nil,
            messageAudioUrl: nil,
            targetUserId: "someone-else", senderUserId: "me", senderName: nil,
            senderEmail: nil, isFamilyAlarm: false, isReceivedFamilyAlarm: false
        )
        XCTAssertEqual(RemoteAlarmMapper.resolveOrigin(remote, currentUserID: "me"), .localOwned)
    }

    func test_resolveOrigin_senderIsMe_andTargetIsMe_returnsLocalOwned() {
        // 본인이 본인에게 만든 알람은 origin = localOwned.
        let remote = RemoteAlarm(
            id: "r1", time: "07:30", repeatDays: nil, isActive: true, snoozeMinutes: nil,
            mode: nil, vibrationPattern: nil, wakeMode: nil, voiceProfileId: nil,
            messageId: nil, messageText: nil, category: nil,
            messageAudioUrl: nil,
            targetUserId: "me", senderUserId: "me", senderName: nil,
            senderEmail: nil, isFamilyAlarm: false, isReceivedFamilyAlarm: false
        )
        XCTAssertEqual(RemoteAlarmMapper.resolveOrigin(remote, currentUserID: "me"), .localOwned)
    }

    // MARK: - parseTime

    func test_parseTime_hhmm() {
        XCTAssertEqual(RemoteAlarmMapper.parseTime("07:30")?.0, 7)
        XCTAssertEqual(RemoteAlarmMapper.parseTime("07:30")?.1, 30)
    }

    func test_parseTime_hhmmss() {
        XCTAssertEqual(RemoteAlarmMapper.parseTime("23:59:00")?.0, 23)
        XCTAssertEqual(RemoteAlarmMapper.parseTime("23:59:00")?.1, 59)
    }

    func test_parseTime_invalid_returnsNil() {
        XCTAssertNil(RemoteAlarmMapper.parseTime(nil))
        XCTAssertNil(RemoteAlarmMapper.parseTime(""))
        XCTAssertNil(RemoteAlarmMapper.parseTime("25:00"))
        XCTAssertNil(RemoteAlarmMapper.parseTime("garbage"))
    }

    // MARK: - repeatMask / repeatDays

    func test_repeatMask_roundtripsThroughRepeatDays() {
        let mask = RepeatDay.monday.mask | RepeatDay.tuesday.mask | RepeatDay.friday.mask
        let days = RemoteAlarmMapper.repeatDays(fromMask: mask)
        XCTAssertEqual(days, [1, 2, 5])

        let recovered = RemoteAlarmMapper.repeatMask(from: days)
        XCTAssertEqual(recovered, mask)
    }

    func test_repeatMask_ignoresOutOfRangeDays() {
        XCTAssertEqual(RemoteAlarmMapper.repeatMask(from: [-1, 7, 99, 0]), 1)
    }

    // MARK: - playMode resolution

    func test_resolvePlayMode_voiceOnly() {
        let remote = makeRemote(messageId: "m1", wakeMode: "voice_only")
        XCTAssertEqual(RemoteAlarmMapper.resolvePlayMode(remote), .voiceOnly)
    }

    func test_resolvePlayMode_legacySoundThenVoiceBecomesVoiceOnly() {
        let remote = makeRemote(messageId: "m1", wakeMode: "sound_then_voice")
        XCTAssertEqual(RemoteAlarmMapper.resolvePlayMode(remote), .voiceOnly)
    }

    func test_resolvePlayMode_legacyAlarmVoice_mapsToSoundThenVoice() {
        let remote = makeRemote(messageId: "m1", wakeMode: "alarm_voice")
        XCTAssertEqual(RemoteAlarmMapper.resolvePlayMode(remote), .voiceOnly)
    }

    func test_resolvePlayMode_noVoice_returnsAlarmOnly() {
        let remote = makeRemote(messageId: nil, wakeMode: "voice_only")
        XCTAssertEqual(RemoteAlarmMapper.resolvePlayMode(remote), .alarmOnly)
    }

    // MARK: - label resolution

    func test_resolveLabel_usesSenderNameLikeAndroid() {
        let remote = makeRemote(messageId: "m1", wakeMode: "sound_then_voice")
        XCTAssertEqual(RemoteAlarmMapper.resolveLabel(remote), "Other님이 보낸 알람")
    }

    func test_resolveLabel_doesNotDuplicateHonorific() {
        var remote = makeRemote(messageId: "m1", wakeMode: "sound_then_voice")
        remote = RemoteAlarm(
            id: remote.id, time: remote.time, repeatDays: remote.repeatDays,
            isActive: remote.isActive, snoozeMinutes: remote.snoozeMinutes, mode: remote.mode,
            vibrationPattern: remote.vibrationPattern, wakeMode: remote.wakeMode,
            voiceProfileId: remote.voiceProfileId,
            messageId: remote.messageId, messageText: "message text should not become label",
            category: remote.category,
            messageAudioUrl: remote.messageAudioUrl,
            targetUserId: remote.targetUserId, senderUserId: remote.senderUserId,
            senderName: "규원님", senderEmail: remote.senderEmail,
            isFamilyAlarm: remote.isFamilyAlarm,
            isReceivedFamilyAlarm: remote.isReceivedFamilyAlarm
        )
        XCTAssertEqual(RemoteAlarmMapper.resolveLabel(remote), "규원님이 보낸 알람")
    }

    func test_resolveLabel_fallsBackToSenderEmailAndGenericText() {
        var remote = makeRemote(messageId: "m1", wakeMode: "sound_then_voice")
        remote = RemoteAlarm(
            id: remote.id, time: remote.time, repeatDays: remote.repeatDays,
            isActive: remote.isActive, snoozeMinutes: remote.snoozeMinutes, mode: remote.mode,
            vibrationPattern: remote.vibrationPattern, wakeMode: remote.wakeMode,
            voiceProfileId: remote.voiceProfileId,
            messageId: remote.messageId, messageText: remote.messageText,
            category: remote.category,
            messageAudioUrl: remote.messageAudioUrl,
            targetUserId: remote.targetUserId, senderUserId: remote.senderUserId,
            senderName: nil, senderEmail: "sender@example.com",
            isFamilyAlarm: remote.isFamilyAlarm,
            isReceivedFamilyAlarm: remote.isReceivedFamilyAlarm
        )
        XCTAssertEqual(RemoteAlarmMapper.resolveLabel(remote), "sender@example.com님이 보낸 알람")

        remote = RemoteAlarm(
            id: remote.id, time: remote.time, repeatDays: remote.repeatDays,
            isActive: remote.isActive, snoozeMinutes: remote.snoozeMinutes, mode: remote.mode,
            vibrationPattern: remote.vibrationPattern, wakeMode: remote.wakeMode,
            voiceProfileId: remote.voiceProfileId,
            messageId: remote.messageId, messageText: remote.messageText,
            category: remote.category,
            messageAudioUrl: remote.messageAudioUrl,
            targetUserId: remote.targetUserId, senderUserId: remote.senderUserId,
            senderName: nil, senderEmail: nil,
            isFamilyAlarm: remote.isFamilyAlarm,
            isReceivedFamilyAlarm: remote.isReceivedFamilyAlarm
        )
        XCTAssertEqual(RemoteAlarmMapper.resolveLabel(remote), "상대가 보낸 알람")
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

    // MARK: - toLocalRecord

    func test_toLocalRecord_receivedRemote_setsExpectedFields() throws {
        let remote = RemoteAlarm(
            id: "remote-99",
            time: "07:30",
            repeatDays: [1, 2, 3, 4, 5],
            isActive: true,
            snoozeMinutes: 7,
            mode: "tts",
            vibrationPattern: "heartbeat",
            wakeMode: "voice_only",
            voiceProfileId: "vp-9",
            messageId: "m-9",
            messageText: "Wake up",
            category: "morning",
            messageAudioUrl: "https://example.com/audio.mp3",
            targetUserId: "me",
            senderUserId: "sender",
            senderName: "Sender",
            senderEmail: nil,
            isFamilyAlarm: false,
            isReceivedFamilyAlarm: true
        )
        let local = try XCTUnwrap(RemoteAlarmMapper.toLocalRecord(remote, currentUserID: "me", nowMillis: 1_700_000_000_000))
        XCTAssertEqual(local.label, "Sender님이 보낸 알람")
        XCTAssertEqual(local.hour, 7)
        XCTAssertEqual(local.minute, 30)
        XCTAssertEqual(local.snoozeMinutes, 7)
        XCTAssertEqual(local.vibrationPattern, "heartbeat")
        XCTAssertEqual(local.playModeEnum, .voiceOnly)
        XCTAssertEqual(local.voiceVolumePercent, 100)
        XCTAssertEqual(local.originEnum, .receivedRemote)
        XCTAssertEqual(local.voiceSourceEnum, .serverTts)
        XCTAssertEqual(local.ttsMessageId, "m-9")
        XCTAssertEqual(local.audioCacheKey, "remote-message-m-9")
        XCTAssertEqual(local.rawAudioUri, "https://example.com/audio.mp3")
        XCTAssertEqual(local.remoteAlarmId, "remote-99")
        XCTAssertEqual(local.syncStateEnum, .synced)
        XCTAssertTrue(local.enabled)
        // bit mask: Mon..Fri = 0b0111110
        XCTAssertEqual(local.repeatDaysMask, RepeatDay.monday.mask | RepeatDay.tuesday.mask | RepeatDay.wednesday.mask | RepeatDay.thursday.mask | RepeatDay.friday.mask)
    }

    func test_toLocalRecord_inactiveRemote_setsEnabledFalse() throws {
        let remote = makeRemote(messageId: nil, wakeMode: nil)
        var modified = remote
        modified = RemoteAlarm(
            id: remote.id, time: remote.time, repeatDays: remote.repeatDays,
            isActive: false, snoozeMinutes: remote.snoozeMinutes, mode: remote.mode,
            vibrationPattern: remote.vibrationPattern, wakeMode: remote.wakeMode,
            voiceProfileId: remote.voiceProfileId,
            messageId: remote.messageId, messageText: remote.messageText,
            category: remote.category,
            messageAudioUrl: remote.messageAudioUrl,
            targetUserId: remote.targetUserId, senderUserId: remote.senderUserId,
            senderName: remote.senderName, senderEmail: remote.senderEmail,
            isFamilyAlarm: remote.isFamilyAlarm,
            isReceivedFamilyAlarm: remote.isReceivedFamilyAlarm
        )
        let local = try XCTUnwrap(RemoteAlarmMapper.toLocalRecord(modified, currentUserID: "me", nowMillis: 1_700_000_000_000))
        XCTAssertFalse(local.enabled)
        XCTAssertEqual(local.runtimeStateEnum, .disabled)
    }

    func test_toLocalRecord_withoutMessageAudioUrl_downgradesToAlarmOnlyLikeAndroid() throws {
        let remote = makeRemote(messageId: "m1", wakeMode: "voice_only", messageAudioUrl: nil)

        let local = try XCTUnwrap(RemoteAlarmMapper.toLocalRecord(remote, currentUserID: "me", nowMillis: 1_700_000_000_000))

        XCTAssertEqual(local.playModeEnum, .alarmOnly)
        XCTAssertEqual(local.voiceSourceEnum, .localAudio)
        XCTAssertNil(local.ttsMessageId)
        XCTAssertNil(local.audioCacheKey)
        XCTAssertNil(local.rawAudioUri)
        XCTAssertNil(local.voiceProfileId)
        XCTAssertNil(local.voiceText)
        XCTAssertNil(local.voiceCategory)
    }

    func test_shouldDownloadRemoteMessageAudio_requiresNonBlankIdAndAudioUrl() {
        XCTAssertTrue(RemoteAlarmMapper.shouldDownloadRemoteMessageAudio(makeRemote(messageId: "m1", wakeMode: "voice_only")))
        XCTAssertFalse(RemoteAlarmMapper.shouldDownloadRemoteMessageAudio(makeRemote(messageId: "   ", wakeMode: "voice_only")))
        XCTAssertFalse(RemoteAlarmMapper.shouldDownloadRemoteMessageAudio(makeRemote(messageId: "m1", wakeMode: "voice_only", messageAudioUrl: nil)))
    }

    // MARK: - Helpers

    private func makeRemote(
        messageId: String?,
        wakeMode: String?,
        messageAudioUrl: String? = "https://example.com/message.m4a"
    ) -> RemoteAlarm {
        RemoteAlarm(
            id: "remote",
            time: "07:30",
            repeatDays: [1, 2, 3, 4, 5],
            isActive: true,
            snoozeMinutes: 5,
            mode: nil,
            vibrationPattern: "default",
            wakeMode: wakeMode,
            voiceProfileId: "vp",
            messageId: messageId,
            messageText: "msg",
            category: nil,
            messageAudioUrl: messageId == nil ? nil : messageAudioUrl,
            targetUserId: "me",
            senderUserId: "other",
            senderName: "Other",
            senderEmail: nil,
            isFamilyAlarm: false,
            isReceivedFamilyAlarm: true
        )
    }
}

private extension LocalAlarmRecord {
    func withMessage(_ id: String?) -> LocalAlarmRecord {
        var copy = self
        copy.ttsMessageId = id
        return copy
    }
}
