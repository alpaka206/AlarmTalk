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

    var body: some View {
        VStack(spacing: 14) {
            Text("코드가 있으신가요?")
                .font(theme.typography.titleMedium)
                .fontWeight(.bold)
                .foregroundStyle(theme.palette.onSurface)

            // 강조는 문장을 조각내 이어붙이지 않고 **완성된 문장 안에서 찾아** 칠한다 —
            // 조각 순서가 언어마다 달라 붙이는 순간 번역이 어색해진다.
            VStack(spacing: 2) {
                highlighted("코드가 없어도 기본 기능은 무료로 쓸 수 있어요.", "무료")
                highlighted("나중에 더보기의 코드 등록에서 언제든 넣을 수 있어요.", "더보기의 코드 등록")
            }
            .font(theme.typography.bodySmall)
            .foregroundStyle(theme.palette.onSurfaceVariant)
            .multilineTextAlignment(.center)

            TextField("초대·선물·프로모션 코드", text: $code)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .multilineTextAlignment(.center)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                        .stroke(theme.palette.outlineVariant, lineWidth: 1)
                )
                .disabled(busy)
                .onChange(of: code) { _, new in
                    let cleaned = InputSanitizer.sanitizeRedeemCode(new)
                    if cleaned != new { code = cleaned }
                }

            if let errorText {
                Text(errorText)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
                    .multilineTextAlignment(.center)
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
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
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
                .font(theme.typography.bodyLarge)
                .fontWeight(emphasized ? .semibold : .regular)
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
