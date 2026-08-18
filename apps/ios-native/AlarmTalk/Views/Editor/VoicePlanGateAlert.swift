import SwiftUI

/// 이용권 게이트 알럿 — **여러 화면에 같은 모양으로 붙는다.**
///
/// ⚠ **`.alert` 는 지금 보이는 뷰에 붙어 있어야 뜬다.** 편집기(스택 루트)에만 달아 두면
/// 문구 화면을 push 한 상태에서 잠긴 '직접 입력' 을 눌러도 **아무 일도 일어나지 않는다**
/// (2026-08-17 UI 테스트로 확인 — `FreeManualGateUITests`). 그래서 게이트를 띄울 수 있는
/// 화면마다 이 모디파이어를 붙인다. 상태는 하나(`voiceGateAlert`)라 두 번 뜨지 않는다.
///
/// ⚠ **액션은 상태에 맞는 것만 붙는다**(`docs/spec/plan-gates.md`). 쿠폰·결제는 이용권이
/// 없어서 막힌 경우에만 뜻이 있다 — 비로그인에게는 등록할 계정이 없고, 유료에게는 눌러도
/// 아무 일도 일어나지 않는다. 그 판단은 `AlarmEditorSheet.VoiceGateAlertContent.offersPlanActions` 가 갖는다.
struct VoicePlanGateAlert: ViewModifier {
    @Binding var content: AlarmEditorSheet.VoiceGateAlertContent?
    let onRedeemCode: () -> Void
    let onOpenBilling: () -> Void

    func body(content view: Content) -> some View {
        view.alert(
            content?.title ?? "",
            isPresented: Binding(
                get: { content != nil },
                set: { if !$0 { content = nil } }
            ),
            presenting: content
        ) { item in
            if item.offersPlanActions {
                Button(PaidGateCopy.redeemCode) {
                    content = nil
                    onRedeemCode()
                }
                Button(PaidGateCopy.viewPlans) {
                    content = nil
                    onOpenBilling()
                }
                // ⚠ **이 줄이 색을 만든다.** 시스템 알럿은 버튼 색을 직접 못 주고,
                // '기본 액션' 으로 지정된 버튼만 굵게(강조 색으로) 그린다.
                // 안드로이드 `PlanGateDialog` 의 `emphasized = true` 와 같은 자리다.
                .keyboardShortcut(.defaultAction)
            }
            Button("닫기", role: .cancel) { content = nil }
        } message: { item in
            Text(item.message)
        }
    }
}

extension View {
    func voicePlanGateAlert(
        content: Binding<AlarmEditorSheet.VoiceGateAlertContent?>,
        onRedeemCode: @escaping () -> Void,
        onOpenBilling: @escaping () -> Void
    ) -> some View {
        modifier(VoicePlanGateAlert(content: content, onRedeemCode: onRedeemCode, onOpenBilling: onOpenBilling))
    }
}
