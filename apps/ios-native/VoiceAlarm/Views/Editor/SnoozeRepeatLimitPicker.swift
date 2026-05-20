import SwiftUI

/// 스누즈 반복 횟수(3 / 5 / 무제한) segmented selector.
///
/// Android `AlarmSettingsCard.kt` 의 `snoozeRepeatLabel` 3종을 칩 행으로
/// 재현. `SnoozeRepeatLimit` 의 raw value(`0/3/5`) 와 양방향 바인딩한다.
struct SnoozeRepeatLimitPicker: View {
    @Binding var limit: SnoozeRepeatLimit

    @Environment(\.voiceAlarmTheme) private var theme

    private let options: [SnoozeRepeatLimit] = [.three, .five, .unlimited]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(options, id: \.self) { option in
                let selected = option == limit
                Button {
                    commit(option)
                } label: {
                    Text(option.shortLabel)
                        .font(theme.typography.labelLarge)
                        .fontWeight(selected ? .bold : .semibold)
                        .foregroundStyle(
                            selected ? theme.palette.onPrimaryContainer : theme.palette.onSurface
                        )
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, theme.spacing.sm)
                        .background(
                            RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                                .fill(
                                    selected
                                        ? theme.palette.primaryContainer
                                        : theme.palette.surfaceVariant.opacity(0.46)
                                )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                                .stroke(
                                    selected
                                        ? theme.palette.primary.opacity(0.42)
                                        : theme.palette.outlineVariant,
                                    lineWidth: 1
                                )
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("스누즈 반복 \(option.fullLabel)"))
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
    }

    private func commit(_ option: SnoozeRepeatLimit) {
        guard option != limit else { return }
        limit = option
        UISelectionFeedbackGenerator().selectionChanged()
    }
}

// MARK: - Labels

extension SnoozeRepeatLimit {
    var shortLabel: String {
        switch self {
        case .three: return "3회"
        case .five: return "5회"
        case .unlimited: return "무제한"
        }
    }

    var fullLabel: String {
        switch self {
        case .three: return "3회"
        case .five: return "5회"
        case .unlimited: return "무제한"
        }
    }
}

// MARK: - Preview

#if DEBUG
private struct SnoozeLimitPreviewHost: View {
    @State private var limit: SnoozeRepeatLimit = .three
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("선택: \(limit.fullLabel)")
            SnoozeRepeatLimitPicker(limit: $limit)
        }
        .padding(20)
    }
}

#Preview("SnoozeRepeatLimitPicker — light") {
    VoiceAlarmThemeProvider { SnoozeLimitPreviewHost() }
}

#Preview("SnoozeRepeatLimitPicker — dark") {
    VoiceAlarmThemeProvider { SnoozeLimitPreviewHost() }
        .preferredColorScheme(.dark)
}
#endif
