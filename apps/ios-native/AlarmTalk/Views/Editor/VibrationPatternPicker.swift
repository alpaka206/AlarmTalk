import SwiftUI
import UIKit

/// 12 종 진동 패턴 선택용 dropdown + 미리듣기 버튼.
///
/// Android 의 `VibrationPatternLibrary.waveform(...)` 가 사용하는 ms 시퀀스를
/// iOS `UIImpactFeedbackGenerator` 의 펄스 시퀀스로 근사한다. (Core Haptics 의
/// 풀 envelope 패턴은 별도 엔진 셋업이 필요해 본 picker 범위에서는 다루지
/// 않는다.) Android `AlarmSettingsCard.kt:90-103` 의 라벨/정렬을 그대로 차용.
///
/// 정직한 한계: iOS 에서 알람이 울릴 때의 진동은 AlarmKit 이 소유하는 *시스템
/// 알람 진동* 이다 — 시스템 알람음이 울리는 동안 임의의 진동 패턴을 반복시키는
/// 공개 API 가 없다. 따라서 이 picker 는 사용자의 *의도 저장 + 미리듣기* 용도이며,
/// 미리듣기 펄스는 위 햅틱 근사로만 재생된다. 실제 OS 알람 진동 패턴을 바꾸지
/// 못한다. (Android 는 자체 ringing 을 소유해 패턴을 실제로 적용하지만, iOS 는
/// 그 동등성을 갖지 못한다.)
struct VibrationPatternPicker: View {
    @Binding var selected: VibrationPattern

    @Environment(\.voiceAlarmTheme) private var theme

    /// 컨트롤(드롭다운 + 미리듣기 버튼)만 그린다. 안내 캡션은 호출부가 행 아래
    /// 전체 너비로 배치하므로(레이아웃이 HStack 행 안에서 줄바꿈되지 않도록) 여기서는
    /// 포함하지 않는다. 캡션 문구는 `Self.usageCaption` 으로 노출한다.
    var body: some View {
        HStack(spacing: 12) {
            Menu {
                // '없음'(.none) 은 목록에서 제외한다 — 진동 on/off 는 호출부의 토글이
                // 담당한다 (Android `AlarmSettingsCard.kt:459` VibrationOptions 가 NONE 제외).
                ForEach(VibrationPattern.allCases.filter { $0 != .none }, id: \.self) { pattern in
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

    /// 행 아래 전체 너비로 보여줄 안내 문구. iOS 알람 진동의 정직한 한계를 알린다.
    static let usageCaption = "미리듣기/선택용입니다. 실제 알람 진동은 iOS 시스템 알람 진동으로 울립니다."

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
    /// Android `AlarmSettingsCard.kt:70-82` 의 `VibrationOptions` 영문 라벨과 1:1 일치시킨다.
    /// (.none 은 패턴 목록에서 제외되며 on/off 토글로 끄므로 'Off' 표기만 둔다.)
    var displayName: String {
        switch self {
        case .default: return "Basic call"
        case .strong: return "Strong"
        case .short: return "Short"
        case .medium: return "Medium"
        case .heartbeat: return "Heartbeat"
        case .ticktock: return "Ticktock"
        case .waltz: return "Waltz"
        case .zigzag: return "Zig-zig-zig"
        case .offBeat: return "Off-beat"
        case .ripple: return "Ripple"
        case .siren: return "Siren"
        case .rise: return "Rise"
        case .pulse: return "Pulse"
        case .bounce: return "Bounce"
        case .drumroll: return "Drumroll"
        case .soft: return "Soft"
        case .sos: return "SOS"
        case .none: return "Off"
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
        // 약하게 시작해 점점 세지는 웨이크업 램프 — 잠결에 놀라지 않게 깨운다.
        case .rise:
            return Descriptor(style: .medium, intensity: 0.9,
                              timing: [0, 220, 110, 220, 110, 280, 110, 380, 130, 520, 700])
        // 여림-세게가 번갈아 오는 이중 맥동.
        case .pulse:
            return Descriptor(style: .medium, intensity: 0.9,
                              timing: [0, 420, 200, 420, 620])
        // 튀는 공처럼 세게 시작해 점점 잦아드는 감쇠 바운스.
        case .bounce:
            return Descriptor(style: .heavy, intensity: 1.0,
                              timing: [0, 110, 80, 110, 80, 110, 80, 110, 520])
        // 빠른 연타가 점점 세지는 드럼롤.
        case .drumroll:
            return Descriptor(style: .light, intensity: 0.8,
                              timing: [0, 60, 55, 60, 55, 60, 55, 70, 55, 90, 55, 130, 45, 220, 640])
        // 낮은 세기의 긴 울림 — 조용한 환경용.
        case .soft:
            return Descriptor(style: .light, intensity: 0.5,
                              timing: [0, 900, 520])
        // 모스 부호 SOS(··· ——— ···).
        case .sos:
            return Descriptor(style: .medium, intensity: 0.95,
                              timing: [0, 120, 120, 120, 120, 120, 260,
                                       360, 140, 360, 140, 360, 260,
                                       120, 120, 120, 120, 120, 780])
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
