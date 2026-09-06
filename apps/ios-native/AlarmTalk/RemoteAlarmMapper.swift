import Foundation

// MARK: - RemoteAlarmMapper
//
// Android 의 `RemoteAlarmMapper.kt` 를 1:1 포팅한다.
// 두 가지 방향을 모두 다룬다.
//   1. `RemoteAlarm` (서버 응답) -> `LocalAlarmRecord` (Android-aligned 로컬 모델)
//   2. `LocalAlarmRecord` -> `RemoteAlarmWriteRequest` (서버 push 본문)
//
// 매핑 규약은 Android 와 동일하게 유지한다.
//   - `targetUserId == currentUserID`  -> origin = `.receivedRemote`
//   - 그 외                              -> origin = `.localOwned`
//   - `wakeMode` 와 로컬 `playMode` 변환은 다음 표를 따른다.
//       * remote "voice_only"         <-> local .voiceOnly
//       * remote "sound_then_voice"   -> local .voiceOnly  (모드 2개화, AlarmEnums 주석 참조)
//       * 그 외 (예: remote nil/모름)  -> local .alarmOnly (서버 알람만 흐름)
//   - `repeat_days` (서버 0..6 배열) <-> `repeatDaysMask` (bit 0=Sun..bit 6=Sat)
//   - `tts_message_id` <-> `ttsMessageId`
//   - 모든 nullable 필드는 안전 디폴트로 보존.
enum RemoteAlarmMapper {

    // MARK: To local

