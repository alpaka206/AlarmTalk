import SwiftUI

/// 공휴일 OFF 토글.
///
/// Android `AlarmEditorControls.kt:123-146` 의 "공휴일에는 끄기" 행 대응.
/// 반복 요일이 하나라도 켜져 있어야 의미가 있어, 하나도 없으면(`enabled == false`) Android 의
/// `if (holidayEnabled)` 처럼 행 전체를 숨긴다(기존의 dim 처리 대신).
struct HolidayOffToggle: View {
    @Binding var isOn: Bool
    /// 반복 요일이 하나도 없으면(mask == 0) 의미가 없어 숨긴다. 부모(에디터)가 mask 로 판단해 전달.
    var enabled: Bool = true

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        if enabled {
            HStack(alignment: .center, spacing: theme.spacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("공휴일에는 끄기")
                        .font(theme.typography.titleSmall)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)
                    // Android 는 선택 국가와 무관하게 '대체 공휴일 및 임시 공휴일 포함' 고정 안내(editor_holiday_off_subtitle).
                    Text("대체 공휴일 및 임시 공휴일 포함")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Toggle("", isOn: $isOn)
                    .labelsHidden()
                    .alarmTalkSwitch()
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text("공휴일에는 알람 끄기"))
            .accessibilityValue(Text(isOn ? "켜짐" : "꺼짐"))
        }
    }
}

// MARK: - Preview

#if DEBUG
private struct HolidayTogglePreviewHost: View {
    @State private var on = true
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HolidayOffToggle(isOn: $on, enabled: true)
            HolidayOffToggle(isOn: .constant(false), enabled: false)
        }
        .padding(20)
    }
}

#Preview("HolidayOffToggle — light") {
    AlarmTalkThemeProvider { HolidayTogglePreviewHost() }
}

#Preview("HolidayOffToggle — dark") {
    AlarmTalkThemeProvider { HolidayTogglePreviewHost() }
        .preferredColorScheme(.dark)
}
#endif
