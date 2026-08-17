import Foundation

#if canImport(AlarmKit)
import AlarmKit
import ActivityKit
#endif

// MARK: - AlarmSoundResolution
//
// Phase 2-B4 — playMode 와 캐싱된 목소리/TTS 의 존재 여부에 따라 어떤 사운드
// 전략을 쓸지 결정한다.
//
// - systemDefault: AlarmKit `.default` 시스템 사운드 사용.
// - bundledNamed: `AlarmSoundStaging.stage(...)` 가 성공하여 `Library/Sounds/<name>.<ext>`
//   에 등록된 사운드를 `AlertConfiguration.AlertSound.named(_)` 로 사용.
// - cachedAudio: AlarmKit 으로는 재생하지 않고 `.default` 로 폴백.
//   호출자(`AlarmKitViewModel.startObserving` 의 ringing 진입 시점)가
//   `AlarmVoicePlayer.shared.playIfNeeded(_:audioCache:)` 로 in-app 재생.
enum AlarmSoundResolution: Equatable {
    case systemDefault
    case bundledNamed(String)
    case cachedAudio(URL, Int64)

    /// in-app fallback (AVAudioPlayer) 가 필요한지 여부.
    var requiresInAppFallback: Bool {
        if case .cachedAudio = self { return true }
        return false
    }

    /// 상태 메시지용 디버그 라벨.
    var debugLabel: String {
        switch self {
        case .systemDefault: return "systemDefault"
        case .bundledNamed(let name): return "bundledNamed(\(name))"
        case .cachedAudio(_, let ms): return "cachedAudio(\(ms)ms)"
        }
    }
}

// MARK: - AlarmSoundResolver
//
// 입력:
//   - LocalAlarmRecord: playMode, audioCacheKey, alarmSoundUri 등
//   - AudioCacheStore: cacheKey → 파일 URL + 메타(durationMs)
//
// 출력:
//   - AlarmSoundResolution: AlarmKit 에 넘길 sound 전략
//
// 규칙 (Android `RingingService.kt:141-197` 의 alarm_only / voice_only /
// sound_then_voice 분기를 iOS 의 AlarmKit 제약 안에서 재현):
//
//   1. playMode != alarm_only 이고 audioCacheKey 가 있고 파일이 존재하면
//      → 30s 이하라면 staging 시도 → 성공 시 .bundledNamed, 실패 시 .cachedAudio
//      → 30s 초과면 .cachedAudio (AlarmKit 으로는 .default 만 울리고 in-app 폴백)
//   2. 그 외에 alarmSoundUri 가 설정되어 있으면 staging 시도 → 실패하면 systemDefault
//   3. 둘 다 아니면 systemDefault
//
// alarmOnly 인 경우 (record.playModeEnum == .alarmOnly):
//   - voice cacheKey 가 있더라도 in-app fallback 을 트리거하면 안 된다.
//   - 다만 alarmSoundUri (사용자가 선택한 시스템 사운드) 가 있으면 그 사운드를
//     staging 한다.
@MainActor
enum AlarmSoundResolver {

    /// AlarmKit sound 전략을 결정한다. 본 함수는 절대 throw 하지 않는다 —
    /// 어떤 단계에서 실패하더라도 가장 보수적인 fallback (.systemDefault 또는
    /// .cachedAudio) 으로 떨어진다.
    /// 무료 테마 알람이 **이번에 쓸** 클립 키. 테마가 아니거나 그 클립이 캐시에 없으면 nil.
    ///
    /// 인덱스는 울린 뒤 `LocalAlarmStore.markStopped` 가 전진시킨다. 여기서는 읽기만 한다 —
    /// 예약할 때마다 돌리면 재예약(시간대 변경·복구)만으로도 문구가 건너뛴다.
    static func rotatedBucketClipKey(
        for record: LocalAlarmRecord,
        audioCache: AudioCacheStore
    ) -> String? {
        guard record.bucketId != nil,
              let keys = record.bucketClipKeys, !keys.isEmpty else { return nil }
        let index = (record.bucketRotationIndex ?? 0) % keys.count
        // 고른 자리의 클립이 아직 안 받아졌으면, 받아진 것 중 아무거나로 대체한다.
        // 소리가 없는 것보다 순서가 어긋나는 편이 낫다(안드로이드도 같은 폴백이다).
        if audioCache.cachedURL(for: keys[index]) != nil { return keys[index] }
        return keys.first { audioCache.cachedURL(for: $0) != nil }
    }

