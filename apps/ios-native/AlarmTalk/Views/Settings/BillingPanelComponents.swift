import SwiftUI
import StoreKit
import UIKit

// BillingPanel 에서 분리한 하위 카드/시트 컴포넌트. 동작/디자인 변경 없음.

struct CurrentPassSummaryCard: View {
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
                    .foregroundStyle(AlarmTalkTheme.primaryDark)
                Text(planName)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(AlarmTalkTheme.text)
            }

            HStack(spacing: 8) {
                PassSummaryChip(label: priceText)
                PassSummaryChip(label: capacityText)
            }

            Text(statusText)
                .font(.subheadline)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AlarmTalkTheme.primary.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(AlarmTalkTheme.primary.opacity(0.18), lineWidth: 1)
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

struct PassSummaryChip: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .foregroundStyle(AlarmTalkTheme.text)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(AlarmTalkTheme.surface.opacity(0.86), in: Capsule())
            .overlay(
                Capsule()
                    .stroke(AlarmTalkTheme.outline.opacity(0.8), lineWidth: 1)
            )
    }
}

func passPlanName(planKey: String?, fallback: String?) -> String {
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

func formatPassDate(_ value: String?) -> String? {
    guard let value else { return nil }
    let date = BillingISODateFormatter.date(from: value)
        ?? BillingShortISODateFormatter.date(from: value)
    guard let date else { return nil }
    return BillingDisplayDateFormatter.string(from: date)
}

func formatKrw(_ value: Int) -> String {
    BillingKrwFormatter.string(from: NSNumber(value: value)) ?? "\(value)"
}

// ISO8601DateFormatter 인스턴스는 iOS 7 이후 thread-safe (Apple docs).
// 초기화 후 formatOptions 만 읽으므로 nonisolated(unsafe) 로 표시.
nonisolated(unsafe) private let BillingISODateFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

nonisolated(unsafe) private let BillingShortISODateFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}()

let BillingDisplayDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = "yyyy.MM.dd"
    return formatter
}()

let BillingKrwFormatter: NumberFormatter = {
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
    let isBusy: Bool
    let vouchers: [VoucherItem]
    let onPurchase: (SubscriptionProduct) -> Void
    let onGiftPersonal: () -> Void
    let onShareVouchers: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(tier.displayLabel)
                            .font(.headline)
                            .foregroundStyle(AlarmTalkTheme.text)
                        if tier != .free {
                            FeatureLockBadge(size: 20, iconSize: 11, tier: tier)
                        }
                    }
                    Text(Self.description(for: tier))
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                if isCurrent {
                    Text("이용 중")
                        .font(.caption.weight(.semibold))
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(Capsule().fill(AlarmTalkTheme.primary.opacity(0.15)))
                        .foregroundStyle(AlarmTalkTheme.primary)
                }
            }

            if tier == .free {
                Text("₩0")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.text)
            } else {
                purchaseButtons
            }

            if tier == .personal {
                Button(action: onGiftPersonal) {
                    Label("개인 이용권 선물하기", systemImage: "gift")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .disabled(isBusy || subscriptions.isPurchasing)
            }

            if !vouchers.isEmpty {
                Button(action: onShareVouchers) {
                    Label("이용권 코드 공유", systemImage: "square.and.arrow.up")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .disabled(isBusy || subscriptions.isPurchasing)
            }
        }
        .padding(12)
        .background(AlarmTalkTheme.surfaceVariant)
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
            .tint(AlarmTalkTheme.primary)
            .foregroundStyle(.white)
            .disabled(isBusy || subscriptions.isPurchasing || isCurrent)
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
        case .free:     return "기본 알람과 무료 목소리 한 슬롯"
        case .personal: return "목소리 슬롯 무제한, 광고 제거, 개인 이용권 선물"
        case .couple:   return "두 사람의 알람과 메시지 공유"
        case .family:   return "최대 6인 가족 공유 알람"
        }
    }
}

struct PersonalGiftPassSheet: View {
    let onDismiss: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("개인 이용권 선물하기")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text("받는 사람이 직접 등록할 수 있는 개인 이용권 코드를 만들어요. 내 이용권은 그대로 유지돼요.")
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
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

            Button(action: onConfirm) {
                Text("선물 코드 만들기")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .foregroundStyle(.white)
        }
        .padding(20)
        .background(AlarmTalkTheme.background)
    }
}

struct CancelSubscriptionSheet: View {
    let subscription: BillingSubscription?
    let onDismiss: () -> Void
    let onConfirm: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("이용권 해지")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text(description)
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
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

            HStack(spacing: 10) {
                Button {
                    onConfirm("at_period_end")
                } label: {
                    Text(periodEndButtonTitle)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.bordered)

                Button(role: .destructive) {
                    onConfirm("immediate")
                } label: {
                    Text("지금 해지하기")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.error)
                .foregroundStyle(.white)
            }
        }
        .padding(20)
        .background(AlarmTalkTheme.background)
    }

    private var periodEndButtonTitle: String {
        if let endDate {
            return "\(endDate)에 해지"
        }
        return "종료일에 해지"
    }

    private var description: String {
        if let endDate {
            return "종료일인 \(endDate)까지 이용권을 유지하거나, 지금 바로 무료 이용권으로 전환할 수 있어요. 무료로 전환되면 만든 목소리, 관련 메시지, 목소리 알람이 삭제되고 일반 알람만 사용할 수 있어요."
        }
        return "해지 시점을 선택해 주세요. 무료로 전환되면 만든 목소리, 관련 메시지, 목소리 알람이 삭제되고 일반 알람만 사용할 수 있어요."
    }

    private var endDate: String? {
        formatPassDate(subscription?.expiresAt)
    }
}

struct VoucherShareSelectionSheet: View {
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
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text("아직 등록되지 않은 코드를 골라 바로 공유할 수 있어요.")
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
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
        .background(AlarmTalkTheme.background)
        .sheet(isPresented: $isSharePresented) {
            BillingActivityShareSheet(text: shareText)
                .ignoresSafeArea()
        }
    }
}

struct VoucherShareRow: View {
    let voucher: VoucherItem
    let onShare: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(voucher.code)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.text)
                    .textSelection(.enabled)
                Text(voucherShareSubtitle(voucher))
                    .font(.caption)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            Spacer()
            Button(action: onShare) {
                Text("공유")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .foregroundStyle(.white)
        }
        .padding(12)
        .background(AlarmTalkTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct BillingActivityShareSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

func shareableVouchersForPlan(_ vouchers: [VoucherItem], planKey: String) -> [VoucherItem] {
    vouchers.filter { voucher in
        ["issued", "active", "pending"].contains(voucher.status) &&
            (voucher.useCount ?? 0) < (voucher.maxUses ?? 1) &&
            voucher.planKey == planKey
    }
}

func voucherShareSubtitle(_ voucher: VoucherItem) -> String {
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
                .foregroundStyle(AlarmTalkTheme.textSecondary)
            Text(value)
                .font(.headline)
                .foregroundStyle(AlarmTalkTheme.text)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AlarmTalkTheme.surfaceVariant)
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
