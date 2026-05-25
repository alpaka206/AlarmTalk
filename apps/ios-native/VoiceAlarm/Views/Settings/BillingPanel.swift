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
    @State private var voucherShareTargets: [VoucherItem] = []

    private var currentTier: PlanTier {
        // StoreKit currentEntitlements 가 권위. 백엔드 plan key 는 fallback.
        let storeTier = subscriptions.currentTier
        if storeTier != .free { return storeTier }
        return PlanTier.from(socialFeatures.subscription?.plan?.key)
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
                    vouchers: shareableVouchers,
                    onPurchase: { product in
                        Task { await purchase(product) }
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
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("나가면 무료 이용권으로 전환돼요. 다시 들어오려면 새 초대 코드가 필요해요.")
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
            await socialFeatures.refreshAll(session: auth.session, force: true)
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

private struct CurrentPassSummaryCard: View {
    let subscription: BillingSubscription?
    let currentPlan: BillingPlan?
    let nextPlan: BillingPlanSummary?
    let currentTier: PlanTier
    let isSharedMember: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("현재 이용권")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.primaryDark)
                Text(planName)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(VoiceAlarmTheme.text)
            }

            HStack(spacing: 8) {
                PassSummaryChip(label: priceText)
                PassSummaryChip(label: capacityText)
            }

            Text(statusText)
                .font(.subheadline)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(VoiceAlarmTheme.primary.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(VoiceAlarmTheme.primary.opacity(0.18), lineWidth: 1)
        )
    }

    private var planKey: String {
        currentPlan?.key ?? currentTier.apiKey
    }

    private var planName: String {
        passPlanName(planKey: planKey, fallback: currentPlan?.name ?? currentTier.displayLabel)
    }

    private var statusText: String {
        let expiresAt = formatPassDate(subscription?.expiresAt)
        let cancelScheduled = subscription?.cancelAtPeriodEnd == true

        if isSharedMember {
            return "공유 이용권에 참여 중이에요."
        }
        if cancelScheduled, let nextPlan {
            let nextName = passPlanName(planKey: nextPlan.key, fallback: nextPlan.name)
            if let expiresAt {
                return "\(expiresAt) 이후 \(nextName) 이용권으로 변경돼요."
            }
            return "\(nextName) 이용권으로 변경 예정이에요."
        }
        if cancelScheduled {
            if let expiresAt {
                return "\(expiresAt)까지 사용 후 종료돼요."
            }
            return "현재 이용권이 종료 예정이에요."
        }
        if subscription != nil, let expiresAt {
            return "\(expiresAt)까지 사용할 수 있어요."
        }
        if subscription != nil {
            return "사용 중인 이용권이에요."
        }
        return "기본 알람은 무료로 사용할 수 있어요."
    }

    private var priceText: String {
        guard currentPlan != nil else {
            return currentTier == .free ? "0원" : "App Store 결제"
        }
        guard let price = currentPlan?.priceKrw, price > 0 else {
            return "0원"
        }
        return "월 \(formatKrw(price))원"
    }

    private var capacityText: String {
        guard let maxMembers = currentPlan?.maxMembers, maxMembers > 1 else {
            return "개인 사용"
        }
        return "최대 \(maxMembers)명"
    }
}

private struct PassSummaryChip: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .foregroundStyle(VoiceAlarmTheme.text)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(VoiceAlarmTheme.surface.opacity(0.86), in: Capsule())
            .overlay(
                Capsule()
                    .stroke(VoiceAlarmTheme.outline.opacity(0.8), lineWidth: 1)
            )
    }
}

private func passPlanName(planKey: String?, fallback: String?) -> String {
    switch planKey {
    case "free":
        return "무료"
    case "personal", "individual", "plus":
        return "개인"
    case "couple":
        return "커플"
    case "family":
        return "가족"
    default:
        if let fallback, !fallback.isEmpty {
            return fallback
        }
        return "이용권"
    }
}

private func formatPassDate(_ value: String?) -> String? {
    guard let value else { return nil }
    let date = BillingISODateFormatter.date(from: value)
        ?? BillingShortISODateFormatter.date(from: value)
    guard let date else { return nil }
    return BillingDisplayDateFormatter.string(from: date)
}

private func formatKrw(_ value: Int) -> String {
    BillingKrwFormatter.string(from: NSNumber(value: value)) ?? "\(value)"
}

private let BillingISODateFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private let BillingShortISODateFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}()

private let BillingDisplayDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = "yyyy.MM.dd"
    return formatter
}()

private let BillingKrwFormatter: NumberFormatter = {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    return formatter
}()

/// 결제 플랜 카드 한 장. IAP 가격은 StoreKit `Product.displayPrice` 를 그대로
/// 사용해 region/통화/세금이 자동 반영된다.
struct PlanCard: View {
    @EnvironmentObject private var subscriptions: SubscriptionManager
    let tier: PlanTier
    let isCurrent: Bool
    let vouchers: [VoucherItem]
    let onPurchase: (SubscriptionProduct) -> Void
    let onShareVouchers: () -> Void

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

            if !vouchers.isEmpty {
                Button(action: onShareVouchers) {
                    Label("이용권 코드 공유", systemImage: "square.and.arrow.up")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .disabled(subscriptions.isPurchasing)
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

private struct VoucherShareSelectionSheet: View {
    let vouchers: [VoucherItem]
    let onDismiss: () -> Void

    @State private var shareText: String = ""
    @State private var isSharePresented = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("공유할 이용권 선택")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                    Text("아직 등록되지 않은 코드를 골라 바로 공유할 수 있어요.")
                        .font(.footnote)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.subheadline.weight(.semibold))
                        .padding(8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("닫기")
            }

            VStack(spacing: 10) {
                ForEach(vouchers) { voucher in
                    VoucherShareRow(voucher: voucher) {
                        shareText = voucher.code
                        UIPasteboard.general.string = voucher.code
                        isSharePresented = true
                    }
                }
            }
        }
        .padding(20)
        .background(VoiceAlarmTheme.background)
        .sheet(isPresented: $isSharePresented) {
            BillingActivityShareSheet(text: shareText)
                .ignoresSafeArea()
        }
    }
}

private struct VoucherShareRow: View {
    let voucher: VoucherItem
    let onShare: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(voucher.code)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                    .textSelection(.enabled)
                Text(voucherShareSubtitle(voucher))
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Spacer()
            Button(action: onShare) {
                Text("공유")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .foregroundStyle(.white)
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct BillingActivityShareSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private func shareableVouchersForPlan(_ vouchers: [VoucherItem], planKey: String) -> [VoucherItem] {
    vouchers.filter { voucher in
        ["issued", "active", "pending"].contains(voucher.status) &&
            (voucher.useCount ?? 0) < (voucher.maxUses ?? 1) &&
            voucher.planKey == planKey
    }
}

private func voucherShareSubtitle(_ voucher: VoucherItem) -> String {
    if let issuedAt = formatPassDate(voucher.issuedAt) {
        return "미등록 · 발급일 \(issuedAt)"
    }
    return "미등록"
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
