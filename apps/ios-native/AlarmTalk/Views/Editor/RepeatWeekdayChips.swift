import SwiftUI

/// 알람 편집기에서 사용하는 7-일 요일 칩 행.
///
/// Android `AlarmEditorControls.kt:74-201` 의 `RepeatSelector` + `DayTextChip`
/// 를 SwiftUI 로 포팅. 비트마스크(`RepeatDay` mask) 와 양방향 바인딩한다.
///
/// 색상 규칙 (Android 와 동일):
/// - 일요일: error (빨강) 계열
/// - 토요일: secondary (파랑) 계열
/// - 평일:   primary (브랜드 블루) 계열
///
/// 칩 자체는 36pt 원형 + `aspectRatio(1.0, contentMode: .fill)` 로 가로폭에 따라
/// 자연스럽게 늘어난다.
struct RepeatWeekdayChips: View {
    @Binding var mask: Int

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        HStack(spacing: 6) {
            ForEach(RepeatDay.displayOrder, id: \.self) { day in
                Button {
                    toggle(day)
                } label: {
                    chipLabel(for: day)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(accessibilityLabel(for: day)))
                .accessibilityValue(Text(mask.hasRepeatDay(day) ? "선택됨" : "선택 안 됨"))
                .accessibilityAddTraits(.isButton)
            }
        }
    }

    // MARK: - Chip

    @ViewBuilder
    private func chipLabel(for day: RepeatDay) -> some View {
        let selected = mask.hasRepeatDay(day)
        let palette = colorPalette(for: day, selected: selected)

        // ⚠ **`Text` 에 `aspectRatio` 를 직접 걸지 말 것.** 그러면 정사각형이 **글자 높이**
        // 기준으로 잡혀 칩이 안드로이드의 절반 크기가 된다(2026-08-08 실기기 대조에서
        // 안드로이드 ≈33dp / iOS ≈16pt 로 확인). 안드로이드는 `weight(1f).aspectRatio(1f)`
        // 라 **가로 몫만큼 커지는 원**이다.
        //
        // `Color.clear` 는 제안된 폭을 그대로 받으므로, 거기에 비율을 걸고 글자를 얹으면
        // 같은 동작이 된다.
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .background(
                Circle().fill(palette.background)
            )
            .overlay(
                Circle().stroke(palette.border, lineWidth: 1)
            )
            .overlay(
                Text(day.shortLabel)
                    .font(theme.typography.titleSmall)
                    .fontWeight(selected ? .bold : .semibold)
                    .foregroundStyle(palette.foreground)
                    // 큰 글꼴에서 원을 넘치지 않게 줄어든다.
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(2)
            )
    }

    // MARK: - Toggle

    private func toggle(_ day: RepeatDay) {
        if mask.hasRepeatDay(day) {
            mask &= ~day.mask
        } else {
            mask |= day.mask
        }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    // MARK: - Palette resolution

    private struct ChipPalette {
        let background: Color
        let foreground: Color
        let border: Color
    }

    private func colorPalette(for day: RepeatDay, selected: Bool) -> ChipPalette {
        let p = theme.palette
        switch day {
        case .sunday:
            if selected {
                return ChipPalette(
                    background: p.errorContainer,
                    foreground: p.onErrorContainer,
                    border: p.error.opacity(0.58)
                )
            } else {
                return ChipPalette(
                    background: p.surfaceVariant.opacity(0.46),
                    foreground: p.error,
                    border: p.outlineVariant
                )
            }
        case .saturday:
            if selected {
                return ChipPalette(
                    background: p.secondaryContainer,
                    foreground: p.onSecondaryContainer,
                    border: p.secondary.opacity(0.58)
                )
            } else {
                return ChipPalette(
                    background: p.surfaceVariant.opacity(0.46),
                    foreground: p.secondary,
                    border: p.outlineVariant
                )
            }
        default:
            if selected {
                return ChipPalette(
                    background: p.primaryContainer,
                    foreground: p.onPrimaryContainer,
                    border: p.primary.opacity(0.58)
                )
            } else {
                return ChipPalette(
                    background: p.surfaceVariant.opacity(0.46),
                    foreground: p.onSurfaceVariant,
                    border: p.outlineVariant
                )
            }
        }
    }

    private func accessibilityLabel(for day: RepeatDay) -> String {
        "\(day.fullLabel) 반복"
    }
}

// MARK: - RepeatDay helpers

extension RepeatDay {
    /// 한국 캘린더 표시 순서. 일요일을 가장 왼쪽에 두는 Android 와 동일.
    static let displayOrder: [RepeatDay] = [.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday]

    /// "일", "월", "화", "수", "목", "금", "토".
    var shortLabel: String {
        switch self {
        case .sunday: return "일"
        case .monday: return "월"
        case .tuesday: return "화"
        case .wednesday: return "수"
        case .thursday: return "목"
        case .friday: return "금"
        case .saturday: return "토"
        }
    }

    /// 접근성 라벨용 풀 한국어.
    var fullLabel: String {
        switch self {
        case .sunday: return "일요일"
        case .monday: return "월요일"
        case .tuesday: return "화요일"
        case .wednesday: return "수요일"
        case .thursday: return "목요일"
        case .friday: return "금요일"
        case .saturday: return "토요일"
        }
    }
}

// MARK: - Preview

#if DEBUG
private struct RepeatChipsPreviewHost: View {
    @State private var mask: Int = (1 << 1) | (1 << 3) | (1 << 5)  // 월/수/금

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("선택된 mask: \(String(mask, radix: 2))")
                .font(.footnote.monospaced())
            RepeatWeekdayChips(mask: $mask)
        }
        .padding(20)
    }
}

#Preview("RepeatWeekdayChips — light") {
    AlarmTalkThemeProvider {
        RepeatChipsPreviewHost()
    }
}

#Preview("RepeatWeekdayChips — dark") {
    AlarmTalkThemeProvider {
        RepeatChipsPreviewHost()
    }
    .preferredColorScheme(.dark)
}
#endif
