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

/// "이 알람은 무엇을 울리는가" 의 **정체**. 파일을 만들기 전 단계라 값 비교가 싸다.
///
/// ⚠ **이 값이 곧 예약의 지문이다.** 소리를 바꾸는 새 필드가 생기면 [AlarmSoundResolver.plan]
/// 이 그 필드를 읽게 되고, 그러면 지문에 **저절로** 들어온다. 손으로 관리하는
/// '소리에 영향 주는 필드 목록' 을 만들지 말 것 — 그 목록이 낡는 것이 2026-08-18 에
/// 재예약 누락 다섯 건을 만든 원인이다(`fireAtMillis` 는 운세 클립을 고르는 씨앗인데
/// 아무도 그걸 '소리 필드' 로 분류하지 않았다).
enum AlarmSoundPlan: Equatable {
    case voiceClip(cacheKey: String, url: URL, durationMs: Int64, volumePercent: Int)
    case alarmSoundFile(url: URL, stagingKey: String, volumePercent: Int)
    case systemDefault

    /// 예약된 소리와 지금 울려야 할 소리가 같은지 비교하는 값.
    /// 파일 경로·길이는 넣지 않는다 — 같은 클립을 다시 받아도 소리는 그대로다.
    var fingerprint: String {
        switch self {
        case .voiceClip(let key, _, _, let volume): return "voice:\(key):v\(volume)"
        case .alarmSoundFile(let url, _, let volume): return "sound:\(url.path):v\(volume)"
        case .systemDefault: return "default"
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
              let keys = record.bucketClipKeys, !keys.isEmpty,
              // ⚠ **회전 인덱스를 직접 읽지 말 것.** 날씨는 실제 예보로 확정한 자리,
              // 운세는 사주+날짜로 계산한 자리를 쓴다 — 그 둘은 회전하지 않는다.
              // 예전에는 여기서 `bucketRotationIndex` 만 봐서, 날씨 알람이 저장할 때
              // 미리듣던 클립 하나를 **매일 그대로** 재생했다(맑은 날 우산 얘기).
              let index = BucketVariantResolver.variantIndex(for: record) else { return nil }
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

    /// **무엇을 울릴지** 만 정한다 — 파일을 만들지 않는다(순수 조회).
    ///
    /// [resolve] 는 이 결정에 스테이징(트랜스코드·복사)을 얹은 것이다. 둘을 나눠 둔 이유는
    /// **예약이 낡았는지 싸게 판단하기 위해서**다 — `AlarmScheduleReconciler` 가 이 결과의
    /// 지문(`fingerprint`)을 예약할 때 새겨 둔 값과 비교한다. 분기를 여기 한 곳에만 두어야
    /// '판단은 새 소리, 실제 예약은 옛 소리' 로 갈라지지 않는다.
    static func plan(for record: LocalAlarmRecord, audioCache: AudioCacheStore) -> AlarmSoundPlan {
        // 1) voice / sound_then_voice + 캐시 존재
        //
        // ⚠ **무료 테마는 회전·조건으로 고른 클립을 쓴다.** `audioCacheKey` 는 저장할 때
        // 골랐던 그 클립이라, 그것만 보면 매일 같은 문구가 나온다(iOS 가 2026-08-08 전까지
        // 그랬다). 캐시에 없으면 저장 시 키로 폴백한다 — 소리가 사라지면 안 된다.
        if record.playModeEnum != .alarmOnly,
           let key = rotatedBucketClipKey(for: record, audioCache: audioCache) ?? record.audioCacheKey,
           let url = audioCache.cachedURL(for: key) {
            let duration = audioCache.readMetadata(cacheKey: key)?.durationMs ?? 0
            return .voiceClip(cacheKey: key, url: url, durationMs: duration, volumePercent: record.voiceVolumePercent)
        }

        // 2) 사용자가 선택한 시스템/번들 사운드 URI
        if let url = fileURL(forStoredURI: record.alarmSoundUri),
           FileManager.default.fileExists(atPath: url.path) {
            return .alarmSoundFile(url: url, stagingKey: "alarm-\(record.id)", volumePercent: record.alarmVolumePercent)
        }

        // 3) Fallback
        return .systemDefault
    }

    static func resolve(
        for record: LocalAlarmRecord,
        audioCache: AudioCacheStore
    ) -> AlarmSoundResolution {
        switch plan(for: record, audioCache: audioCache) {
        case .voiceClip(let key, let url, let duration, let volumePercent):
            // 길이 초과·측정 불가여도 staging 을 한 번 시도한다 — AlarmSoundStaging 이 첫
            // 30초로 캡하므로 성공하면 `.bundledNamed`(잠금화면에서도 울림)로 승격된다.
            // 트림/transcode 가 진짜로 실패할 때만 in-app 폴백으로 떨어진다.
            if let bundled = try? AlarmSoundStaging.stage(url: url, key: key, volumePercent: volumePercent) {
                return .bundledNamed(stagedAlertName(bundled))
            }
            return .cachedAudio(url, duration)

        case .alarmSoundFile(let url, let stagingKey, let volumePercent):
            if let bundled = try? AlarmSoundStaging.stage(url: url, key: stagingKey, volumePercent: volumePercent) {
                return .bundledNamed(stagedAlertName(bundled))
            }
            return .systemDefault

        case .systemDefault:
            return .systemDefault
        }
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
