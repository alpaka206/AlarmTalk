import SwiftUI
import UIKit

/// 12 종 진동 패턴 선택용 dropdown + 미리듣기 버튼.
///
/// Android 의 `VibrationPatternLibrary.waveform(...)` 가 사용하는 ms 시퀀스를
/// iOS `UIImpactFeedbackGenerator` 의 펄스 시퀀스로 근사한다. (Core Haptics 의
/// 풀 envelope 패턴은 별도 엔진 셋업이 필요해 본 picker 범위에서는 다루지
/// 않는다.) Android `AlarmSettingsCard.kt:90-103` 의 라벨/정렬을 그대로 차용.
struct VibrationPatternPicker: View {
    @Binding var selected: VibrationPattern

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        HStack(spacing: 12) {
            Menu {
                ForEach(VibrationPattern.allCases, id: \.self) { pattern in
                    Button {
                        commit(pattern)
                    } label: {
                        if pattern == selected {
                            Label(pattern.displayName, systemImage: "checkmark")
                        } else {
                            Text(pattern.displayName)
                        }
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(selected.displayName)
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurface)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .padding(.horizontal, theme.spacing.sm)
                .padding(.vertical, theme.spacing.xs)
                .background(
                    RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                        .fill(theme.palette.surfaceVariant.opacity(0.46))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                        .stroke(theme.palette.outlineVariant, lineWidth: 1)
                )
            }
            .accessibilityLabel(Text("진동 패턴, 현재 \(selected.displayName)"))

            Button {
                preview(selected)
            } label: {
                Image(systemName: "waveform")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(theme.palette.onPrimaryContainer)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(theme.palette.primaryContainer))
            }
            .buttonStyle(.plain)
            .disabled(selected == .none)
            .opacity(selected == .none ? 0.42 : 1.0)
            .accessibilityLabel(Text("진동 미리듣기"))
        }
    }

    private func commit(_ pattern: VibrationPattern) {
        guard pattern != selected else { return }
        selected = pattern
        preview(pattern)
    }

    private func preview(_ pattern: VibrationPattern) {
        VibrationHapticPreview.play(pattern)
    }
}

// MARK: - Display labels

extension VibrationPattern {
    /// Android `VibrationOptions` 라벨 그대로 (한국어 폴백 동반).
    var displayName: String {
        switch self {
        case .default: return "기본"
        case .strong: return "강함"
        case .short: return "짧게"
        case .medium: return "보통"
        case .heartbeat: return "심장박동"
        case .ticktock: return "똑딱똑딱"
        case .waltz: return "왈츠"
        case .zigzag: return "지그재그"
        case .offBeat: return "오프비트"
        case .ripple: return "물결"
        case .siren: return "사이렌"
        case .none: return "없음"
        }
    }
}

// MARK: - Haptic preview

/// Android `VibrationPatternLibrary.waveform` 의 ms 시퀀스를 iOS 햅틱으로 대체.
///
/// Android 의 waveform 시퀀스는 `[delay, on, off, on, ...]` 형식이라
/// 본 헬퍼는 짝수 인덱스(on time) 만 시간 오프셋 누적 시점으로 사용해
/// `UIImpactFeedbackGenerator` 펄스를 발사한다.
enum VibrationHapticPreview {
    static func play(_ pattern: VibrationPattern) {
        guard pattern != .none else { return }
        let descriptor = descriptor(for: pattern)
        let generator = UIImpactFeedbackGenerator(style: descriptor.style)
        generator.prepare()

        var offset: TimeInterval = 0
        for (index, ms) in descriptor.timing.enumerated() {
            // 짝수 index = 대기 (delay/off), 홀수 index = on (실제 진동 펄스).
            if index % 2 == 1 {
                let fire = offset
                DispatchQueue.main.asyncAfter(deadline: .now() + fire) {
                    generator.impactOccurred(intensity: descriptor.intensity)
                }
            }
            offset += TimeInterval(ms) / 1000.0
        }
    }

    private struct Descriptor {
        let style: UIImpactFeedbackGenerator.FeedbackStyle
        let intensity: CGFloat
        /// `[delay, on, off, on, off, ...]` (Android waveform 그대로).
        let timing: [Int]
    }

    private static func descriptor(for pattern: VibrationPattern) -> Descriptor {
        switch pattern {
        case .default:
            return Descriptor(style: .medium, intensity: 0.9,
                              timing: [0, 700, 350, 900])
        case .strong:
            return Descriptor(style: .heavy, intensity: 1.0,
                              timing: [0, 1_000, 240, 1_000, 240])
        case .short:
            return Descriptor(style: .light, intensity: 0.8,
                              timing: [0, 260, 520])
        case .medium:
            return Descriptor(style: .medium, intensity: 0.9,
                              timing: [0, 560, 420])
        case .heartbeat:
            return Descriptor(style: .medium, intensity: 0.85,
                              timing: [0, 120, 120, 240, 580])
        case .ticktock:
            return Descriptor(style: .light, intensity: 0.7,
                              timing: [0, 90, 210, 90, 620])
        case .waltz:
            return Descriptor(style: .medium, intensity: 0.85,
                              timing: [0, 280, 140, 150, 140, 150, 620])
        case .zigzag:
            return Descriptor(style: .medium, intensity: 0.9,
                              timing: [0, 110, 100, 180, 100, 280, 520])
        case .offBeat:
            return Descriptor(style: .medium, intensity: 0.85,
                              timing: [0, 80, 260, 240, 150, 110, 560])
        case .ripple:
            return Descriptor(style: .light, intensity: 0.7,
                              timing: [0, 90, 110, 160, 130, 260, 620])
        case .siren:
            return Descriptor(style: .heavy, intensity: 1.0,
                              timing: [0, 240, 110, 240, 110, 520, 360])
        case .none:
            return Descriptor(style: .light, intensity: 0.0, timing: [])
        }
    }
}

// MARK: - Preview

#if DEBUG
private struct VibrationPickerPreviewHost: View {
    @State private var pattern: VibrationPattern = .default
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("선택: \(pattern.displayName)")
            VibrationPatternPicker(selected: $pattern)
        }
        .padding(20)
    }
}

#Preview("VibrationPatternPicker — light") {
    AlarmTalkThemeProvider { VibrationPickerPreviewHost() }
}

#Preview("VibrationPatternPicker — dark") {
    AlarmTalkThemeProvider { VibrationPickerPreviewHost() }
        .preferredColorScheme(.dark)
}
#endif
