import Foundation

#if canImport(AlarmKit)
import AlarmKit
#endif

// MARK: - AlarmSoundResolution
//
// Phase 2-B4 — playMode 와 캐싱된 보이스/TTS 의 존재 여부에 따라 어떤 사운드
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
    static func resolve(
        for record: LocalAlarmRecord,
        audioCache: AudioCacheStore
    ) -> AlarmSoundResolution {

        // 1) voice / sound_then_voice + 캐시 존재
        if record.playModeEnum != .alarmOnly,
           let key = record.audioCacheKey,
           let url = audioCache.cachedURL(for: key) {

            let meta = audioCache.readMetadata(cacheKey: key)
            let duration = meta?.durationMs ?? 0
            let withinLimit = duration > 0 &&
                duration <= AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis

            if withinLimit {
                if let bundled = try? AlarmSoundStaging.stage(url: url, key: key) {
                    return .bundledNamed(bundled)
                }
                // staging 실패 — in-app 폴백
                return .cachedAudio(url, duration)
            }

            // 길이 초과 또는 측정 불가 — in-app 폴백
            return .cachedAudio(url, duration)
        }

        // 2) 사용자가 선택한 시스템/번들 사운드 URI
        if let uriString = record.alarmSoundUri,
           !uriString.isEmpty,
           let url = URL(string: uriString),
           url.isFileURL,
           FileManager.default.fileExists(atPath: url.path),
           let bundled = try? AlarmSoundStaging.stage(url: url, key: "alarm-\(record.id)") {
            return .bundledNamed(bundled)
        }

        // 3) Fallback
        return .systemDefault
    }

    #if canImport(AlarmKit)
    /// 결정된 resolution 을 AlarmKit 의 `AlertConfiguration.AlertSound` 로 변환한다.
    /// `.cachedAudio` 는 in-app 폴백 경로이므로 OS 알람음은 `.default` 로 둔다.
    static func makeAlertSound(_ resolution: AlarmSoundResolution) -> AlertConfiguration.AlertSound {
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