    /// 서버 알람 응답을 로컬 알람 레코드로 변환한다.
    ///
    /// 동기화 흐름에서 호출되며, 신규 import 시 기본값을 채워 줄 책임을 진다.
    /// (existing 레코드와의 머지는 `RemoteAlarmPullSync` 가 담당하므로
    /// 여기서는 순수 변환만 한다.)
    ///
    /// - Parameter currentUserID: 현재 로그인 유저 ID. origin 결정에 사용.
    /// - Parameter nowMillis: 동기화 시각. lastSyncedAtMillis 와 fireAtMillis 계산에 사용.
    /// - Returns: 변환된 레코드. `time` 이 유효하지 않으면 (hour 0..23 / minute 0..59
    ///   범위 밖이거나 파싱 불가) Android `buildLocalAlarm` 과 동일하게 `nil` 을 반환하고
    ///   호출자가 해당 행을 skip 하도록 한다. (07:00 같은 임의 디폴트로 보정하지 않는다.)
    static func toLocalRecord(
        _ remote: RemoteAlarm,
        currentUserID: String,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> LocalAlarmRecord? {
        guard let (hour, minute) = parseTime(remote.time) else { return nil }
        let mask = repeatMask(from: remote.repeatDays)
        let origin = resolveOrigin(remote, currentUserID: currentUserID)
        let playMode = resolvePlayMode(remote)
        let voiceSource = resolveVoiceSource(remote)
        let label = resolveLabel(remote)
        let fireAt: Int64 = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: hour,
            minute: minute,
            repeatDaysMask: mask,
            holidayOff: false,
            nowMillis: nowMillis
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: hour,
            minute: minute,
            referenceMillis: nowMillis
        )

        // 새 import 의 cacheKey 는 messageId 기반 deterministic 키로 잡는다.
        // 동일 messageId 가 재인입되어도 같은 키로 cascade cleanup 이 일관된다.
        let remoteMessageId = remoteMessageIDForAudio(remote)
        let cacheKey: String? = remoteMessageId.map { "remote-message-\($0)" }
        let remoteAudioUri = remoteMessageId == nil ? nil : (
            trimmedOrNil(remote.messageAudioUrl)
        )

        var record = LocalAlarmRecord(
            id: UUID().uuidString,
            label: label,
            hour: hour,
            minute: minute,
            fireAtMillis: fireAt,
            repeatDaysMask: mask,
            holidayOff: false,
            snoozeEnabled: true,
            snoozeMinutes: remote.snoozeMinutes ?? 5,
            snoozeRepeatLimit: SnoozeRepeatLimit.three.rawValue,
            snoozeCount: 0,
            vibrationPattern: remote.vibrationPattern ?? VibrationPattern.default.rawValue,
            playMode: playMode.rawValue,
            defaultAlarmSoundId: DefaultAlarmSounds.bundledDefault,
            localAudioUri: nil,
            audioCacheKey: cacheKey,
            rawAudioUri: remoteAudioUri,
            voiceSource: voiceSource.rawValue,
            voiceProfileId: remoteMessageId == nil ? nil : remote.voiceProfileId,
            voiceText: remoteMessageId == nil ? nil : remote.messageText,
            voiceCategory: remoteMessageId == nil ? nil : remote.category,
            voiceLanguage: nil,
            voiceRandomPrompt: false,
            dynamicVoicePreparedForFireAtMillis: nil,
            voiceRepeat: true,
            voiceVolumePercent: 100,
            ttsMessageId: remoteMessageId,
            remoteAlarmId: remote.id,
            lastSyncedAtMillis: nowMillis,
            // ⚠ **받은 그 자리에서 적는다** — 반영·ACK 성패와 무관하다. 다음 pull 이
            // '내가 이미 받은 그 전달' 과 '발신자가 다시 보낸 것' 을 이 값으로 가른다
            // (`RemoteAlarmPullSync.isResendOfDifferentDelivery`). 서버가 세대를 주지
            // 않으면(옛 서버) nil 로 두어 예전 규칙이 그대로 적용되게 한다.
            observedDeliveryVersion: remote.deliveryVersion?.nilIfBlank,
            syncState: AlarmSyncState.synced.rawValue,
            origin: origin.rawValue,
            alarmVolumePercent: 100,
            alarmSoundUri: nil,
            alarmSoundLabel: nil,
            enabled: remote.isActive ?? true,
            state: (remote.isActive ?? true) ? AlarmRuntimeState.armed.rawValue : AlarmRuntimeState.disabled.rawValue,
            createdAtMillis: nowMillis,
            updatedAtMillis: nowMillis,
            alarmKitID: nil
        )
        // 받은 알람의 테마 식별자. 회전 클립 키는 보낸 사람 기기의 캐시를 가리켜 뜻이
        // 없으므로 **테마 id 만** 건너온다 — 받는 쪽이 이걸로 자기 클립을 묶는다.
        // ⚠ `LocalAlarmRecord` 의 명시적 init 에 `bucketId` 가 **없어서** 생성 뒤에 대입한다.
        // (그 init 이 빠뜨린 것이 iOS 가 이 값을 '로컬 전용' 으로 다뤄 온 실질적 이유다.)
        record.bucketId = trimmedOrNil(remote.bucketId)
        // ⚠ **받은 알람에도 소유자를 새긴다**(감사 지적 — 안드로이드의 절반만 옮겨져 있었다).
        // 안드로이드는 행을 만들 때 `resolveReceivedOwner(existing, currentUserId)` 로
        // **현재 수신자**를 기록하는데(`RemoteAlarmPullSyncService.kt`), iOS 매퍼는 이 값을
        // 아예 세우지 않아 **받은 가족 알람이 언제나 소유자 미기록**이었다.
        // 그 결과가 이 PR 에서 특히 나빴다: 소유자 미기록을 '현재 계정 것' 으로 보는 관용이
        // 파괴적 경로(로그아웃 시 끄기·소유자 새기기)에도 적용되므로, 떠나는 계정의 뒷정리가
        // **지금 쓰는 사람이 받은 알람**을 자기 것으로 낙인찍고 꺼 버릴 수 있었다.
        // 기존 행의 소유자는 머지가 보존한다(`RemoteAlarmPullSync.merge`) — 여기서는
        // 새로 들어오는 행에 지금 계정을 새기는 것이 전부다.
        record.ownerUserId = currentUserID.nilIfBlank
        return record
    }

    // MARK: To remote

