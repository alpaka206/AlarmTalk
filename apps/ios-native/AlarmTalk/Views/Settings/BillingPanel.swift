import SwiftUI
import StoreKit
import UIKit

/// 이용권/구독 패널.
///
/// Phase 4-D1 갱신:
///   - 디지털 구독은 Apple StoreKit2 IAP 가 권위(authoritative). 기존
///     `socialFeatures.checkout(planKey:)` 호출은 deprecated 되었고, 본 패널은
///     `SubscriptionManager.purchase(_:)` 를 통한 IAP 흐름으로 통합됨.
///   - 각 유료 플랜 카드에 월간 가격 버튼이 노출되며, 가격은 Apple
///     `Product.displayPrice` (지역 통화/세금 포함) 를 그대로 보여준다.
///   - "이전 구매 복원" 버튼이 하단에 추가됨 — Apple 심사 가이드라인 3.1.1 요구.
///   - free 플랜 카드는 정보 표시만 (구매 버튼 없음).
///
/// Phase 3-C3 호환 노트
///   - 백엔드 표준 plan key (`free` / `personal` / `couple` / `family`) 는 그대로.
///   - 비-IAP 흐름 (`/billing/vouchers/family-share`, `/code/register`) 은
///     SocialFeatureViewModel 이 계속 담당.
///
/// ⚠ **'이용권 변경(지금 / 종료일에)' 을 만들지 말 것 — 양쪽 다 그렇다.**
/// 예전 주석은 '안드로이드에는 있다' 고 적었는데, 그 버튼은 **dev 플레이버 전용 스텁**이고
/// 운영에서는 409 로 항상 실패한다(2026-08-11 확인). 두 스토어 모두 전환을 자기가 처리하고
/// **시점도 자기가 정한다** — 규칙은 `docs/spec/billing-lifecycle.md` 「플랜 변경」이 단일 출처다. iOS 는 네 플랜이 **같은 구독 그룹**이라 다른 플랜 카드를
/// 사는 것 자체가 StoreKit 업그레이드/다운그레이드이고, **시점은 Apple 이 정한다**
/// (업그레이드 즉시+비례정산 / 다운그레이드는 갱신일). Apple 확인 시트가 그걸 문장으로
/// 알려 주므로, 우리가 고르는 UI 를 얹으면 지킬 수 없는 약속이 된다.
/// 지금 플랜 카드에는 **버튼이 아예 없고**(안드로이드와 같다), 나머지 카드는 그대로
/// 눌리되 라벨이 '이용권 변경' 인 게 그 경로다 — 결제가 아니라 전환이라는 뜻이다.
/// (해지는 우리 백엔드가 처리하므로 '지금/종료일' 두 갈래가 그대로 있다.)
struct BillingPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

    /// 결제 결과를 사용자에게 토스트로 알리기 위한 transient 메시지.
    @State private var purchaseFeedback: String?
    @State private var showLeaveSharedPassConfirm = false
    @State private var showCancelSubscriptionSheet = false
    @State private var showCancelImmediateConfirm = false
    @State private var showPersonalGiftSheet = false
    @State private var voucherShareTargets: [VoucherItem] = []
    /// 결제 확인 대기 중인 플랜. nil 이면 알럿이 닫혀 있다.
    @State private var pendingPurchase: PendingPlanPurchase?

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
            // ⚠ **상단 '현재 이용권' 요약 카드를 되살리지 말 것**(2026-08-11 요청).
            // 플랜 카드가 이미 '현재 이용권' 배지로 지금 등급을 말하는데, 그 위에 흰 박스를
            // 한 겹 더 두면 같은 사실을 두 번 말하면서 정작 고르는 카드들을 아래로 민다.
            // 안드로이드에도 그 카드가 없다.
            //
            // ⚠ '이용권 선택' 머리말도 뺐다 — 화면 제목이 이미 '이용권' 이다.

            if subscriptions.isLoadingProducts && subscriptions.products.isEmpty {
                // 첫 로딩 — 일시적 빈 상태가 망가진 화면처럼 보이지 않도록 스켈레톤.
                BillingPlansSkeleton()
            } else if subscriptions.products.isEmpty
                && subscriptions.productFetchFailed
                && subscriptions.hasAttemptedProductFetch {
                // 가져오기 실패(일시적 blip)로 제품이 비어버린 경우 — 영구 비활성
                // 대신 "다시 시도" 로 재요청할 수 있게 한다.
                BillingProductsErrorState(isRetrying: subscriptions.isLoadingProducts) {
                    Task { await subscriptions.fetchProducts() }
                }
            } else {
                ForEach(PlanTier.allCases, id: \.self) { tier in
                    let shareableVouchers = shareableVouchersForPlan(
                        socialFeatures.vouchers,
                        planKey: tier.apiKey
                    )
                    PlanCard(
                        tier: tier,
                        isCurrent: tier == currentTier,
                        hasActivePlan: currentTier != .free,
                        isBusy: socialFeatures.isBusy,
                        vouchers: shareableVouchers,
                        onPurchase: { product in
                            // ⚠ **바로 결제로 보내지 말 것.** 전환일 때는 스토어 시트가
                            // 말해 주지 않는 게 있다 — **언제 바뀌는지**(업그레이드 즉시 /
                            // 다운그레이드는 다음 갱신일)와 **정원이 줄면 멤버가 나간다**는
                            // 사실. 안드로이드는 이미 확인 모달로 말하고 있었는데 iOS 만
                            // 곧장 StoreKit 으로 갔다(2026-08-11 대조).
                            pendingPurchase = PendingPlanPurchase(product: product, tier: tier)
                        },
                        onGiftPersonal: {
                            showPersonalGiftSheet = true
                        },
                        onShareVouchers: {
                            Task { await refreshAndOpenVoucherShare(planKey: tier.apiKey) }
                        }
                    )
                }
            }

            // ⚠ **복원 → 해지·나가기 순서로 **붙여** 둔다**(2026-08-24 지시, 안드로이드
            // `BillingPanels.kt` 와 같은 배치). 예전에는 이 둘 사이에 약관 각주와 결과
            // 메시지가 끼어 있어 **다른 묶음처럼** 보였다. 되돌릴 수 있는 액션(복원)이
            // 위, 되돌릴 수 없는 액션(해지·나가기)이 아래다.
            restorePurchasesButton

            if isSharedMember {
                Button(role: .destructive) {
                    showLeaveSharedPassConfirm = true
                } label: {
                    // ⚠ **'이전 구매 복원' 과 같은 폭·같은 여백이다**(2026-08-24 지시).
                    // 글자 폭에 맞춘 작은 버튼으로 되돌리지 말 것 — 위아래 버튼이 전부
                    // 화면 폭인데 여기만 작으면 눌러야 할 것으로 보이지 않는다.
                    Label("공유 이용권에서 나가기", systemImage: "rectangle.portrait.and.arrow.right")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .disabled(socialFeatures.isBusy)
            } else if socialFeatures.subscription?.subscription != nil {
                Button(role: .destructive) {
                    showCancelSubscriptionSheet = true
                } label: {
                    // 나가기와 **같은 글리프**다 — 둘 다 이 이용권에서 빠져나가는 뜻이고,
                    // 한 자리에서 갈리는 if/else 라 아이콘까지 다르면 다른 버튼처럼 보인다.
                    // 나가기와 **같은 자리·같은 규격**이다(if/else 로 갈리는 한 버튼이라
                    // 한쪽만 작으면 계정 종류에 따라 다른 화면처럼 보인다).
                    Label("이용권 해지", systemImage: "rectangle.portrait.and.arrow.right")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .disabled(socialFeatures.isBusy)
            }

            SubscriptionTermsFootnote()

            if let feedback = purchaseFeedback {
                Text(feedback)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                    .padding(.top, 4)
            }

            if let lastError = subscriptions.lastError {
                Text(lastError)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.error)
                    .padding(.top, 4)
            }

            if !socialFeatures.vouchers.isEmpty {
                Text("공유 코드")
                    .font(.subheadline.weight(.semibold))
                ForEach(socialFeatures.vouchers.prefix(5)) { voucher in
                    VoucherRow(voucher: voucher)
                }
            }
        }
        // ⚠ **`.sectionSurface()` 로 되돌리지 말 것**(2026-08-11 요청). 플랜 카드들이 이미
        // 각자 카드라, 그 전체를 또 한 겹 카드로 감싸면 **카드 안의 카드**가 된다 —
        // 실기에서 요금 상자들을 큰 상자가 다시 감싸고 있었다. 안드로이드는 플랜 카드만
        // 세로로 늘어놓는다.
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
        // ⚠ **해지는 2단이다**(안드로이드 `BillingPanels.kt` `CancelSubscriptionDialog`).
        // '지금 해지' 는 남은 기간 비례 환불 + 목소리 3일 뒤 영구 삭제라 되돌릴 수 없는데,
        // iOS 는 커스텀 시트에서 **한 번의 탭으로** 실행하고 있었다. 종료일 해지는 되돌릴
        // 수 있으니 1단으로 두고, 즉시 해지만 한 번 더 묻는다.
        //
        // 커스텀 시트를 쓰지 않는 이유: 확인형 모달은 iOS 표준 `.alert` 다(CLAUDE.md —
        // 안드로이드의 IosAlertDialog 가 이걸 흉내 낸 것이므로, iOS 에서 껍데기를 새로
        // 만들면 오히려 원본에서 멀어진다).
        // ⚠ 문구는 안드로이드 `billing_play_*` 문자열과 **글자까지 같다**(스토어 이름만 다르다).
        .alert(
            pendingPurchaseTitle,
            isPresented: Binding(
                get: { pendingPurchase != nil },
                set: { if !$0 { pendingPurchase = nil } }
            ),
            presenting: pendingPurchase
        ) { pending in
            Button("결제하기") {
                pendingPurchase = nil
                Task { await purchase(pending.product) }
            }
            Button("취소", role: .cancel) { pendingPurchase = nil }
        } message: { pending in
            Text(purchaseMessage(for: pending))
        }
        .alert("이용권을 해지할까요?", isPresented: $showCancelSubscriptionSheet) {
            Button(cancelPeriodEndTitle) {
                Task {
                    await socialFeatures.cancelSubscription(mode: "at_period_end", session: auth.session)
                    await auth.refreshUser()
                }
            }
            Button("지금 해지", role: .destructive) { showCancelImmediateConfirm = true }
            Button("취소", role: .cancel) {}
        } message: {
            Text(cancelDescription)
        }
        // ⚠ **해지의 유일한 길이다(App Store 결제일 때).** Apple 자동갱신 구독은 서버가
        // 못 끊어서 백엔드가 `STORE_CANCEL_UNSUPPORTED` 로 거절하고 아무것도 바꾸지 않는다.
        // 그 신호를 받으면 시스템 구독 관리 시트를 연다 — 이게 없으면 "해지에 실패했어요"
        // 만 남고 앱 안에서 해지할 방법이 사라진다(심사 거절 사유이기도 하다).
        //
        // `AppStore.showManageSubscriptions(in:)` 는 시트를 **앱 안에서** 띄운다. URL 로
        // App Store 를 여는 폴백은 앱을 떠나므로, 시트를 못 띄울 때만 쓴다.
        .onChange(of: socialFeatures.needsAppStoreSubscriptionManagement) { _, needs in
            guard needs else { return }
            socialFeatures.needsAppStoreSubscriptionManagement = false
            Task { await openAppStoreSubscriptionManagement() }
        }
        .alert("지금 바로 해지할까요?", isPresented: $showCancelImmediateConfirm) {
            Button("지금 해지하기", role: .destructive) {
                Task {
                    await socialFeatures.cancelSubscription(mode: "immediate", session: auth.session)
                    await auth.refreshUser()
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("남은 기간 요금은 비례 환불되고 이용권이 바로 종료돼요. 목소리는 3일간 보관돼요. 그 안에 이용권을 다시 등록하면 그대로 쓸 수 있고, 지나면 영구 삭제돼요.")
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

    // MARK: - App Store 구독 관리

    /// 시스템 구독 관리 시트를 띄운다. 실패하면 App Store 링크로 폴백한다.
    ///
    /// ⚠ **조용히 실패하게 두지 말 것.** 둘 다 실패하면 사용자는 해지 버튼을 눌렀는데
    /// 아무 일도 일어나지 않는 걸 보게 된다 — 그때는 어디로 가야 하는지 글로 알려 준다.
    @MainActor
    private func openAppStoreSubscriptionManagement() async {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        if let scene {
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                // 시트에서 해지했을 수 있다 — 닫히면 서버 상태를 다시 읽는다.
                await subscriptions.resyncEntitlements()
                await auth.refreshUser()
                await socialFeatures.refreshAll(session: auth.session, force: true)
                return
            } catch {
                // 시트를 못 띄웠다 — 아래 URL 폴백으로 이어진다.
            }
        }
        if let url = URL(string: "https://apps.apple.com/account/subscriptions"),
           UIApplication.shared.canOpenURL(url) {
            await UIApplication.shared.open(url)
            return
        }
        purchaseFeedback = "설정 앱 > Apple 계정 > 구독 에서 해지할 수 있어요."
    }

    // MARK: - Restore

    private var restorePurchasesButton: some View {
        Button {
            Task {
                let result = await subscriptions.restorePurchases()
                // 복원이 성공한 경우에만 백엔드 entitlement 재동기화 + 상태 새로고침.
                if result.isSuccess {
                    await subscriptions.resyncEntitlements()
                    await auth.refreshUser()
                    await socialFeatures.refreshAll(session: auth.session, force: true)
                }
                // 복원됨 N건 / 복원할 구매 없음 / 오류 를 구분해 안내한다.
                purchaseFeedback = result.userMessage
            }
        } label: {
            HStack(spacing: 6) {
                if subscriptions.isPurchasing {
                    ProgressView()
                        .controlSize(.small)
                }
                Label("이전 구매 복원", systemImage: "arrow.clockwise.circle")
            }
            // ⚠ **글자 폭에 맞춘 작은 버튼으로 되돌리지 말 것**(2026-08-17 지시).
            // 위쪽 결제·선물 버튼이 전부 화면 폭인데 여기만 작으면 **눌러야 할 것으로
            // 보이지 않는다.** 같은 폭·같은 세로 여백으로 둔다(안드로이드도 같다).
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        .buttonStyle(.bordered)
        .disabled(subscriptions.isPurchasing)
    }

    // MARK: - Purchase

    private var pendingPurchaseTitle: String {
        guard let pending = pendingPurchase else { return "" }
        let name = pending.tier.displayLabel
        return isPlanChange(to: pending.tier)
            ? "\(name) 이용권으로 바꿀까요?"
            : "\(name) 이용권을 시작할까요?"
    }

    /// 이미 유료 이용권을 쓰는 중에 다른 플랜을 고른 것 = 전환.
    private func isPlanChange(to tier: PlanTier) -> Bool {
        currentTier != .free && currentTier != tier
    }

    /// 시점은 **스토어가 정한다**(업그레이드 즉시+비례정산 / 다운그레이드는 다음 갱신일).
    /// 우리가 고르게 하지는 않되, 무엇이 언제 일어나는지는 말한다.
    private func purchaseMessage(for pending: PendingPlanPurchase) -> String {
        let name = pending.tier.displayLabel
        guard isPlanChange(to: pending.tier) else {
            // 카드에 쓰는 것과 **같은 가격**이다(StoreKit 값 우선, 없으면 폴백표).
            let price = subscriptions.products
                .first(where: { $0.id == pending.product.rawValue })?.displayPrice
                ?? FallbackPlanPrice.label(for: pending.tier)
                ?? ""
            return price.isEmpty
                ? "\(name) 이용권을 App Store로 안전하게 결제해요. 가격은 결제 화면에서 확인할 수 있고, 언제든 해지할 수 있어요. 해지해도 남은 기간은 그대로 이용할 수 있어요."
                : "\(name) 이용권은 \(price)이에요. App Store로 안전하게 결제되고 언제든 해지할 수 있어요. 해지해도 남은 기간은 그대로 이용할 수 있어요."
        }
        let upgrade = pending.tier.meetsOrExceeds(currentTier) && pending.tier != currentTier
        var text = upgrade
            ? "지금 바로 \(name) 이용권으로 바뀌어요. 남은 기간은 새 이용권 기준으로 환산돼요."
            : "지금은 결제되지 않아요. 지금 이용권을 기간 끝까지 쓰고, 다음 갱신일에 \(name) 이용권으로 바뀌어요."
        // 정원이 줄면 사람이 빠진다 — 결제 뒤에 알면 늦다.
        if !upgrade, pending.tier.sharedSeats < currentTier.sharedSeats {
            text += " 함께 쓰는 인원이 줄어서, 정원을 넘는 멤버는 그룹에서 나가게 돼요."
        }
        return text
    }

    private func purchase(_ product: SubscriptionProduct) async {
        let result = await subscriptions.purchase(product)
        purchaseFeedback = result.userMessage
        if result.isSuccess {
            // 백엔드 plan/구독 row 도 함께 새로고침해 UI 일관성 유지.
            await auth.refreshUser()
            await socialFeatures.refreshAll(session: auth.session, force: true)
        }
    }

    /// 선물 이용권 **구매**.
    ///
    /// ⚠ **결제 없이 코드를 만들지 않는다.** 예전에는 `POST /billing/checkout` 의
    /// `gift: true` 를 불렀는데, 그건 무결제 발급이라 서버가 production 에서 항상 막는다
    /// (열면 누구나 무료로 유료 이용권을 뽑을 수 있다). 이제 소모성 상품을 실제로 사고,
    /// 서버가 그 영수증을 검증해 바우처를 만든다.
    private func giftPersonalPass() async {
        let result = await subscriptions.purchase(.personalGift)
        switch result {
        case .success:
            // 영수증 동기화(`syncWithBackend`)가 이미 서버에 바우처를 만들었다.
            // 목록을 새로 받아 방금 생긴 코드를 화면에 띄운다.
            await socialFeatures.refreshAll(session: auth.session, force: true)
        case .userCancelled:
            return
        case .pending:
            socialFeatures.statusMessage = "결제 승인을 기다리고 있어요. 완료되면 코드가 만들어져요."
            return
        case .failure(let reason):
            socialFeatures.statusMessage = reason
            return
        }
        // 여기 오는 건 `.success` 하나뿐이다(나머지 갈래는 위에서 전부 return).
        // 예전에는 `let success = true` + `guard success else { return }` 가 남아 있어
        // **없는 실패 경로가 있는 것처럼** 보였다 — 컴파일러도 "will never be executed"
        // 로 잡았다.
        await auth.refreshUser()

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

    /// 종료일이 있으면 날짜를 박는다 — '언제까지 쓰는지' 가 이 선택의 전부다.
    private var cancelPeriodEndTitle: String {
        if let end = formatPassDate(socialFeatures.subscription?.subscription?.expiresAt) {
            return "\(end)에 해지"
        }
        return "종료일에 해지"
    }

    private var cancelDescription: String {
        if let end = formatPassDate(socialFeatures.subscription?.subscription?.expiresAt) {
            return "종료일 해지는 \(end)까지 그대로 쓰고 끝나요. 지금 해지하면 남은 기간 요금은 비례 환불되고 이용권이 바로 종료돼요."
        }
        return "해지 시점을 선택해 주세요. 종료일 해지는 이번 이용 기간까지 그대로 쓸 수 있어요. 지금 해지하면 남은 기간 요금은 비례 환불돼요."
    }

}

