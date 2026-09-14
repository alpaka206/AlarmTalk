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
    /// `nonisolated` — 상수라 격리할 상태가 없고, 잠금 안에서 도는
    /// `clearStagedSoundFiles`(메인 밖)가 이 접두사를 읽는다.
    nonisolated static let stagedNamePrefix = "voice-"

    /// 캐시된 오디오를 `Library/Sounds/<stagedNamePrefix><safeKey>.<ext>` 로 복사한다.
    /// 이미 존재하면 재사용. 트랜스코드가 필요한 포맷이면 `.caf` 로 변환을 시도한다.
    /// - Returns: AlarmKit `.named(_)` 에 넘길 base 이름 (확장자 제외).
    /// - Parameter volumePercent: 이 파일에 **구워 넣을** 음량(0~100).
    ///
    ///   ⚠ **iOS 에서 음량을 실을 수 있는 자리는 여기뿐이다.** AlarmKit 은 파일 **이름**만
    ///   받고(`AlertConfiguration.AlertSound.named(_)`), 설정 어디에도 음량 인자가 없다 —
    ///   `AlarmKit.swiftinterface` 전체에서 알람이 받는 것은 `sound:` 하나다. 그래서 예전에는
    ///   목소리 크기 슬라이더가 **잠금화면 알람에 아무 영향이 없었다**(스테이징이 원본을
    ///   그대로 복사했다). in-app 폴백 플레이어에만 게인이 걸렸는데, 그 폴백은 스테이징이
    ///   **실패했을 때만** 도는 경로라 정상 상황에서는 한 번도 쓰이지 않는다.
    @discardableResult
    static func stage(url sourceURL: URL, key: String, volumePercent: Int = 100) throws -> String {
        // ⚠ **굽는 동안 캐시가 갈아끼워지지 않게 한다**(Codex #703 P1). 이걸 열어 두면
        // 옛 바이트를 읽어 굽는 사이에 교체가 지나가고, 그 무효화가 **굽기 전에** 끝나
        // 옛 목소리가 구워진 채로 남는다. 잠금은 `AudioCacheStore` 의 교체 경로와 같은 것이다.
        try AudioCacheStore.withCacheKeyLock(key) {
            try stageLocked(url: sourceURL, key: key, volumePercent: volumePercent)
        }
    }

    private static func stageLocked(url sourceURL: URL, key: String, volumePercent: Int) throws -> String {
        let fm = FileManager.default
        let soundsDir = try ensureSoundsDirectory()
        let safeKey = AudioCacheStore.safeCacheKey(key)
        let gainPercent = max(0, min(100, volumePercent))
        // ⚠ **음량을 이름에 넣는다.** 재사용 판정이 파일 존재 하나뿐이라, 이름이 같으면
        // 슬라이더를 내려도 예전에 구워 둔 큰 소리 파일이 그대로 다시 쓰인다.
        let baseName = gainPercent == 100
            ? "\(stagedNamePrefix)\(safeKey)"
            : "\(stagedNamePrefix)\(safeKey)-v\(gainPercent)"
        let sourceExt = sourceURL.pathExtension.lowercased()

        // 음량이 100 이 아니면 **원본을 그대로 복사할 수 없다** — 샘플값을 줄여야 하므로
        // 포맷과 무관하게 LPCM 으로 다시 쓴다.
        if gainPercent != 100 {
            #if canImport(AVFoundation)
            let stagedURL = soundsDir.appendingPathComponent("\(baseName).caf")
            if !isUsableStagedFile(stagedURL) {
                try? fm.removeItem(at: stagedURL)
                try writeAtomically(into: stagedURL) { tmp in
                    try writeCAF(from: sourceURL, to: tmp, gain: Float(gainPercent) / 100)
                }
            }
            return baseName
            #else
            throw AlarmSoundStagingError.avfoundationUnavailable
            #endif
        }

        // 30초 초과 클립은 passthrough 도 캡(.caf 30s)을 강제한다 — Apple 의 30초 커스텀
        // 사운드 한도를 넘긴 파일을 그대로 stage 하면 .named lookup 이 실패하므로,
        // 길면 무조건 transcodeToCAF 로 첫 30초만 자른다(change 6 belt-and-suspenders).
        let sourceTooLong = isLongerThanLimit(sourceURL)

        let stagedURL: URL
        if isPassthroughFormat(sourceExt) && !sourceTooLong {
            stagedURL = soundsDir.appendingPathComponent("\(baseName).\(sourceExt)")
            if !isUsableStagedFile(stagedURL) {
                try? fm.removeItem(at: stagedURL)
                try writeAtomically(into: stagedURL) { tmp in
                    do {
                        try fm.copyItem(at: sourceURL, to: tmp)
                    } catch {
                        throw AlarmSoundStagingError.writeFailed(error.localizedDescription)
                    }
                }
            }
        } else if isTranscodableFormat(sourceExt) || (isPassthroughFormat(sourceExt) && sourceTooLong) {
            #if canImport(AVFoundation)
            stagedURL = soundsDir.appendingPathComponent("\(baseName).caf")
            if !isUsableStagedFile(stagedURL) {
                try? fm.removeItem(at: stagedURL)
                try writeAtomically(into: stagedURL) { tmp in
                    try transcodeToCAF(from: sourceURL, to: tmp)
                }
            }
            #else
            throw AlarmSoundStagingError.avfoundationUnavailable
            #endif
        } else {
            throw AlarmSoundStagingError.unsupportedFormat(sourceExt)
        }

        return baseName
    }

    /// 최종 경로에 **직접 쓰지 않는다** — 임시 이름으로 만든 뒤 rename 으로 갈아끼운다.
    ///
    /// ⚠ **이게 이 파일에서 가장 중요한 규약이다.** 예전에는 `copyItem`·`AVAssetWriter` 가
    /// 최종 경로에 곧바로 썼다. 둘 다 원자적이지 않아서, 쓰는 도중 앱이 죽으면 **잘린 파일이
    /// 최종 이름으로** 남는다. 그런데 재사용 판정이 `fileExists` 하나뿐이라 그 파일이
    /// 영원히 쓰였고, `.bundledNamed` 는 `requiresInAppFallback == false` 라 인앱 폴백조차
    /// 돌지 않는다 — 결과는 **알람이 뜨는데 소리가 안 나는** 것이고 스스로 복구되지 않는다.
    /// 같은 디렉터리 안의 rename 은 원자적이라, 이제 최종 이름이 보이면 완성된 파일이다.
    private static func writeAtomically(into finalURL: URL, _ body: (URL) throws -> Void) throws {
        let fm = FileManager.default
        let tmpURL = finalURL.deletingLastPathComponent()
            .appendingPathComponent(".staging-\(UUID().uuidString).\(finalURL.pathExtension)")
        defer { try? fm.removeItem(at: tmpURL) }

        try body(tmpURL)

        // 산출물이 쓸 수 있는 것인지 **게시하기 전에** 본다. 여기서 거르면 호출자
        // (`AlarmSoundResolver.resolve`)가 throw 를 받아 `.cachedAudio` 인앱 폴백으로
        // 내려간다 — 무음으로 우는 것보다 낫다.
        guard isUsableStagedFile(tmpURL) else {
            throw AlarmSoundStagingError.writeFailed("staged output is empty or unreadable")
        }

        do {
            try fm.moveItem(at: tmpURL, to: finalURL)
        } catch {
            // 그사이 다른 경로가 같은 이름을 완성해 뒀다면 그걸 그대로 쓴다.
            if isUsableStagedFile(finalURL) { return }
            throw AlarmSoundStagingError.writeFailed(error.localizedDescription)
        }
    }

    /// 이 파일을 알람 사운드로 써도 되는가 — **존재만 보지 않는다.**
    ///
    /// 두 가지를 본다: (1) 바이트가 실제로 들어 있는가(0바이트 캐시가 실재했다),
    /// (2) 오디오로 열려서 길이가 0보다 큰가. (2)가 필요한 이유는 트랜스코드가
    /// **정상 종료로 보이면서 빈 파일**을 낼 수 있어서다 — 소스에 샘플이 없으면
    /// `copyNextSampleBuffer()` 가 곧바로 nil 을 주고 writer 는 `.completed` 로 끝난다.
    private static func isUsableStagedFile(_ url: URL) -> Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return false }
        let size = (try? fm.attributesOfItem(atPath: url.path))?[.size] as? Int64 ?? 0
        guard size > minimumUsableBytes else { return false }

        #if canImport(AVFoundation)
        let asset = AVURLAsset(url: url)
        let duration = asset.duration
        guard !duration.isIndefinite else { return false }
        return CMTimeGetSeconds(duration) > 0
        #else
        return true
        #endif
    }

    /// 헤더만 있고 오디오가 없는 파일을 거르는 하한. CAF/WAV 헤더는 수십 바이트다.
    private static let minimumUsableBytes: Int64 = 512

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

    /// `Library/Sounds` 에 실제로 놓인 **파일 이름(확장자 포함)** 을 돌려준다.
    ///
    /// [stage] 는 확장자 없는 base 이름을 돌려주는데, 알림 사운드 이름 규약은
    /// `UNNotificationSound(named:)` 와 같은 **확장자 포함 파일명**이다
    /// (Apple: "The name of the sound file to use for the alert. Choose a file that's in
    /// your app's main bundle or the `Library/Sounds` folder of your app's data container.").
    /// 확장자는 소스에 따라 `.caf`/`.aiff`/`.wav` 로 갈리므로 이름만으로는 못 만든다 —
    /// 디렉터리에서 실제 파일을 찾아 돌려준다.
    static func stagedFileName(forBaseName baseName: String) -> String? {
        guard let soundsDir = try? ensureSoundsDirectory() else { return nil }
        let entries = (try? FileManager.default.contentsOfDirectory(atPath: soundsDir.path)) ?? []
        return entries.first { ($0 as NSString).deletingPathExtension == baseName }
    }

    /// 외부 호출자가 cache invalidation 시 정리하기 위한 헬퍼.
    static func clearStagedSound(forKey key: String) {
        clearStagedSoundFiles(forKey: key)
    }

    /// `clearStagedSound` 와 같은 일을 하되 **메인 액터 밖에서** 부를 수 있다.
    ///
    /// 캐시 교체는 `AudioCacheStore.withCacheKeyLock` 안에서 일어나는데, 거기서 메인으로
    /// 건너뛰면 무효화가 잠금 밖으로 새어 나가 **다음 staging 뒤에 도착**할 수 있다 —
    /// 그러면 방금 구운 새 목소리를 지우고 옛 소리가 다시 구워진다(Codex #703 P1).
    /// 하는 일은 파일 삭제뿐이라 격리가 필요 없다.
    nonisolated static func clearStagedSoundFiles(forKey key: String) {
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

    private nonisolated static func ensureSoundsDirectory() throws -> URL {
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
        // ⚠ **`m4r` 을 빼지 말 것**(2026-08-16). 기기 벨소리(`/Library/Ringtones`)가
        // 전부 이 확장자다 — MPEG-4 컨테이너 안 AAC 라 `m4a` 와 같은 것이고,
        // `AVAssetReader` 가 그대로 디코드한다. 목록에 없던 시절 실기기 실측에서
        // `unsupportedFormat("m4r")` 로 **전부 거부**됐고, 그러면 사용자가 고른 벨소리가
        // 조용히 기본 알람음으로 울린다(화면이 없는 기능을 광고하는 꼴).
        case "m4a", "m4r", "mp3", "aac", "mp4": return true
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
        let queue = DispatchQueue(label: "com.alarmtalk.app.alarm-sound-staging")
        // append 가 실패해 중간에 접었는지 기록한다 — 아래 완료 판정이 이걸 본다.
        let appendFailed = Mutex(false)
        let appendedAny = Mutex(false)
        input.requestMediaDataWhenReady(on: queue) {
            while input.isReadyForMoreMediaData {
                guard reader.status == .reading, let buffer = output.copyNextSampleBuffer() else {
                    input.markAsFinished()
                    semaphore.signal()
                    return
                }
                if !input.append(buffer) {
                    appendFailed.set(true)
                    reader.cancelReading()
                    input.markAsFinished()
                    semaphore.signal()
                    return
                }
                appendedAny.set(true)
            }
        }
        semaphore.wait()

        let finishSemaphore = DispatchSemaphore(value: 0)
        writer.finishWriting { finishSemaphore.signal() }
        finishSemaphore.wait()

        // ⚠ **`reader.status != .failed` 만 보지 말 것 — 잘린 파일이 통과한다.**
        // append 가 실패하면 위에서 `reader.cancelReading()` 을 부르는데, 그러면 상태가
        // `.cancelled` 이지 `.failed` 가 아니다. writer 는 여기까지 쓴 것으로 정상 종료
        // (`.completed`)하므로, 예전 판정은 **중간에 끊긴 오디오를 완성품으로 채택**했다.
        // 샘플을 하나도 못 붙인 경우(빈 소스)도 같은 이유로 통과해 **무음 파일**이 됐다.
        guard writer.status == .completed,
              reader.status == .completed,
              !appendFailed.get(),
              appendedAny.get() else {
            try? FileManager.default.removeItem(at: dst)
            let reason = writer.error?.localizedDescription
                ?? reader.error?.localizedDescription
                ?? (appendFailed.get() ? "writer input rejected a sample (truncated)"
                    : !appendedAny.get() ? "source produced no audio samples"
                    : "writer status=\(writer.status.rawValue) reader status=\(reader.status.rawValue)")
            throw AlarmSoundStagingError.writeFailed(reason)
        }
    }

    /// 소스를 **게인을 곱해** CAF(16-bit LPCM)로 다시 쓴다. 30초로 자르는 것은 위와 같다.
    ///
    /// ⚠ **위 `transcodeToCAF` 파이프라인에 게인을 끼우지 않은 이유가 있다.** 거기서는
    /// `CMSampleBuffer` 의 블록 버퍼를 직접 건드려야 하는데, 메모리가 연속이라는 보장이
    /// 없어 세그먼트를 따라가야 하고 — **실패해도 파일은 멀쩡히 만들어진다.** 그러면
    /// 알람이 사용자가 줄여 놓은 음량을 무시하고 원래 크기로 울리는데, 그 사실이 어디에도
    /// 드러나지 않는다. `AVAudioFile` 은 디코드된 float 버퍼를 주므로 곱하기 한 번이면 되고,
    /// 열지 못하면 throw 라 호출부가 in-app 폴백으로 내려간다.
    private static func writeCAF(from src: URL, to dst: URL, gain: Float) throws {
        let input: AVAudioFile
        do {
            input = try AVAudioFile(forReading: src)
        } catch {
            throw AlarmSoundStagingError.writeFailed("read: \(error.localizedDescription)")
        }

        let format = input.processingFormat
        let limitFrames = AVAudioFramePosition(
            format.sampleRate * Double(AlarmAudioLimits.maxDurationMillis) / 1000
        )
        let frames = AVAudioFrameCount(max(0, min(limitFrames, input.length)))
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else {
            throw AlarmSoundStagingError.writeFailed("source produced no audio samples")
        }
        do {
            try input.read(into: buffer, frameCount: frames)
        } catch {
            throw AlarmSoundStagingError.writeFailed("decode: \(error.localizedDescription)")
        }

        // 게인은 여기 한 줄이다. 0 이면 무음 파일이 된다 — **파일을 안 만드는 것과 다르다.**
        // 이름이 없으면 AlarmKit 은 `.default` 시스템 톤으로 되돌아가 오히려 소리가 난다.
        if let channels = buffer.floatChannelData {
            for channel in 0..<Int(format.channelCount) {
                let samples = channels[channel]
                for frame in 0..<Int(buffer.frameLength) {
                    samples[frame] *= gain
                }
            }
        }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        do {
            let output = try AVAudioFile(forWriting: dst, settings: settings)
            try output.write(from: buffer)
        } catch {
            throw AlarmSoundStagingError.writeFailed("write: \(error.localizedDescription)")
        }
    }

    /// 트랜스코드 콜백이 다른 큐에서 돌아 값을 되돌려주기 위한 최소 상자.
    private final class Mutex<Value>: @unchecked Sendable {
        private let lock = NSLock()
        private var value: Value
        init(_ value: Value) { self.value = value }
        func get() -> Value { lock.lock(); defer { lock.unlock() }; return value }
        func set(_ newValue: Value) { lock.lock(); value = newValue; lock.unlock() }
    }
    #endif
}
