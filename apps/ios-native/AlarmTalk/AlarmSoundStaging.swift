import Foundation

#if canImport(AVFoundation)
import AVFoundation
#endif

// MARK: - AlarmSoundStaging
//
// AlarmKit `AlertConfiguration.AlertSound.named(_)` 의 lookup 규약 (Apple docs,
// `AlertConfiguration/AlertSound/named(_:)`) 은 다음 위치를 따른다:
//
//   1. 메인 앱 번들 리소스
//   2. 앱 컨테이너의 `Library/Sounds/`
//
// 사용자 목소리 / TTS 캐시는 `AudioCacheStore` 의 App Group 컨테이너 (`audio-cache/`)
// 에 보관되므로 AlarmKit 가 직접 인식하지 못한다. 그래서 본 staging 단계가
// `Library/Sounds/voice-<safeKey>.<ext>` 로 복사 (필요시 트랜스코드) 한 뒤
// "voice-<safeKey>" 라는 base name 만 반환한다. 호출자는 그 base name 을
// `AlertConfiguration.AlertSound.named(_:)` 에 넘기면 된다.
//
// 포맷 정책 (AlarmKit/ActivityKit 의 사운드 허용 포맷은 Apple 의 공식 사운드 정책
// `UNNotificationSound` 와 동등하다고 가정):
//   - 그대로 stage: `.caf`, `.aiff`, `.wav`
//   - 트랜스코드: `.m4a`, `.mp3`, `.aac` → `.caf` (AVAssetExportSession, preset
//     `AVAssetExportPresetAppleM4A` + outputFileType `.caf`)
//   - 그 외: throw `unsupportedFormat`
//
// 실기기에서 트랜스코드가 실패할 가능성을 고려해, 호출자(`AlarmSoundResolver.resolve`)
// 는 staging 이 throw 하면 자동으로 `.cachedAudio` 경로 (in-app fallback) 로 폴백한다.
//
// 30s 한도 (Apple custom sound policy) 는 본 staging 에서도 강제한다.

enum AlarmSoundStagingError: Error, LocalizedError {
    case unsupportedFormat(String)
    case durationExceedsLimit
    case writeFailed(String)
    case avfoundationUnavailable

    var errorDescription: String? {
        switch self {
        case .unsupportedFormat(let ext):
            return "AlarmKit staging: unsupported source extension '\(ext)'."
        case .durationExceedsLimit:
            return "AlarmKit staging: audio exceeds 30s limit."
        case .writeFailed(let reason):
            return "AlarmKit staging: write failed (\(reason))."
        case .avfoundationUnavailable:
            return "AlarmKit staging: AVFoundation unavailable."
        }
    }
}

@MainActor
enum AlarmSoundStaging {

    /// AlarmKit `AlertConfiguration.AlertSound.named(_)` 에 쓸 base 이름 (확장자 제외).
    /// 동일 파일명 prefix.
    static let stagedNamePrefix = "voice-"

    /// 캐시된 오디오를 `Library/Sounds/<stagedNamePrefix><safeKey>.<ext>` 로 복사한다.
    /// 이미 존재하면 재사용. 트랜스코드가 필요한 포맷이면 `.caf` 로 변환을 시도한다.
    /// - Returns: AlarmKit `.named(_)` 에 넘길 base 이름 (확장자 제외).
    @discardableResult
    static func stage(url sourceURL: URL, key: String) throws -> String {
        let fm = FileManager.default
        let soundsDir = try ensureSoundsDirectory()
        let safeKey = AudioCacheStore.safeCacheKey(key)
        let baseName = "\(stagedNamePrefix)\(safeKey)"
        let sourceExt = sourceURL.pathExtension.lowercased()

        // 30초 초과 클립은 passthrough 도 캡(.caf 30s)을 강제한다 — Apple 의 30초 커스텀
        // 사운드 한도를 넘긴 파일을 그대로 stage 하면 .named lookup 이 실패하므로,
        // 길면 무조건 transcodeToCAF 로 첫 30초만 자른다(change 6 belt-and-suspenders).
        let sourceTooLong = isLongerThanLimit(sourceURL)

        let stagedURL: URL
        if isPassthroughFormat(sourceExt) && !sourceTooLong {
            stagedURL = soundsDir.appendingPathComponent("\(baseName).\(sourceExt)")
            if !fm.fileExists(atPath: stagedURL.path) {
                do {
                    try fm.copyItem(at: sourceURL, to: stagedURL)
                } catch {
                    throw AlarmSoundStagingError.writeFailed(error.localizedDescription)
                }
            }
        } else if isTranscodableFormat(sourceExt) || (isPassthroughFormat(sourceExt) && sourceTooLong) {
            #if canImport(AVFoundation)
            stagedURL = soundsDir.appendingPathComponent("\(baseName).caf")
            if !fm.fileExists(atPath: stagedURL.path) {
                try transcodeToCAF(from: sourceURL, to: stagedURL)
            }
            #else
            throw AlarmSoundStagingError.avfoundationUnavailable
            #endif
        } else {
            throw AlarmSoundStagingError.unsupportedFormat(sourceExt)
        }

        return baseName
    }

