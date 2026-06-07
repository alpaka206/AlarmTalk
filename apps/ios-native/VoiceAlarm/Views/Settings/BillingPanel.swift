import SwiftUI
import StoreKit
import UIKit

/// 이용권/구독 패널.
///
/// Phase 4-D1 갱신:
///   - 디지털 구독은 Apple StoreKit2 IAP 가 권위(authoritative). 기존
///     `socialFeatures.checkout(planKey:)` 호출은 deprecated 되었고, 본 패널은
///     `SubscriptionManager.purchase(_:)` 를 통한 IAP 흐름으로 통합됨.
///   - 각 유료 플랜 카드에 월간/연간 두 가격 버튼이 노출되며, 가격은 Apple
///     `Product.displayPrice` (지역 통화/세금 포함) 를 그대로 보여준다.
///   - "이전 구매 복원" 버튼이 하단에 추가됨 — Apple 심사 가이드라인 3.1.1 요구.
///   - free 플랜 카드는 정보 표시만 (구매 버튼 없음).
///
/// Phase 3-C3 호환 노트
///   - 백엔드 표준 plan key (`free` / `personal` / `couple` / `family`) 는 그대로.
///   - 비-IAP 흐름 (`/billing/vouchers/family-share`, `/billing/redeem`) 은
///     SocialFeatureViewModel 이 계속 담당.
struct BillingPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

    /// 결제 결과를 사용자에게 토스트로 알리기 위한 transient 메시지.
    @State private var purchaseFeedback: String?
    @State private var showLeaveSharedPassConfirm = false
    @State private var showCancelSubscriptionSheet = false
    @State private var showPersonalGiftSheet = false
    @State private var voucherShareTargets: [VoucherItem] = []

    private var currentTier: PlanTier {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
    }

    private var isSharedMember: Bool {
        socialFeatures.familyGroup?.role == "member" && socialFeatures.familyGroup?.group != nil
    }

    private var sharedGroupID: String? {
        socialFeatures.familyGroup?.group?.id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CurrentPassSummaryCard(
                subscription: socialFeatures.subscription?.subscription,
                currentPlan: socialFeatures.subscription?.plan,
                nextPlan: socialFeatures.subscription?.nextPlan,
                currentTier: currentTier,
                isSharedMember: isSharedMember
            )

            Text("이용권 선택")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.text)

            ForEach(PlanTier.allCases, id: \.self) { tier in
                let shareableVouchers = shareableVouchersForPlan(
                    socialFeatures.vouchers,
                    planKey: tier.apiKey
                )
                PlanCard(
                    tier: tier,
                    isCurrent: tier == currentTier,
                    isBusy: socialFeatures.isBusy,
                    vouchers: shareableVouchers,
                    onPurchase: { product in
                        Task { await purchase(product) }
                    },
                    onGiftPersonal: {
                        showPersonalGiftSheet = true
                    },
                    onShareVouchers: {
                        Task { await refreshAndOpenVoucherShare(planKey: tier.apiKey) }
                    }
                )
            }

            restorePurchasesButton

            if let feedback = purchaseFeedback {
                Text(feedback)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    .padding(.top, 4)
            }

            if let lastError = subscriptions.lastError {
                Text(lastError)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.error)
                    .padding(.top, 4)
            }

            if isSharedMember {
                Button(role: .destructive) {
                    showLeaveSharedPassConfirm = true
                } label: {
                    Label("공유 이용권에서 나가기", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .buttonStyle(.bordered)
                .disabled(socialFeatures.isBusy)
            } else if socialFeatures.subscription?.subscription != nil {
                Button(role: .destructive) {
                    showCancelSubscriptionSheet = true
                } label: {
                    Label("이용권 해지", systemImage: "xmark.circle")
                }
                .buttonStyle(.bordered)
                .disabled(socialFeatures.isBusy)
            }

            if !socialFeatures.vouchers.isEmpty {
                Text("공유 코드")
                    .font(.subheadline.weight(.semibold))
                ForEach(socialFeatures.vouchers.prefix(5)) { voucher in
                    VoucherRow(voucher: voucher)
                }
            }
        }
        .sectionSurface()
        .task {
            // 시트 진입 시 fresh 한 제품 정보 + entitlement 동기화 보장.
            if subscriptions.products.isEmpty {
                await subscriptions.fetchProducts()
            }
            await socialFeatures.refreshAll(session: auth.session, force: true)
        }
        .alert("공유 이용권에서 나가기", isPresented: $showLeaveSharedPassConfirm) {
            Button("나가기", role: .destructive) {
                guard let groupID = sharedGroupID else { return }
                Task {
                    await socialFeatures.leaveFamilyGroup(
                        groupId: groupID,
                        session: auth.session
                    )
                    await auth.refreshUser()
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("나가면 무료 이용권으로 전환돼요. 다시 들어오려면 새 초대 코드가 필요해요.")
        }
        .sheet(isPresented: $showCancelSubscriptionSheet) {
            CancelSubscriptionSheet(
                subscription: socialFeatures.subscription?.subscription,
                onDismiss: { showCancelSubscriptionSheet = false },
                onConfirm: { mode in
                    showCancelSubscriptionSheet = false
                    Task {
                        await socialFeatures.cancelSubscription(
                            mode: mode,
                            session: auth.session
                        )
                        await auth.refreshUser()
                    }
                }
            )
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $showPersonalGiftSheet) {
            PersonalGiftPassSheet(
                onDismiss: { showPersonalGiftSheet = false },
                onConfirm: {
                    showPersonalGiftSheet = false
                    Task { await giftPersonalPass() }
                }
            )
            .presentationDetents([.medium])
        }
        .sheet(
            isPresented: Binding(
                get: { !voucherShareTargets.isEmpty },
                set: { if !$0 { voucherShareTargets = [] } }
            )
        ) {
            VoucherShareSelectionSheet(
                vouchers: voucherShareTargets,
                onDismiss: { voucherShareTargets = [] }
            )
            .presentationDetents([.medium])
        }
    }

    // MARK: - Restore

    private var restorePurchasesButton: some View {
        Button {
            Task {
                await subscriptions.restorePurchases()
                await subscriptions.resyncEntitlements()
                await auth.refreshUser()
                await socialFeatures.refreshAll(session: auth.session, force: true)
                purchaseFeedback = "이전 구매를 확인했어요."
            }
        } label: {
            Label("이전 구매 복원", systemImage: "arrow.clockwise.circle")
        }
        .buttonStyle(.bordered)
        .disabled(subscriptions.isPurchasing)
    }

    // MARK: - Purchase

    private func purchase(_ product: SubscriptionProduct) async {
        let result = await subscriptions.purchase(product)
        purchaseFeedback = result.userMessage
        if result.isSuccess {
            // 백엔드 plan/구독 row 도 함께 새로고침해 UI 일관성 유지.
            await auth.refreshUser()
            await socialFeatures.refreshAll(session: auth.session, force: true)
        }
    }

    private func giftPersonalPass() async {
        let success = await socialFeatures.giftPersonalPass(session: auth.session)
        await auth.refreshUser()
        guard success else { return }

        let refreshedTargets = shareableVouchersForPlan(
            socialFeatures.vouchers,
            planKey: "personal"
        )
        if !refreshedTargets.isEmpty {
            voucherShareTargets = refreshedTargets
        }
    }

    private func refreshAndOpenVoucherShare(planKey: String) async {
        await socialFeatures.refreshAll(session: auth.session, force: true)
        let refreshedTargets = shareableVouchersForPlan(
            socialFeatures.vouchers,
            planKey: planKey
        )
        if refreshedTargets.isEmpty {
            purchaseFeedback = "공유할 이용권 코드가 없어요."
        } else {
            voucherShareTargets = refreshedTargets
        }
    }
}

