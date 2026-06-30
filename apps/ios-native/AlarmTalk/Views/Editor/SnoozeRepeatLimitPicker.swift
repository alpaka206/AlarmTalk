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

// MARK: - Snooze interval

/// 스누즈 간격 선택 — 프리셋(5/10/15/30분) + 직접 설정.
///
/// Android `AlarmSnoozeSettings.kt` 의 `SnoozeIntervals`(5,10,15,30) 라디오 목록 +
/// '직접 설정' 다이얼로그를, iOS Form 흐름에 맞춰 칩 행 + 인라인 스텝퍼로 재현한다.
/// 직접 입력 상한은 백엔드 계약(`validateAlarmFields` snooze_minutes 1–30)에 맞춰
/// 30 으로 캡한다 — Android 다이얼로그의 1–60 중 31–60 은 서버가 거부하므로 의도적으로
/// 좁힌다.
struct SnoozeIntervalPicker: View {
    @Binding var minutes: Int

    @Environment(\.voiceAlarmTheme) private var theme

    /// 프리셋 간격(분). Android `SnoozeIntervals` 와 동일.
    static let presets = [5, 10, 15, 30]
    /// 직접 입력 상한 — 백엔드 계약(1–30)에 맞춘다.
    static let maxCustomMinutes = 30

    /// '직접 설정' 모드 여부. 값이 프리셋이 아니면 항상 직접 모드로 본다.
    @State private var customMode = false

    private var isCustomSelected: Bool {
        customMode || !Self.presets.contains(minutes)
    }

    private var clampedMinutes: Int {
        max(1, min(Self.maxCustomMinutes, minutes))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ForEach(Self.presets, id: \.self) { preset in
                    chip(title: "\(preset)분", selected: !customMode && minutes == preset) {
                        selectPreset(preset)
                    }
                }
            }
            chip(
                title: isCustomSelected ? "직접 설정 · \(clampedMinutes)분" : "직접 설정",
                selected: isCustomSelected
            ) {
                enterCustomMode()
            }
            if isCustomSelected {
                Stepper(value: customBinding, in: 1...Self.maxCustomMinutes) {
                    HStack {
                        Text("간격 직접 설정")
                            .font(theme.typography.bodyMedium)
                        Spacer()
                        Text("\(clampedMinutes)분")
                            .foregroundStyle(theme.palette.primary)
                            .monospacedDigit()
                    }
                }
            }
        }
        .onAppear { customMode = !Self.presets.contains(minutes) }
    }

    private var customBinding: Binding<Int> {
        Binding(
            get: { clampedMinutes },
            set: { minutes = max(1, min(Self.maxCustomMinutes, $0)) }
        )
    }

    private func selectPreset(_ preset: Int) {
        customMode = false
        guard preset != minutes else { return }
        minutes = preset
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func enterCustomMode() {
        guard !customMode else { return }
        customMode = true
        // 프리셋에서 직접 모드로 들어오면 현재 값을 1–30 으로 클램프해 스텝퍼 초기값으로 쓴다.
        let clamped = clampedMinutes
        if clamped != minutes { minutes = clamped }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    @ViewBuilder
    private func chip(title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
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
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
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
    AlarmTalkThemeProvider { SnoozeLimitPreviewHost() }
}

#Preview("SnoozeRepeatLimitPicker — dark") {
    AlarmTalkThemeProvider { SnoozeLimitPreviewHost() }
        .preferredColorScheme(.dark)
}
#endif
