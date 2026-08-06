import SwiftUI

/// 재생 방식 선택 — **알람 / 목소리** 두 칸 세그먼트.
///
/// 선택 표시는 배경 캡슐 하나가 **미끄러져 옮겨간다**(`matchedGeometryEffect`).
/// 선택지가 둘일 때 카드 두 장은 세로 공간을 두 배로 쓰면서 '둘 중 하나' 라는 사실은
/// 오히려 덜 드러난다 — 캡슐 안에서 움직이면 배타 선택이 형태로 보인다.
/// 설명은 **고른 것만** 아래 한 줄로 둔다(안 고른 쪽 설명을 늘 띄울 이유가 없다).
///
/// ⚠ 모드는 둘뿐이다. '알람 + 목소리' 를 되살리지 말 것 — 이유는 `AlarmPlayMode` 주석 참조.
struct VoicePlayModePicker: View {
    @Binding var mode: AlarmPlayMode
    var voiceLocked: Bool = false
    var onLockedVoiceClick: () -> Void = {}

    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var thumbNamespace

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.xs) {
            HStack(spacing: 0) {
                ForEach(AlarmPlayMode.pickerCases) { option in
                    segment(for: option)
                }
            }
            .padding(4)
            .background(
                Capsule().fill(theme.palette.surfaceVariant.opacity(0.44))
            )
            .overlay(
                Capsule().stroke(theme.palette.outlineVariant.opacity(0.62), lineWidth: 1)
            )

            Text(mode.descriptionText)
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .padding(.top, theme.spacing.xxs)
                .frame(maxWidth: .infinity, alignment: .leading)
                // 두 설명의 길이가 달라 한 줄↔두 줄로 바뀌면 아래 내용이 튄다.
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func segment(for option: AlarmPlayMode) -> some View {
        let selected = option == mode
        let locked = voiceLocked && option != .alarmOnly
        Button {
            commit(option)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: option.iconName)
                    .font(.system(size: 14, weight: .semibold))
                Text(option.label)
                    .font(theme.typography.labelLarge)
                if locked && !selected {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 10, weight: .bold))
                }
            }
            .fontWeight(selected ? .bold : .semibold)
            .foregroundStyle(selected ? theme.palette.onPrimary : theme.palette.onSurfaceVariant)
            .frame(maxWidth: .infinity)
            .padding(.vertical, theme.spacing.sm)
            .background {
                if selected {
                    // 캡슐 하나가 두 칸 사이를 옮겨 다닌다.
                    Capsule()
                        .fill(theme.palette.primary)
                        .matchedGeometryEffect(id: "playModeThumb", in: thumbNamespace)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .opacity(locked && !selected ? 0.62 : 1)
        .accessibilityLabel(Text("재생 방식 \(option.label)"))
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }

    private func commit(_ option: AlarmPlayMode) {
        guard option != mode else { return }
        if voiceLocked && option != .alarmOnly {
            onLockedVoiceClick()
            return
        }
        // 모션을 줄인 사용자에게는 미끄러짐 없이 즉시 전환한다.
        if reduceMotion {
            mode = option
        } else {
            withAnimation(.snappy(duration: 0.28)) { mode = option }
        }
        UISelectionFeedbackGenerator().selectionChanged()
    }
}

// MARK: - Display helpers

extension AlarmPlayMode {
    var iconName: String {
        switch self {
        case .alarmOnly: return "bell.fill"
        case .voiceOnly: return "waveform"
        }
    }

    var descriptionText: String {
        switch self {
        case .alarmOnly:
            return "기본 알람음으로 깨워드려요."
        case .voiceOnly:
            return "선택한 목소리로 부드럽게 깨워드려요."
        }
    }
}

// MARK: - Preview

#if DEBUG
private struct PlayModePickerPreviewHost: View {
    @State private var mode: AlarmPlayMode = .alarmOnly
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("선택: \(mode.label)")
            VoicePlayModePicker(mode: $mode)
        }
        .padding(20)
    }
}

#Preview("VoicePlayModePicker — light") {
    AlarmTalkThemeProvider { PlayModePickerPreviewHost() }
}

#Preview("VoicePlayModePicker — dark") {
    AlarmTalkThemeProvider { PlayModePickerPreviewHost() }
        .preferredColorScheme(.dark)
}
#endif
