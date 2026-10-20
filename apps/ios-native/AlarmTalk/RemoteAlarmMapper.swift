import Foundation

// MARK: - RemoteAlarmMapper
//
// Android 의 `RemoteAlarmMapper.kt` 를 1:1 포팅한다. 내 알람을 서버에 올리는 방향
// (`LocalAlarmRecord` -> `RemoteAlarmWriteRequest`) 하나다 — 서버에서 받아 오는 알람은 없다.
//
// 매핑 규약은 Android 와 동일하게 유지한다.
//   - 로컬 `playMode` -> `wakeMode`: .voiceOnly -> "voice_only", 그 외 -> "sound_then_voice"
//     (모드 2개화, AlarmEnums 주석 참조)
//   - `repeatDaysMask` (bit 0=Sun..bit 6=Sat) -> `repeat_days` (서버 0..6 배열)
//   - `ttsMessageId` -> `message_id`
enum RemoteAlarmMapper {

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
    /// 그 값으로 `mode` 를 정하면 **서버가 모르는 음원을 근거로 tts 모드가 된다.**
    /// 내 알람 녹음은 폰에만 둔다.
    static func toRemoteRequest(_ local: LocalAlarmRecord) -> RemoteAlarmWriteRequest {
        let hasRemoteVoice = local.ttsMessageId != nil
        let messageId = local.ttsMessageId.nilIfBlank
        let voiceProfileId = local.voiceSourceEnum == .localAudio ? nil : local.voiceProfileId.nilIfBlank

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
            bucketId: local.bucketId.nilIfBlank,
            clientAlarmId: local.id,
            // 기본 목소리로 바꿔 둔 알람(무료 잠금 · 잠금 확정 · 목소리를 잃어 미나로 바꾼 알람)은 비어
            // 있는 문구·테마를 서버에서도 지운다 — 안 지우면 클론의 message_id·bucket_id 가 기본 목소리
            // 옆에 남는다(Codex #820). 기본 목소리 + 클론 `greeting` 테마는 토글마다 400 `INVALID_BUCKET_ID` 다.
            // 잠금 확정·미나 전환 뒤에는 보관본이 없어 `hasLockedPaidVoice` 만으로는 못 가린다.
            // 안드로이드 `RemoteAlarmMapper.toWriteRequest` 미러.
            clearsMissingVoiceReferences: local.hasLockedPaidVoice
                || (local.voiceSourceEnum != .localAudio && isSystemVoiceId(local.voiceProfileId))
        )
    }

    // MARK: Helpers

    /// 비트 마스크를 서버의 0..6 배열로 변환.
    static func repeatDays(fromMask mask: Int) -> [Int] {
        (0...6).filter { mask & (1 << $0) != 0 }
    }
}