    /// 저장된 알람음 값을 파일 URL 로 읽는다.
    ///
    /// ⚠ **`URL(string:)` 하나로 판단하지 말 것**(2026-08-16 실기기에서 잡음). 알람음
    /// 픽커는 `/Library/Ringtones/Alarm.m4r` 같은 **맨 경로**를 저장하는데,
    /// `URL(string:)` 은 스킴이 없는 그 문자열로 상대 URL 을 만들어 `isFileURL` 이
    /// **false** 가 된다 — 스테이징은 멀쩡히 되는데 판정만 `systemDefault` 로 떨어져
    /// **고른 벨소리가 조용히 기본음으로 울렸다.**
    ///
    /// 안드로이드에서 동기화된 `content://` URI 는 파일이 아니므로 여기서 nil 이 되고,
    /// 그대로 기본음으로 간다(그게 맞다 — 그 파일은 이 기기에 없다).
    static func fileURL(forStoredURI uri: String?) -> URL? {
        guard let uri, !uri.isEmpty else { return nil }
        if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
        guard let url = URL(string: uri), url.isFileURL else { return nil }
        return url
    }

    static func resolve(
        for record: LocalAlarmRecord,
        audioCache: AudioCacheStore
    ) -> AlarmSoundResolution {

        // 1) voice / sound_then_voice + 캐시 존재
        //
        // ⚠ **무료 테마는 회전한 클립을 쓴다.** `audioCacheKey` 는 저장할 때 골랐던 그
        // 클립이라, 그것만 보면 매일 같은 문구가 나온다(iOS 가 2026-08-08 전까지 그랬다).
        // 캐시에 없으면 저장 시 키로 폴백한다 — 회전 때문에 소리가 사라지면 안 된다.
        if record.playModeEnum != .alarmOnly,
           let key = rotatedBucketClipKey(for: record, audioCache: audioCache) ?? record.audioCacheKey,
           let url = audioCache.cachedURL(for: key) {

            let meta = audioCache.readMetadata(cacheKey: key)
            let duration = meta?.durationMs ?? 0
            let withinLimit = duration > 0 &&
                duration <= AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis

            if withinLimit {
                if let bundled = try? AlarmSoundStaging.stage(
                    url: url, key: key, volumePercent: record.voiceVolumePercent
                ) {
                    return .bundledNamed(stagedAlertName(bundled))
                }
                // staging 실패 — in-app 폴백
                return .cachedAudio(url, duration)
            }

            // 길이 초과 또는 측정 불가. 보통은 cacheBytes 단계의 auto-trim 으로 메타가
            // 이미 <=30s 라 이 분기에 오지 않지만, 트림이 발화하지 않았거나 메타가
            // 갱신되지 않은 경우를 대비해 staging 을 한 번 시도한다 — AlarmSoundStaging 이
            // 첫 30초로 캡하므로 성공하면 .bundledNamed(잠금 시에도 울림)로 승격된다(change 6).
            // 트림/transcode 가 진짜로 실패할 때만 .cachedAudio in-app 폴백으로 떨어진다.
            if let bundled = try? AlarmSoundStaging.stage(
                url: url, key: key, volumePercent: record.voiceVolumePercent
            ) {
                return .bundledNamed(stagedAlertName(bundled))
            }
            return .cachedAudio(url, duration)
        }

        // 2) 사용자가 선택한 시스템/번들 사운드 URI
        if let url = fileURL(forStoredURI: record.alarmSoundUri),
           FileManager.default.fileExists(atPath: url.path),
           let bundled = try? AlarmSoundStaging.stage(
               url: url, key: "alarm-\(record.id)", volumePercent: record.alarmVolumePercent
           ) {
            return .bundledNamed(stagedAlertName(bundled))
        }

        // 3) Fallback
        return .systemDefault
    }

    /// `.named(_)` 에 넘길 이름을 **확장자 포함 파일명**으로 맞춘다.
    ///
    /// 알림 사운드 이름 규약은 `UNNotificationSound(named:)` 와 같은 파일명이다.
    /// 확장자 없는 base 이름을 넘기면 lookup 이 빗나가 **기본 알람음으로 폴백**한다 —
    /// 그러면 목소리로 맞춘 알람이 톤으로 울리고, 우리 코드는 성공한 줄 안다.
    /// 파일을 못 찾으면 base 이름을 그대로 쓴다(지금까지의 동작).
    private static func stagedAlertName(_ baseName: String) -> String {
        AlarmSoundStaging.stagedFileName(forBaseName: baseName) ?? baseName
    }

    #if canImport(AlarmKit)
    /// 결정된 resolution 을 AlarmKit 의 `AlertConfiguration.AlertSound` 로 변환한다.
    /// `.cachedAudio` 는 in-app 폴백 경로이므로 OS 알람음은 `.default` 로 둔다.
    /// `nonisolated` — 순수 변환 함수라서 enum 의 @MainActor 격리에 묶일 필요가 없고,
    /// `AlarmKitViewModel.makeConfiguration`(nonisolated) 가 호출해야 하므로.
    nonisolated static func makeAlertSound(_ resolution: AlarmSoundResolution) -> AlertConfiguration.AlertSound {
        switch resolution {
        case .systemDefault:
            return .default
        case .bundledNamed(let name):
            return .named(name)
        case .cachedAudio:
            return .default
        }
    }
    #endif
}