    /// 로컬 레코드를 서버 push 본문으로 변환한다.
    ///
    /// Android `RemoteAlarmMapper.toWriteRequest` 와 동일한 규약:
    ///   - ttsMessageId 가 있으면 mode = "tts", 아니면 "sound-only"
    ///   - voiceProfileId 는 voiceSource != localAudio 일 때만 동봉
    ///
    /// ⚠ `rawAudioUrl`/`rawAudioDurationMs`/`speakerId` 는 **보내지 않는다.**
    /// 내 알람 오디오를 R2 에 올려 두던 제3의 경로(`POST /alarm/source`)가 제품에서
    /// 사라졌고 컬럼도 DROP 됐다(마이그레이션 #84, `5bb90de8`). 보내도 무시되며,
    /// 그 값으로 `mode` 를 정하면 **서버가 모르는 음원을 근거로 tts 모드가 되어**
    /// 수신자가 소리 없는 알람을 받는다. 내 알람 녹음은 폰에만 둔다.
    static func toRemoteRequest(_ local: LocalAlarmRecord) -> RemoteAlarmWriteRequest {
        let hasRemoteVoice = local.ttsMessageId != nil
        let messageId = trimmedOrNil(local.ttsMessageId)
        let voiceProfileId = local.voiceSourceEnum == .localAudio ? nil : trimmedOrNil(local.voiceProfileId)

        return RemoteAlarmWriteRequest(
            time: local.timeString,
            repeatDays: repeatDays(fromMask: local.repeatDaysMask),
            snoozeMinutes: local.snoozeMinutes,
            mode: hasRemoteVoice ? "tts" : "sound-only",
            vibrationPattern: local.vibrationPattern,
            wakeMode: local.playModeEnum.remoteWakeMode,
            isActive: local.enabled,
            messageId: messageId,
            voiceProfileId: voiceProfileId,
            targetUserId: nil,
            bucketId: trimmedOrNil(local.bucketId)
        )
    }

    // MARK: Origin

    /// 보낸 사람과 받는 사람을 비교해 alarm 의 origin 을 결정한다.
    ///
    /// - target_user_id == currentUserID         -> .receivedRemote (남이 나에게 보냄)
    /// - 그 외 (sender == me 또는 target nil)    -> .localOwned (내가 만든 알람)
    static func resolveOrigin(_ remote: RemoteAlarm, currentUserID: String) -> AlarmOrigin {
        if let target = remote.targetUserId,
           !target.isEmpty,
           target == currentUserID,
           remote.senderUserId != currentUserID {
            return .receivedRemote
        }
        return .localOwned
    }

    // MARK: Helpers

    /// "HH:mm" 또는 "HH:mm:ss" 시각 문자열을 (hour, minute) 으로 파싱.
    static func parseTime(_ value: String?) -> (Int, Int)? {
        guard let value, !value.isEmpty else { return nil }
        let parts = value.split(separator: ":")
        guard parts.count >= 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              (0...23).contains(hour),
              (0...59).contains(minute) else { return nil }
        return (hour, minute)
    }

    /// 서버의 0..6 배열을 비트 마스크로 변환.
    static func repeatMask(from days: [Int]?) -> Int {
        guard let days else { return 0 }
        return days.filter { (0...6).contains($0) }
            .reduce(0) { acc, day in acc | (1 << day) }
    }

    /// 비트 마스크를 서버의 0..6 배열로 변환.
    static func repeatDays(fromMask mask: Int) -> [Int] {
        (0...6).filter { mask & (1 << $0) != 0 }
    }

    /// `wake_mode` 에 따라 로컬 play mode 를 결정.
    /// 음성 자원이 전혀 없는 알람은 .alarmOnly 로 강등.
    static func resolvePlayMode(_ remote: RemoteAlarm) -> AlarmPlayMode {
        let hasVoice = shouldDownloadRemoteMessageAudio(remote)
        guard hasVoice else { return .alarmOnly }
        switch remote.wakeMode {
        case "voice_only": return .voiceOnly
        case "sound_then_voice", "alarm_voice": return .voiceOnly
        default: return .voiceOnly
        }
    }

    /// 서버에 내려받을 수 있는 음원이 있으면 server_tts, 없으면 local_audio.
    static func resolveVoiceSource(_ remote: RemoteAlarm) -> VoiceSource {
        let hasVoice = shouldDownloadRemoteMessageAudio(remote)
        return hasVoice ? .serverTts : .localAudio
    }

    /// Android `shouldDownloadRemoteMessageAudio` 동일.
    static func shouldDownloadRemoteMessageAudio(_ remote: RemoteAlarm) -> Bool {
        remoteMessageIDForAudio(remote) != nil
    }

    private static func remoteMessageIDForAudio(_ remote: RemoteAlarm) -> String? {
        guard let messageId = trimmedOrNil(remote.messageId),
              trimmedOrNil(remote.messageAudioUrl) != nil else {
            return nil
        }
        return messageId
    }

    private static func trimmedOrNil(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    /// Android `receivedRemoteAlarmLabel(...)` 과 동일한 받은 알람 라벨.
    static func resolveLabel(_ remote: RemoteAlarm) -> String {
        let sender = [remote.senderName, remote.senderEmail]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        guard let sender else { return "상대가 보낸 알람" }
        let displayName = sender.hasSuffix("님") ? sender : "\(sender)님"
        return "\(displayName)이 보낸 알람"
    }
}
