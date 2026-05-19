import SwiftUI
import StoreKit

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

    private var currentTier: PlanTier {
        // StoreKit currentEntitlements 가 권위. 백엔드 plan key 는 fallback.
        let storeTier = subscriptions.currentTier
        if storeTier != .free { return storeTier }
        return PlanTier.from(socialFeatures.subscription?.plan?.key)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            headerSection

            ForEach(PlanTier.allCases, id: \.self) { tier in
                PlanCard(
                    tier: tier,
                    isCurrent: tier == currentTier,
                    onPurchase: { product in
                        Task { await purchase(product) }
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

            if socialFeatures.subscription?.subscription != nil {
                Button(role: .destructive) {
                    Task { await socialFeatures.cancelSubscription(session: auth.session) }
                } label: {
                    Label("구독 해지 예약", systemImage: "xmark.circle")
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
        }
    }

    // MARK: - Header

    @ViewBuilder
    private var headerSection: some View {
        let subscription = socialFeatures.subscription?.subscription
        let plan = socialFeatures.subscription?.plan
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(plan?.name ?? currentTier.displayLabel)
                    .font(.headline)
                Text(subscription?.status ?? statusLabel(for: currentTier))
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Spacer()
            if let expiresAt = subscription?.expiresAt {
                PermissionPill(text: "만료 \(expiresAt)")
            }
            if subscriptions.isLoadingProducts {
                ProgressView().controlSize(.small)
            }
        }
    }

    private func statusLabel(for tier: PlanTier) -> String {
        tier == .free ? "free" : "active"
    }

    // MARK: - Restore

    private var restorePurchasesButton: some View {
        Button {
            Task {
                await subscriptions.restorePurchases()
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
            await socialFeatures.refreshAll(session: auth.session)
        }
    }
}

/// 결제 플랜 카드 한 장. IAP 가격은 StoreKit `Product.displayPrice` 를 그대로
/// 사용해 region/통화/세금이 자동 반영된다.
struct PlanCard: View {
    @EnvironmentObject private var subscriptions: SubscriptionManager
    let tier: PlanTier
    let isCurrent: Bool
    let onPurchase: (SubscriptionProduct) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(tier.displayLabel)
                            .font(.headline)
                            .foregroundStyle(VoiceAlarmTheme.text)
                        if tier != .free {
                            FeatureLockBadge(size: 20, iconSize: 11, tier: tier)
                        }
                    }
                    Text(Self.description(for: tier))
                        .font(.footnote)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                if isCurrent {
                    Text("이용 중")
                        .font(.caption.weight(.semibold))
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(Capsule().fill(VoiceAlarmTheme.primary.opacity(0.15)))
                        .foregroundStyle(VoiceAlarmTheme.primary)
                }
            }

            if tier == .free {
                Text("₩0")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.text)
            } else {
                purchaseButtons
            }
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    /// 월간 / 연간 두 가격 버튼. Product 가 아직 fetch 되지 않았으면 비활성.
    @ViewBuilder
    private var purchaseButtons: some View {
        let monthly = SubscriptionProduct.make(tier: tier, period: .monthly)
        let yearly = SubscriptionProduct.make(tier: tier, period: .yearly)
        HStack(spacing: 8) {
            if let plan = monthly {
                priceButton(for: plan, periodLabel: "월")
            }
            if let plan = yearly {
                priceButton(for: plan, periodLabel: "년")
            }
        }
    }

    @ViewBuilder
    private func priceButton(for plan: SubscriptionProduct, periodLabel: String) -> some View {
        if let product = subscriptions.product(for: plan) {
            Button {
                onPurchase(plan)
            } label: {
                VStack(spacing: 2) {
                    Text(product.displayPrice)
                        .font(.subheadline.weight(.semibold))
                    Text("/ \(periodLabel)")
                        .font(.caption2)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .foregroundStyle(.white)
            .disabled(subscriptions.isPurchasing || isCurrent)
        } else {
            // 제품이 아직 로드되지 않았거나 App Store Connect 에 등록되지 않은 경우.
            Button {
                // no-op
            } label: {
                VStack(spacing: 2) {
                    Text("준비중")
                        .font(.subheadline.weight(.semibold))
                    Text("/ \(periodLabel)")
                        .font(.caption2)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.bordered)
            .disabled(true)
        }
    }

    private static func description(for tier: PlanTier) -> String {
        switch tier {
        case .free:     return "기본 알람과 무료 보이스 한 슬롯"
        case .personal: return "보이스 슬롯 무제한, 광고 제거"
        case .couple:   return "두 사람의 알람과 메시지 공유"
        case .family:   return "최대 6인 가족 공유 알람"
        }
    }
}

/// 캐릭터 패널/기타 통계 화면에서 쓰는 작은 metric 박스.
struct MetricTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            Text(value)
                .font(.headline)
                .foregroundStyle(VoiceAlarmTheme.text)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

#if DEBUG
#Preview("BillingPanel (light)") {
    ScrollView {
        BillingPanel().padding()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("BillingPanel (dark)") {
    ScrollView {
        BillingPanel().padding()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}

#Preview("MetricTile") {
    HStack(spacing: 10) {
        MetricTile(title: "연속", value: "7일")
        MetricTile(title: "최장", value: "30일")
        MetricTile(title: "오늘 XP", value: "120")
    }
    .padding()
}
#endif
