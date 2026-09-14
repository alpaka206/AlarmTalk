import AVFoundation
import Foundation

/// 임의 시간 구간을 잘라 새 m4a 로 저장하는 헬퍼.
///
/// `VoiceCloneUploadFlow` 가 선택 구간만 추출해 `/voice/clone` 으로
/// 업로드할 때 사용한다. Android `AlarmAudioStore.cacheFromUri(start:duration:)`
/// 가 하는 일을 iOS 에서는 `AVAssetExportSession` 으로 구현.
enum AudioCropper {
    private static let videoFileExtensions: Set<String> = [
        "3g2",
        "3gp",
        "avi",
        "m4v",
        "mov",
        "mp4",
        "mpeg",
        "mpg",
        "webm",
    ]

    enum CropperError: LocalizedError {
        case sessionUnavailable
        case exportFailed(String)
        case invalidRange
        case noAudioTrack

        var errorDescription: String? {
            switch self {
            case .sessionUnavailable: return "오디오 자르기 세션을 만들 수 없어요."
            case .exportFailed:
                return "선택한 구간을 오디오 파일로 자르지 못했어요. 시작점을 조금 조정하거나 다른 파일로 다시 시도해 주세요."
            case .invalidRange: return "잘라낼 구간이 유효하지 않아요."
            case .noAudioTrack: return "선택한 파일에서 오디오를 찾지 못했어요. 다른 파일로 시도해 주세요."
            }
        }
    }

    static func shouldExportAudioOnly(source: URL, startMs: Int, endMs: Int, sourceDurationMs: Int) -> Bool {
        let normalizedExtension = source.pathExtension.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return startMs > 0 ||
            endMs < sourceDurationMs ||
            videoFileExtensions.contains(normalizedExtension)
    }

    /// `source` 의 `[startMs, endMs)` 구간을 잘라 새 파일로 저장. 결과 URL 을 반환.
    static func crop(source: URL, startMs: Int, endMs: Int) async throws -> URL {
        guard endMs > startMs else { throw CropperError.invalidRange }
        let asset = AVURLAsset(url: source)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        guard !audioTracks.isEmpty else { throw CropperError.noAudioTrack }
        let start = CMTime(value: CMTimeValue(startMs), timescale: 1_000)
        let duration = CMTime(value: CMTimeValue(max(1, endMs - startMs)), timescale: 1_000)
        let range = CMTimeRange(start: start, duration: duration)

        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw CropperError.sessionUnavailable
        }
        let outURL = makeOutputURL()
        exporter.outputURL = outURL
        exporter.outputFileType = .m4a
        exporter.timeRange = range

        return try await withCheckedThrowingContinuation { continuation in
            exporter.exportAsynchronously {
                switch exporter.status {
                case .completed:
                    continuation.resume(returning: outURL)
                case .failed, .cancelled:
                    continuation.resume(throwing: CropperError.exportFailed(exporter.error?.localizedDescription ?? "unknown"))
                default:
                    continuation.resume(throwing: CropperError.exportFailed("status=\(exporter.status.rawValue)"))
                }
            }
        }
    }

    private static func makeOutputURL() -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VoiceCrop", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("crop-\(UUID().uuidString).m4a")
    }
}
