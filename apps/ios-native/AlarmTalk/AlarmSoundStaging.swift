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
    /// source → `.caf`(LPCM) 변환. 30초(AlarmKit 한도)로 자른다.
    ///
    /// ⚠ **`AVAssetExportSession` 으로는 안 된다.** 예전에는
    /// `AVAssetExportPresetAppleM4A` + `outputFileType = .caf` 를 썼는데, 그 프리셋의
    /// `supportedFileTypes` 는 **`.m4a` 뿐**이라 `.caf` 가 절대 들어 있지 않다.
    /// 그래서 위의 `supportedFileTypes.contains(.caf)` 가드가 **항상** 걸려
    /// staging 이 매번 실패했고, 호출부가 in-app 폴백으로 떨어졌다 —
    /// 그 폴백은 앱이 떠 있을 때만 도므로 **잠금화면·앱 종료 상태에서 목소리가 아예 안
    /// 울렸다.** (`AlarmSoundStagingCapabilityTests` 가 이걸 시뮬레이터에서 증명한다.)
    ///
    /// 대신 `AVAssetReader` → `AVAssetWriter` 로 직접 쓴다. 컨테이너는 CAF, 샘플은
    /// 16-bit LPCM 이다. Apple 의 커스텀 알림음 규약(`UNNotificationSound`)이 받는
    /// 것이 aiff/wav/caf 이고, 그중 LPCM 이 가장 확실하게 재생된다.
    private static func transcodeToCAF(from src: URL, to dst: URL) throws {
        let asset = AVURLAsset(url: src)
        let assetDuration = asset.duration
        if assetDuration.isIndefinite {
            throw AlarmSoundStagingError.writeFailed("Indefinite source duration.")
        }
        guard let track = asset.tracks(withMediaType: .audio).first else {
            throw AlarmSoundStagingError.writeFailed("No audio track in source.")
        }

        let seconds = CMTimeGetSeconds(assetDuration)
        // 30초 초과 소스는 거절하지 않고 앞 30초만 쓴다 — 잘라서라도 울리는 게 낫다.
        let cappedSeconds = min(seconds, Double(AlarmAudioLimits.maxDurationMillis) / 1000.0)

        let reader: AVAssetReader
        let writer: AVAssetWriter
        do {
            reader = try AVAssetReader(asset: asset)
            writer = try AVAssetWriter(outputURL: dst, fileType: .caf)
        } catch {
            throw AlarmSoundStagingError.writeFailed("reader/writer init: \(error.localizedDescription)")
        }
        if cappedSeconds > 0 {
            reader.timeRange = CMTimeRange(
                start: .zero,
                duration: CMTime(seconds: cappedSeconds, preferredTimescale: 600)
            )
        }

        // 디코드는 LPCM 으로 받고, 그대로 LPCM 으로 쓴다(재인코딩 없음).
        //
        // ⚠ **`AVChannelLayoutKey` 를 빼지 말 것.** AVAssetWriter 로 LPCM 을 쓸 때 채널
        // 레이아웃이 없으면 파일은 만들어지는데 **열리지 않는다**(AVAudioPlayer 가
        // `kAudioFileUnsupportedFileTypeError` 로 거절). 실패가 재생 시점에야 드러나서
        // 잡기 어렵다.
        var monoLayout = AudioChannelLayout()
        monoLayout.mChannelLayoutTag = kAudioChannelLayoutTag_Mono
        let layoutData = Data(bytes: &monoLayout, count: MemoryLayout<AudioChannelLayout>.size)

        let pcmSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVChannelLayoutKey: layoutData,
        ]
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: pcmSettings)
        guard reader.canAdd(output) else {
            throw AlarmSoundStagingError.writeFailed("Reader cannot add PCM output.")
        }
        reader.add(output)

        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: pcmSettings)
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else {
            throw AlarmSoundStagingError.writeFailed("Writer cannot add PCM input.")
        }
        writer.add(input)

        guard writer.startWriting() else {
            try? FileManager.default.removeItem(at: dst)
            throw AlarmSoundStagingError.writeFailed(writer.error?.localizedDescription ?? "startWriting failed")
        }
        writer.startSession(atSourceTime: .zero)
        guard reader.startReading() else {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: dst)
            throw AlarmSoundStagingError.writeFailed(reader.error?.localizedDescription ?? "startReading failed")
        }

        // 동기 대기. AlarmKit 예약은 사용자 액션 직후라 짧은 동기 대기가 허용된다.
        let semaphore = DispatchSemaphore(value: 0)
        let queue = DispatchQueue(label: "com.voicealarm.alarm-sound-staging")
        input.requestMediaDataWhenReady(on: queue) {
            while input.isReadyForMoreMediaData {
                guard reader.status == .reading, let buffer = output.copyNextSampleBuffer() else {
                    input.markAsFinished()
                    semaphore.signal()
                    return
                }
                if !input.append(buffer) {
                    reader.cancelReading()
                    input.markAsFinished()
                    semaphore.signal()
                    return
                }
            }
        }
        semaphore.wait()

        let finishSemaphore = DispatchSemaphore(value: 0)
        writer.finishWriting { finishSemaphore.signal() }
        finishSemaphore.wait()

        guard writer.status == .completed, reader.status != .failed else {
            try? FileManager.default.removeItem(at: dst)
            let reason = writer.error?.localizedDescription
                ?? reader.error?.localizedDescription
                ?? "writer status=\(writer.status.rawValue)"
            throw AlarmSoundStagingError.writeFailed(reason)
        }
    }
    #endif
}
