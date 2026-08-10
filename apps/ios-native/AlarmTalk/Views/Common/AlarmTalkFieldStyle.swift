import SwiftUI

/// 테마 화면의 입력칸 — **안드로이드 `wakerOutlinedTextFieldColors` 와 같은 구성**이다.
///
/// ⚠ **`.textFieldStyle(.roundedBorder)` 를 쓰지 말 것.** 시스템 스타일은 배경을
/// 자기가 정해서, 우리 다크 팔레트 위에 **검은 상자**로 얹힌다. 인증 화면(고정 다크)은
/// 이미 `VocaTextField` 로 유리 필드를 직접 그리고 있었는데, 나머지 테마 화면 7곳만
/// 시스템 스타일로 남아 같은 앱 안에서 입력칸이 두 종류로 보였다(2026-08-10).
///
/// 안드로이드 대응(`ui/components/WakerDesign.kt` 의 `wakerOutlinedTextFieldColors`):
///   - 채움  : `surface` 74%   → 여기서는 `theme.palette.surface.opacity(0.74)`
///   - 테두리: `outlineVariant` → `theme.palette.outlineVariant`
///   - 모서리: `WakerInputShape`(18) → `theme.shapes.vocaButton`
///
/// 세로 여백은 인증 화면의 `VocaTextField`(12/14)와 같은 값을 쓴다 — 같은 앱에서
/// 입력칸 높이가 화면마다 달라지지 않게 한다.
struct AlarmTalkFieldStyle: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    /// 오류 상태면 테두리를 error 로 바꾼다(안드로이드 `errorBorderColor` 대응).
    var isError: Bool = false

    func body(content: Content) -> some View {
        content
            .foregroundStyle(theme.palette.onSurface)
            .tint(theme.palette.primary)
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .background(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .fill(theme.palette.surface.opacity(0.74))
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(
                        isError ? theme.palette.error : theme.palette.outlineVariant,
                        lineWidth: 1
                    )
            )
    }
}

extension View {
    /// 테마 화면의 입력칸 스타일. `.textFieldStyle(.roundedBorder)` 대신 쓴다.
    func alarmTalkFieldStyle(isError: Bool = false) -> some View {
        modifier(AlarmTalkFieldStyle(isError: isError))
    }
}
