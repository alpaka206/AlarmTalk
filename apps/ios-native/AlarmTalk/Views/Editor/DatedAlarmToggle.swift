import SwiftUI

/// 반복 카드의 **'날짜 지정(한 번)'** 스위치 — 스펙 `docs/spec/alarm-editor.md` §2-1.
///
/// 요일 칩 아래에 둔다. 켜면 요일 선택이 풀리고 그 알람은 고른 날짜에 한 번만 운다
/// (`AlarmEditDraft.enterDatedMode`). 모양은 '공휴일에는 끄기'(`HolidayOffToggle`)와 같다.
struct DatedAlarmToggle: View {
    @Binding var isOn: Bool

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: theme.spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text("날짜 지정")
                    .font(theme.typography.titleSmall)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.onSurface)
                Text("고른 날 한 번만 울려요")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Toggle("", isOn: $isOn)
                .labelsHidden()
                .alarmTalkSwitch()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("날짜 지정"))
        .accessibilityValue(Text(isOn ? String(localized: "켜짐") : String(localized: "꺼짐")))
    }
}
