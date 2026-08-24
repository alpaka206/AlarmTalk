import SwiftUI

/// 녹음 카드의 원형 버튼 — **크기를 여기서만 정한다.**
///
/// ⚠ **`.buttonStyle(.borderedProminent)` + `.frame(42)` 로 되돌리지 말 것**(2026-08-16
/// 지적 "마이크 버튼이 불필요하게 크다"). 그 조합은 **라벨**이 42 이고 버튼 스타일이 그
/// 바깥에 패딩을 더해 실제로는 60pt 를 넘었다. 안드로이드는 버튼 자체가 48dp·글리프 26dp 다
/// (`VoiceInputControls`). 여기서는 44pt(아이폰 최소 터치 타깃) 원 + 20pt 글리프로 맞춘다.
struct RecordingCircleButton: View {
    let systemName: String
    let filled: Bool
    let tint: Color
    let onTint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(filled ? onTint : tint)
                .frame(width: 44, height: 44)
                .background(
                    Circle().fill(filled ? tint : tint.opacity(0.12))
                )
        }
        .buttonStyle(.plain)
    }
}


/// **녹음 카드 — 알람 편집기와 목소리 등록이 함께 쓴다.**
///
/// ⚠ **화면마다 새로 만들지 말 것**(2026-08-16 정리). 예전에는 편집기는 이 카드,
/// 목소리 등록은 **지름 100pt 원형 버튼 + 18칸 파형**으로 서로 달랐다 — 같은 일(녹음)을
/// 하는 화면이 두 앱 × 두 화면에서 네 가지 모양이었다.
/// 안드로이드 대응물은 `ui/components/VoiceInputControls.kt` 의 `VoiceRecordControls` 다.
///
/// 왼쪽이 **지금 무슨 상태인지**(제목 + 시간), 오른쪽이 **지금 할 수 있는 동작**이다.
struct RecordingCard: View {
    let isRecording: Bool
    let elapsedMs: Int
    let maxDurationMs: Int
    /// 녹음물이 이미 있는가(방금 녹음했거나 알람에 붙어 있거나).
    let hasRecording: Bool
    let isPreviewing: Bool
    /// 카드 아래 한 줄. **상태를 되풀이하지 말 것** — 제목이 이미 말한다.
    let note: String?
    let onRecord: () -> Void
    let onPreview: (() -> Void)?
    let onRedo: (() -> Void)?

    @Environment(\.voiceAlarmTheme) private var theme

    private var title: String {
        if isRecording { return "녹음 중…" }
        return hasRecording ? "녹음을 저장했어요" : "녹음하기"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(theme.typography.labelLarge)
                    Text("\(HelperFormatters.audioTimeLabel(elapsedMs)) / \(HelperFormatters.audioTimeLabel(maxDurationMs))")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .monospacedDigit()
                }
                Spacer()
                if hasRecording, !isRecording {
                    HStack(spacing: 8) {
                        if let onPreview {
                            RecordingCircleButton(
                                systemName: isPreviewing ? "stop.fill" : "play.fill",
                                filled: true,
                                tint: theme.palette.primary,
                                onTint: theme.palette.onPrimary,
                                action: onPreview
                            )
                            .accessibilityLabel(Text(isPreviewing ? "정지" : "들어보기"))
                        }
                        if let onRedo {
                            RecordingCircleButton(
                                systemName: "arrow.counterclockwise",
                                filled: false,
                                tint: theme.palette.primary,
                                onTint: theme.palette.onPrimary,
                                action: onRedo
                            )
                            .accessibilityLabel(Text("다시 녹음"))
                        }
                    }
                } else {
                    RecordingCircleButton(
                        systemName: isRecording ? "stop.fill" : "mic.fill",
                        filled: true,
                        tint: theme.palette.primary,
                        onTint: theme.palette.onPrimary,
                        action: onRecord
                    )
                    .accessibilityLabel(Text(isRecording ? "녹음 정지" : "녹음 시작"))
                }
            }
            if let note, !note.isEmpty {
                Text(note)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
        }
        .padding(16)
        .background(theme.palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }
}
