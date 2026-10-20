import SwiftUI

// AlarmEditorSheet 에서 분리한 에디터 하위 컴포넌트/헬퍼 모음.
// 동작/디자인 변경 없음 — 동일 모듈 내 internal 로 가시성만 조정해 파일만 분리.

struct CachedLocalAlarmAudio {
    let fileName: String
    let cacheKey: String
}

enum LocalAlarmAudioError: LocalizedError {
    case missingSource
    case tooShort
    case tooLong

    var errorDescription: String? {
        switch self {
        case .missingSource:
            return String(localized: "녹음하거나 파일을 선택해 주세요.")
        case .tooShort:
            return String(localized: "1초 이상 들리는 음성이 필요해요.")
        case .tooLong:
            return String(localized: "알람 음성은 최대 \(AlarmAudioLimits.maxDurationMillis / 1000)초까지 사용할 수 있어요.")
        }
    }
}

struct LocalAlarmAudioEditor: View {
    let isRecording: Bool
    let elapsedMs: Int
    let hasRecording: Bool
    let existingAudioLabel: String?
    let isPreviewing: Bool
    let message: String?
    let onRecord: () -> Void
    let onPreview: () -> Void
    let onClear: () -> Void

    private var sourceReady: Bool { hasRecording || existingAudioLabel != nil }

    var body: some View {
        // ⚠ **알람 편집기에는 파일 업로드가 없다 — 녹음뿐이다**(2026-08-11 정리).
        // 안드로이드 알람 편집기에는 처음부터 파일 선택 런처가 없고, iOS 에만
        // '녹음/파일' 세그먼트가 남아 있었다. 입력 방식·파일·크롭 상태도 그때 함께 걷어냈다.
        //
        // ⚠ **녹음 카드를 여기서 다시 그리지 말 것** — `RecordingCard` 하나를
        // 목소리 등록 화면과 함께 쓴다(2026-08-16 정리).
        RecordingCard(
            isRecording: isRecording,
            elapsedMs: elapsedMs,
            maxDurationMs: Int(AlarmAudioLimits.maxDurationMillis),
            hasRecording: sourceReady,
            isPreviewing: isPreviewing,
            // 카드 제목이 이미 상태를 말한다 — 남기는 건 아직 아무것도 없고 녹음 중도
            // 아닐 때뿐이다(마이크 권한 거부처럼 달리 나타나지 않는 사실).
            note: (isRecording || sourceReady) ? existingNote : (message ?? existingNote),
            onRecord: onRecord,
            onPreview: onPreview,
            onRedo: onClear
        )
    }

    /// 알람에 이미 붙어 있는 오디오 이름 — 방금 녹음한 것이 없을 때만 알린다.
    private var existingNote: String? {
        hasRecording ? nil : existingAudioLabel
    }
}

// ⚠ **`VoiceRepeatEditor` / `VoiceVolumeEditor` 를 되살리지 말 것**(2026-08-07 삭제).
// 편집기 본문에 반복 세그먼트와 음량 슬라이더를 펼쳐 두던 뷰들이다. 안드로이드는 둘 다
// '목소리 크기' 행이 여는 상세(`VoiceOutputSettingsPane`)에만 두고, 본문에는 요약 행
// 하나만 낸다. 인라인으로 두면 세부 설정의 '음성 출력' 행과 합쳐 같은 값을 바꾸는 자리가
// 셋이 됐다. 삭제 시점의 `VoiceVolumeEditor` 는 하한도 30% 로 잘못 잡고 있었다(규약은 10%).

extension VoiceProfile {
    var isReadyForAlarmSelection: Bool {
        (status == nil || status == "ready") && isDraft != true
    }
}

#if DEBUG
#Preview("AlarmEditorSheet — create (light)") {
    NavigationStack {
        AlarmEditorSheet(
            target: .create(),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("AlarmEditorSheet — create (dark)") {
    NavigationStack {
        AlarmEditorSheet(
            target: .create(),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}

#Preview("AlarmEditorSheet — edit existing") {
    NavigationStack {
        AlarmEditorSheet(
            target: .edit("preview-existing"),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}
#endif
