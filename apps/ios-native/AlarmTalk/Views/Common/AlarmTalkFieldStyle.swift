import SwiftUI

/// 테마 화면의 입력칸 — **안드로이드 `OutlinedTextField` + `wakerOutlinedTextFieldColors` 와 같은 구성**이다.
///
/// ⚠ **`.textFieldStyle(.roundedBorder)` 를 쓰지 말 것.** 시스템 스타일은 배경을
/// 자기가 정해서, 우리 다크 팔레트 위에 **검은 상자**로 얹힌다. 인증 화면(고정 다크)은
/// 이미 `VocaTextField` 로 유리 필드를 직접 그리고 있었는데, 나머지 테마 화면 7곳만
/// 시스템 스타일로 남아 같은 앱 안에서 입력칸이 두 종류로 보였다(2026-08-10).
///
/// 안드로이드 대응(`ui/components/WakerDesign.kt` 의 `wakerOutlinedTextFieldColors`):
///   - 채움  : `surface` 74%   → 여기서는 `theme.palette.surface.opacity(0.74)`
///   - 테두리: `outlineVariant`(오류면 `error`) → `theme.palette.outlineVariant`
///   - 모서리: `WakerInputShape`(18) → `theme.shapes.vocaButton`
///   - 높이 56 · 글자 시작 16 · 글자 16(bodyLarge) — M3 `OutlinedTextField` 의 최소 높이·안쪽 여백·글자다(2026-11-22 두 앱 통일.
///     그전에는 48 · 14 · 시스템 글꼴이라 목소리 등록 칸이 안드로이드보다 낮고 글자가 SF 였다).
///
/// 쓰는 곳은 목소리 등록 세부 정보의 칸들이다(이름·나를 부를 이름·관계 직접 입력). 버튼과 한 줄에 나란히 두는 칸이 생기면
/// 그 자리는 컴팩트 칸(48 — `AlarmTalkControl.height`)을 따로 쓴다.
struct AlarmTalkFieldStyle: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    /// 오류 상태면 테두리를 error 로 바꾼다(안드로이드 `errorBorderColor` 대응).
    var isError: Bool = false

    func body(content: Content) -> some View {
        content
            .font(theme.typography.bodyLarge)
            .foregroundStyle(theme.palette.onSurface)
            .tint(theme.palette.primary)
            .padding(.vertical, 12)
            .padding(.horizontal, 16)
            .frame(minHeight: 56)
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
