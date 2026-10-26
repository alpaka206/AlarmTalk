import SwiftUI

/// 이용권 게이트 알럿 — **여러 화면에 같은 모양으로 붙는다.**
///
/// ⚠ **`.alert` 는 지금 보이는 뷰에 붙어 있어야 뜬다.** 편집기(스택 루트)에만 달아 두면
/// 문구 화면을 push 한 상태에서 잠긴 '직접 입력' 을 눌러도 **아무 일도 일어나지 않는다**
/// (2026-08-17 UI 테스트로 확인 — `FreeManualGateUITests`). 그래서 게이트를 띄울 수 있는
/// 화면마다 이 모디파이어를 붙인다. 상태는 하나(`voiceGateAlert`)라 두 번 뜨지 않는다.
///
/// 비로그인·무료는 이용권 화면을 연다(구매 시 로그인). 유료의 목소리 제한은 목소리 화면을 연다.
/// Android `PlanGateDialog`와 같은 세 갈래다(`docs/spec/plan-gates.md`).
///
/// ⚠ **코드 입력 액션('선물·초대 코드가 있어요')을 되살리지 말 것**(2026-10-14, App Store 지침 3.1.1
/// 두 번째 반려 — 선물 코드 폐지). 할인·무료 이용은 스토어 오퍼 코드로 준다. 목소리 탭
/// 게이트(`VoiceProfileManagementPanel`)도 같다.
struct VoicePlanGateAlert: ViewModifier {
    @Binding var content: AlarmEditorSheet.VoiceGateAlertContent?
    let onOpenBilling: () -> Void
    let onOpenVoices: () -> Void
    /// '광고 보고 한 번 쓰기'(`docs/spec/ad-rewards.md` §1-1). 내용이 `offersRewardedAd` 일 때만 그린다 — 버튼이 셋이 되면
    /// 시스템 알럿이 세로로 쌓는다(안드로이드 `PlanGateDialog` 의 `rewardedAdAction` 과 같은 순서: 광고 · 이용권 · 닫기).
    var onWatchRewardedAd: (() -> Void)? = nil

    func body(content view: Content) -> some View {
        view.alert(
            content?.title ?? "",
            isPresented: Binding(
                get: { content != nil },
                set: { if !$0 { content = nil } }
            ),
            presenting: content
        ) { item in
            if item.offersRewardedAd, let onWatchRewardedAd {
                Button(String(localized: "광고 보고 한 번 쓰기")) {
                    content = nil
                    onWatchRewardedAd()
                }
            }
            if item.offersPlanActions {
                Button(PaidGateCopy.viewPlans) {
                    content = nil
                    onOpenBilling()
                }
                // ⚠ **이 줄이 색을 만든다.** 시스템 알럿은 버튼 색을 직접 못 주고,
                // '기본 액션' 으로 지정된 버튼만 굵게(강조 색으로) 그린다.
                // 안드로이드 `PlanGateDialog` 의 `emphasized = true` 와 같은 자리다.
                .keyboardShortcut(.defaultAction)
            }
            if item.offersVoiceRegistration {
                Button(String(localized: "등록하기")) {
                    content = nil
                    onOpenVoices()
                }
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
        onOpenBilling: @escaping () -> Void,
        onOpenVoices: @escaping () -> Void,
        onWatchRewardedAd: (() -> Void)? = nil
    ) -> some View {
        modifier(VoicePlanGateAlert(
            content: content,
            onOpenBilling: onOpenBilling,
            onOpenVoices: onOpenVoices,
            onWatchRewardedAd: onWatchRewardedAd
        ))
    }
}
