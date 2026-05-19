import AVFoundation
import Foundation

/// 임의 시간 구간을 잘라 새 m4a 로 저장하는 헬퍼.
///
/// `SpeakerSeparationFlow` 가 선택된 화자 구간만 추출해 `/voice/clone` 으로 다시
/// 업로드할 때 사용한다. Android `AlarmAudioStore.cacheFromUri(start:duration:)`
/// 가 하는 일을 iOS 에서는 `AVAssetExportSession` 으로 구현.
enum AudioCropper {
    enum CropperError: LocalizedError {
        case sessionUnavailable
        case exportFailed(String)
        case invalidRange

        var errorDescription: String? {
            switch self {
            case .sessionUnavailable: return "오디오 자르기 세션을 만들 수 없어요."
            case .exportFailed(let msg): return "오디오 자르기에 실패했어요: \(msg)"
            case .invalidRange: return "잘라낼 구간이 유효하지 않아요."
            }
        }
    }

    /// `source` 의 `[startMs, endMs)` 구간을 잘라 새 파일로 저장. 결과 URL 을 반환.
    static func crop(source: URL, startMs: Int, endMs: Int) async throws -> URL {
        guard endMs > startMs else { throw CropperError.invalidRange }
        let asset = AVURLAsset(url: source)
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