    /// 소스가 30초(+tolerance)를 넘는지. 측정 불가/AVFoundation 미가용 시 false 로 보아
    /// passthrough 를 막지 않는다(트림은 cacheBytes 단계에서 이미 시도됐을 수 있음).
    private static func isLongerThanLimit(_ url: URL) -> Bool {
        #if canImport(AVFoundation)
        let asset = AVURLAsset(url: url)
        let duration = asset.duration
        guard !duration.isIndefinite else { return false }
        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else { return false }
        let limitSeconds = Double(AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis) / 1000.0
        return seconds > limitSeconds
        #else
        return false
        #endif
    }

    /// 외부 호출자가 cache invalidation 시 정리하기 위한 헬퍼.
    static func clearStagedSound(forKey key: String) {
        let fm = FileManager.default
        guard let soundsDir = try? ensureSoundsDirectory() else { return }
        let safeKey = AudioCacheStore.safeCacheKey(key)
        let baseName = "\(stagedNamePrefix)\(safeKey)"
        let entries = (try? fm.contentsOfDirectory(atPath: soundsDir.path)) ?? []
        for name in entries where name.hasPrefix(baseName) {
            let url = soundsDir.appendingPathComponent(name)
            try? fm.removeItem(at: url)
        }
    }

    // MARK: - Internal helpers

    private static func ensureSoundsDirectory() throws -> URL {
        let fm = FileManager.default
        guard let libURL = fm.urls(for: .libraryDirectory, in: .userDomainMask).first else {
            throw AlarmSoundStagingError.writeFailed("Library directory not found.")
        }
        let soundsDir = libURL.appendingPathComponent("Sounds", isDirectory: true)
        if !fm.fileExists(atPath: soundsDir.path) {
            do {
                try fm.createDirectory(at: soundsDir, withIntermediateDirectories: true)
            } catch {
                throw AlarmSoundStagingError.writeFailed(error.localizedDescription)
            }
        }
        return soundsDir
    }

    private static func isPassthroughFormat(_ ext: String) -> Bool {
        switch ext {
        case "caf", "aiff", "aif", "wav": return true
        default: return false
        }
    }

    private static func isTranscodableFormat(_ ext: String) -> Bool {
        switch ext {
        case "m4a", "mp3", "aac", "mp4": return true
        default: return false
        }
    }

    #if canImport(AVFoundation)
    /// AVAssetExportSession 으로 source → `.caf` 변환. 30s 클립 (AlarmKit 한도) 으로 자른다.
    /// 실패 시 만들다 만 파일을 정리하고 throw 한다.
    private static func transcodeToCAF(from src: URL, to dst: URL) throws {
        let asset = AVURLAsset(url: src)
        let assetDuration = asset.duration
        if assetDuration.isIndefinite {
            throw AlarmSoundStagingError.writeFailed("Indefinite source duration.")
        }
        let seconds = CMTimeGetSeconds(assetDuration)
        // 30초 초과 소스는 reject 하지 않고 아래 timeRange 로 첫 30초만 캡한다(change 6).
        // 트림은 제품 결정이며, 캡 덕분에 staged 파일은 항상 <=30s 라 .named 로 잠금 재생 가능.

        // AppleM4A preset 은 mp3/m4a/aac 입력을 폭넓게 받는다. outputFileType 만 caf 로 지정.
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw AlarmSoundStagingError.writeFailed("AVAssetExportSession init failed.")
        }
        // 손상/비오디오 입력에서는 .caf 가 지원되지 않아 outputFileType 설정 시
        // ObjC 예외(NSInvalidArgumentException)가 던져진다. Swift `try?` 로 못 잡으므로
        // 지원 여부를 먼저 확인해 미지원이면 graceful 하게 throw → 호출부가 in-app 폴백.
        guard exporter.supportedFileTypes.contains(.caf) else {
            throw AlarmSoundStagingError.writeFailed("Output type .caf unsupported for source.")
        }
        exporter.outputFileType = .caf
        exporter.outputURL = dst

        // 30s 한도. 짧으면 source 의 전체 길이를 사용.
        let cappedSeconds = min(seconds, Double(AlarmAudioLimits.maxDurationMillis) / 1000.0)
        let timescale: CMTimeScale = 600
        if cappedSeconds > 0 {
            exporter.timeRange = CMTimeRange(
                start: .zero,
                duration: CMTime(seconds: cappedSeconds, preferredTimescale: timescale)
            )
        }

        // 동기 대기. AlarmKit scheduling 은 사용자 액션 후 즉시 실행이라 짧은 동기 대기 허용.
        let sema = DispatchSemaphore(value: 0)
        exporter.exportAsynchronously { sema.signal() }
        sema.wait()

        if exporter.status != .completed {
            try? FileManager.default.removeItem(at: dst)
            let reason = exporter.error?.localizedDescription ?? "status=\(exporter.status.rawValue)"
            throw AlarmSoundStagingError.writeFailed(reason)
        }
    }
    #endif
}
