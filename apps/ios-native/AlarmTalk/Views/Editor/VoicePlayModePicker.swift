import SwiftUI

/// 알람 재생 방식 3-칸 segmented selector + 모드 설명.
///
/// Android `AlarmEditorControls.kt:262-378` 의 `PlayModeCard` + `PlayModeChip`
/// 대응. 3 모드(`alarm_only` / `voice_only` / `sound_then_voice`) 와
/// `AlarmPlayMode` enum 으로 양방향 바인딩.
struct VoicePlayModePicker: View {
    @Binding var mode: AlarmPlayMode
    var voiceLocked: Bool = false
    var onLockedVoiceClick: () -> Void = {}

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.xs) {
            HStack(spacing: 8) {
                ForEach(AlarmPlayMode.pickerCases) { option in
                    chip(for: option)
                }
            }

            Text(mode.descriptionText)
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .padding(.top, theme.spacing.xxs)
        }
    }

    @ViewBuilder
    private func chip(for option: AlarmPlayMode) -> some View {
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
            .foregroundStyle(
                selected ? theme.palette.onPrimaryContainer : theme.palette.onSurface
            )
            .frame(maxWidth: .infinity)
            .padding(.vertical, theme.spacing.sm + 2)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(
                        selected
                            ? theme.palette.primaryContainer
                            : theme.palette.surfaceVariant.opacity(locked ? 0.28 : 0.44)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(
                        selected
                            ? theme.palette.primary.opacity(0.42)
                            : theme.palette.outlineVariant.opacity(0.62),
                        lineWidth: 1
                    )
            )
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
        mode = option
        UISelectionFeedbackGenerator().selectionChanged()
    }
}

// MARK: - Display helpers

extension AlarmPlayMode {
    var iconName: String {
        switch self {
        case .alarmOnly: return "bell.fill"
        case .voiceOnly: return "waveform"
        case .soundThenVoice: return "bell.and.waves.left.and.right.fill"
        }
    }

    var descriptionText: String {
        switch self {
        case .alarmOnly:
            return "기본 알람음으로만 깨워드려요."
        case .voiceOnly:
            return "선택한 목소리로만 부드럽게 깨워드려요."
        case .soundThenVoice:
            return "먼저 알람음으로 깨우고, 이어서 목소리로 안내해 드려요."
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
