import SwiftUI

/// **유료 게이트의 쿠폰 갈래 — 코드 입력 모달.**
///
/// ⚠ **시스템 `.alert` 로 되돌리지 말 것**(2026-08-18 실기기 확인). 알럿에는 **실패 사유를
/// 그릴 자리가 없어서**, 코드를 잘못 치면 모달이 그냥 닫혔다. 무엇이 틀렸는지도, 고쳐 넣을
/// 기회도 사라진다 — 안드로이드 `PlanGateDialog` 은 처음부터 `redeemErrorText` 를 필드 밑에
/// 그리고 있었고, 그 주석이 바로 그 이유를 적어 두었다.
/// 같은 판단을 이미 두 번 했다: 코드 등록 행(`CodeRegisterRow`, 2026-08-13 지시 — "오류는
/// 입력창 바로 밑")과 웰컴 코드 안내(`WelcomePromoSheet`, 2026-08-18).
///
/// ⚠ **이 껍데기를 화면마다 새로 만들지 말 것.** 2026-08-18 전에는 같은 알럿이 **두 벌**
/// (`VoiceProfileManagementPanel` · `AlarmEditorSheet`)로 복사돼 있었고, 편집기 쪽에만
/// 설명 문장·`sanitizeRedeemCode`·빈 값 비활성이 있었다 — 같은 코드를 목소리 탭에서
/// 등록하면 공백이 그대로 서버로 갔다.
///
/// 확정(`등록`)이 **본문이 아니라 상단바**에 있는 것은 `FormSheet` 규칙 그대로다.
/// 웰컴 안내만 본문 채움 버튼을 쓰는데, 그건 액션이 셋이라(닫기·코드 받기·등록) 셋을 같은
/// 자리에 둘 수 없어서다.
struct RedeemCodeSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme

    /// 코드를 서버에 넣는다. **오류 문구를 돌려주면 실패**, `nil` 이면 성공이라 시트를 닫는다.
    let onSubmit: (String) async -> String?
    let onClose: () -> Void

    @State private var code = ""
    @State private var errorText: String?
    @State private var busy = false

    private var trimmed: String { InputSanitizer.sanitizeRedeemCode(code) }

    var body: some View {
        FormSheet(
            title: "쿠폰 입력",
            saveTitle: busy ? "등록 중…" : "등록",
            // 되돌릴 입력이 아니라 지나치는 안내다 — 웰컴 안내와 같은 말.
            cancelTitle: "닫기",
            saveEnabled: !busy && !trimmed.isEmpty,
            onCancel: onClose,
            onSave: submit
        ) {
            VStack(alignment: .leading, spacing: 6) {
                // 안드로이드 `plan_gate_redeem_desc` 와 같은 문장 — 한쪽만 고치지 말 것.
                Text("받으신 프로모션·선물 코드를 넣어 주세요. 초대 코드도 여기에 넣을 수 있어요.")
                    .font(.pretendard(.regular, size: 14.5, relativeTo: .subheadline))
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .padding(.bottom, 10)

                TextField("초대·선물·프로모션 코드", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(theme.typography.bodyMedium)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 52)
                    .background(
                        RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                            .fill(theme.palette.surfaceVariant.opacity(0.5))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                            .stroke(theme.palette.onSurface.opacity(0.18), lineWidth: 0.5)
                    )
                    .disabled(busy)
                    .onChange(of: code) { _, new in
                        let cleaned = InputSanitizer.sanitizeRedeemCode(new)
                        if cleaned != new { code = cleaned }
                        // 고쳐 치기 시작하면 지난 실패 사유는 치운다.
                        if errorText != nil { errorText = nil }
                    }
                    .onSubmit(submit)

                if let errorText {
                    Text(errorText)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.error)
                }
            }
        }
    }

    private func submit() {
        let value = trimmed
        guard !value.isEmpty, !busy else { return }
        busy = true
        Task {
            let failure = await onSubmit(value)
            busy = false
            if let failure {
                errorText = failure
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            } else {
                onClose()
            }
        }
    }
}

extension View {
    /// 쿠폰 코드 입력 시트를 붙인다.
    ///
    /// ⚠ **본문에 알럿·시트를 더 쌓지 말고 이 모디파이어를 쓸 것.** `ViewBuilder` 가 형제를
    /// 중첩 튜플로 쌓아 타입체크가 터진다(`VoiceProfileManagementPanel` 에서 실제로
    /// "unable to type-check in reasonable time" 이 났다).
    func redeemCodeSheet(
        isPresented: Binding<Bool>,
        onSubmit: @escaping (String) async -> String?
    ) -> some View {
        fullScreenCover(isPresented: isPresented) {
            BottomSheetHost(onDismiss: { isPresented.wrappedValue = false }) {
                RedeemCodeSheet(
                    onSubmit: onSubmit,
                    onClose: { isPresented.wrappedValue = false }
                )
            }
            .presentationBackground(.clear)
        }
        // 스크림이 시트와 같이 밀려 올라오지 않게 커버 자체의 전환을 끈다(`formSheet` 와 같은 이유).
        .transaction { $0.disablesAnimations = true }
    }
}
