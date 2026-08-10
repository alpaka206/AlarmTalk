import SwiftUI

/// 첫 진입 + 무료 플랜에게 **한 번만** 뜨는 웰컴 코드 안내.
///
/// 안드로이드 `ui/components/WelcomePromoDialog.kt` + `MainViewModel.maybeShowWelcomePromo`.
/// ⚠ **iOS 에는 이게 통째로 없었다** — 스토어에서 앱을 받으며 코드를 들고 온 사람이
/// 그 코드를 넣을 첫 기회를 놓친다. 코드 등록은 '더보기 → 코드 등록' 2뎁스 안쪽이라
/// 처음 온 사람은 그 자리를 찾지 못한다.
///
/// **닫기가 1급 선택지다.** 코드가 없어도 앱은 그대로 쓸 수 있고, 그 사실이 문구에서
/// 먼저 읽혀야 한다 — 강제로 통과시키는 게이트가 아니라 지나칠 수 있는 안내다.
struct WelcomePromoDialog: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let busy: Bool
    /// 등록 실패를 **이 안에서** 보여 준다. 이 안내는 계정당 1회라, 실패했다고 닫아
    /// 버리면 고쳐 넣을 기회가 사라진다.
    let errorText: String?
    let onSubmitCode: (String) -> Void
    let onOpenInstagram: () -> Void
    let onDismiss: () -> Void

    @State private var code = ""

    private var trimmed: String { InputSanitizer.sanitizeRedeemCode(code) }

    /// ⚠ **시스템 `.alert` 로 바꾸지 말 것.** CLAUDE.md 는 iOS 확인 알럿에 시스템
    /// `.alert` 를 쓰라고 하지만, 이건 확인이 아니라 **입력 + 실패 사유 표시**가 있는
    /// 알럿이다. 시스템 알럿은 필드 아래에 오류를 그릴 자리가 없어서, 바꾸면 등록
    /// 실패 사유(만료·중복·정원초과 …)를 보여줄 곳이 사라지고, 문장 안의 강조
    /// ('무료'·'더보기의 코드 등록')도 잃는다. 안드로이드도 같은 이유로
    /// `IosAlertDialog` + `IosAlertField` + 오류 슬롯을 쓴다.
    ///
    /// ⚠ **대신 수치는 안드로이드 `IosAlertDialog` 를 그대로 따른다 — 그쪽이 유일 출처다.**
    /// (안드로이드 것이 UIAlertController 복제 스펙이라, 여기서 따로 정하면 원본에서 멀어진다.)
    /// 2026-08-10 대조 전에는 껍데기(폭 300·반경 14·액션 52)만 맞고 **글자 크기와 입력칸이
    /// 전부 달랐다** — 제목 16 vs 17, 본문 12 vs 13, 액션 16 vs 17, 입력칸 반경 18·테두리 1
    /// vs 반경 8·테두리 0.5·surface 50% 채움.
    ///
    /// ⚠ **좌우 여백을 빼지 말 것.** `.padding(.top, 20)` 만 있던 시절에는 제목·설명·
    /// 입력창이 카드 모서리에 그대로 붙었다. 액션 행은 구분선이 카드 폭 전체를 가로질러야
    /// 하므로(iOS UIAlertController 규칙) 여백을 **바깥이 아니라 내용에** 준다.
    var body: some View {
        VStack(spacing: 14) {
            Text("코드가 있으신가요?")
                // 안드로이드 `IosAlertType.Title` = 17sp SemiBold.
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.palette.onSurface)
                .padding(.horizontal, 20)

            // 강조는 문장을 조각내 이어붙이지 않고 **완성된 문장 안에서 찾아** 칠한다 —
            // 조각 순서가 언어마다 달라 붙이는 순간 번역이 어색해진다.
            VStack(spacing: 2) {
                highlighted("코드가 없어도 기본 기능은 무료로 쓸 수 있어요.", "무료")
                highlighted("나중에 더보기의 코드 등록에서 언제든 넣을 수 있어요.", "더보기의 코드 등록")
            }
            // 안드로이드 `IosAlertType.Message` = 13sp.
            .font(.system(size: 13))
            .foregroundStyle(theme.palette.onSurfaceVariant)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)

            // 안드로이드 `IosAlertField`: 15sp / 최소 높이 48 / 반경 8(컨테이너 14 보다
            // 작다 — 안에 든 요소가 더 각지는 iOS 문법) / 테두리 0.5·onSurface 22% /
            // 채움 surface 50%. `vocaButton`(18) 을 쓰면 알럿 안에서 너무 둥글어진다.
            TextField("초대·선물·프로모션 코드", text: $code)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .multilineTextAlignment(.center)
                .font(.system(size: 15))
                .padding(.horizontal, 10)
                .frame(minHeight: 48)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(theme.palette.surface.opacity(0.5))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(theme.palette.onSurface.opacity(0.22), lineWidth: 0.5)
                )
                .padding(.horizontal, 20)
                .disabled(busy)
                .onChange(of: code) { _, new in
                    let cleaned = InputSanitizer.sanitizeRedeemCode(new)
                    if cleaned != new { code = cleaned }
                }

            if let errorText {
                Text(errorText)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.palette.error)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
            }

            // 액션이 셋이라 **세로로 쌓는다**(2개면 가로) — iOS UIAlertController 규칙.
            VStack(spacing: 0) {
                Divider()
                action("등록", emphasized: true, enabled: !busy && !trimmed.isEmpty) {
                    onSubmitCode(trimmed)
                }
                Divider()
                action("코드 받으러 가기", enabled: !busy, action: onOpenInstagram)
                Divider()
                action("닫기", enabled: !busy, action: onDismiss)
            }
        }
        .padding(.top, 20)
        .frame(maxWidth: 300)
        .background(
            theme.palette.surface,
            in: RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous)
        )
    }

    private func action(
        _ title: String,
        emphasized: Bool = false,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                // 안드로이드 `IosAlertType.Action` = 17sp(강조는 SemiBold).
                .font(.system(size: 17, weight: emphasized ? .semibold : .regular))
                .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.plain)
        .foregroundStyle(enabled ? theme.palette.primary : theme.palette.onSurfaceVariant)
        .disabled(!enabled)
    }

    private func highlighted(_ text: String, _ highlight: String) -> Text {
        guard let range = text.range(of: highlight) else { return Text(text) }
        return Text(text[text.startIndex..<range.lowerBound])
            + Text(highlight).foregroundColor(theme.palette.primary).fontWeight(.semibold)
            + Text(text[range.upperBound...])
    }
}
