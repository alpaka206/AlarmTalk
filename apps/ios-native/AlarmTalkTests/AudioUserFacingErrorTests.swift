import Foundation
import UniformTypeIdentifiers
import XCTest
@testable import AlarmTalk

final class AudioUserFacingErrorTests: XCTestCase {
    func test_userFacingMessagePreservesKoreanError() {
        let error = NSError(
            domain: "test",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "오디오 길이를 확인하지 못했어요."]
        )

        XCTAssertEqual(
            AudioUserFacingError.message(for: error, fallback: "fallback"),
            "오디오 길이를 확인하지 못했어요."
        )
    }

    func test_userFacingMessageFallsBackForEnglishSystemError() {
        let error = NSError(
            domain: NSCocoaErrorDomain,
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "The file could not be opened."]
        )

        XCTAssertEqual(
            AudioUserFacingError.message(for: error, fallback: "선택한 음성을 준비하지 못했어요."),
            "선택한 음성을 준비하지 못했어요."
        )
    }

    func test_cropperExportFailureDoesNotExposeSystemDetail() {
        XCTAssertEqual(
            AudioCropper.CropperError.exportFailed("AVFoundation failed").errorDescription,
            "선택한 구간을 오디오 파일로 자르지 못했어요. 시작점을 조금 조정하거나 다른 파일로 다시 시도해 주세요."
        )
    }

    func test_audioCacheErrorsUseKoreanCopy() {
        XCTAssertEqual(AudioCacheError.invalidBase64.errorDescription, "음성 오디오를 해석하지 못했어요.")
        XCTAssertEqual(
            AudioCacheError.durationExceedsLimit(30_000).errorDescription,
            "음성은 최대 30초까지 사용할 수 있어요."
        )
    }

    func test_profileTrainingPickerAcceptsAudioAndMovie() {
        XCTAssertTrue(VoiceImportContentTypes.profileTraining.contains(.audio))
        XCTAssertTrue(VoiceImportContentTypes.profileTraining.contains(.movie))
    }

    func test_audioCropperExportsFullVideoAsAudioOnlyBeforeUpload() {
        let videoURL = URL(fileURLWithPath: "/tmp/clip.mp4")
        let audioURL = URL(fileURLWithPath: "/tmp/clip.m4a")

        XCTAssertTrue(AudioCropper.shouldExportAudioOnly(
            source: videoURL,
            startMs: 0,
            endMs: 90_000,
            sourceDurationMs: 90_000
        ))
        XCTAssertFalse(AudioCropper.shouldExportAudioOnly(
            source: audioURL,
            startMs: 0,
            endMs: 90_000,
            sourceDurationMs: 90_000
        ))
        XCTAssertTrue(AudioCropper.shouldExportAudioOnly(
            source: audioURL,
            startMs: 10_000,
            endMs: 90_000,
            sourceDurationMs: 120_000
        ))
    }
}
