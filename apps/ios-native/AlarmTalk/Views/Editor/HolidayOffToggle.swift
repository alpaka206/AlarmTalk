import SwiftUI

/// 공휴일 OFF 토글.
///
/// Android `AlarmEditorControls.kt:104-132` 의 "공휴일에는 끄기" 행 대응.
/// 반복 요일이 하나라도 켜져 있어야 의미가 있어 `enabled` 가 false 면 dim 처리.
struct HolidayOffToggle: View {
    @Binding var isOn: Bool
    /// 반복 요일이 하나도 없으면 의미가 없어 disable. 부모(에디터)가 mask 로 판단해 전달.
    var enabled: Bool = true
    /// 선택된 국가명. nil 이면 기존 서브타이틀을 그대로 유지(2-arg 호출 호환).
    var subtitleCountryName: String? = nil

    @Environment(\.voiceAlarmTheme) private var theme

    private var subtitleText: String {
        // subtitleCountryName == nil (KR 등) 이면 기존 '대체·임시 공휴일 포함' 안내를 유지.
        guard let name = subtitleCountryName else {
            return "대체 공휴일 및 임시 공휴일 포함"
        }
        return "\(name) 공휴일 기준"
    }

    var body: some View {
        HStack(alignment: .center, spacing: theme.spacing.sm) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(theme.palette.primary)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text("공휴일에는 끄기")
                    .font(theme.typography.titleSmall)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.onSurface)
                Text(subtitleText)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Toggle("", isOn: toggleBinding)
                .labelsHidden()
                .tint(theme.palette.primary)
        }
        .opacity(enabled ? 1.0 : 0.46)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("공휴일에는 알람 끄기"))
        .accessibilityValue(Text(isOn ? "켜짐" : "꺼짐"))
        .accessibilityHint(Text(enabled ? "" : "반복 요일을 하나 이상 선택하면 사용할 수 있어요."))
    }

    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { enabled && isOn },
            set: { newValue in
                guard enabled else { return }
                isOn = newValue
            }
        )
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
