import SwiftUI
import StoreKit
import UIKit

// BillingPanel 에서 분리한 하위 카드/시트 컴포넌트. 동작/디자인 변경 없음.

struct CurrentPassSummaryCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var subscriptions: SubscriptionManager
    let subscription: BillingSubscription?
    let currentPlan: BillingPlan?
    let nextPlan: BillingPlanSummary?
    let currentTier: PlanTier
    let isSharedMember: Bool

    var body: some View {
        // Android `CurrentPassSummaryCard`(BillingPanels.kt:607-644): WakerCardShape(22)
        // + primaryContainer.copy(alpha=0.36) + wakerCardBorder, 패딩 18 / 간격 16.
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("현재 이용권")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.palette.onPrimaryContainer)
                Text(planName)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(theme.palette.onPrimaryContainer)
            }

            HStack(spacing: 8) {
                PassSummaryChip(label: priceText)
                PassSummaryChip(label: capacityText)
            }

            Text(statusText)
                .font(.subheadline)
                .foregroundStyle(theme.palette.onPrimaryContainer.opacity(0.78))
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                .fill(theme.palette.primaryContainer.opacity(0.36))
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
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

    /// ⚠ **가격의 권위는 App Store 다 — DB `price_krw` 를 쓰지 말 것.**
    /// 플랜 카드는 이미 `Product.displayPrice` 를 쓰는데 이 요약 카드만 DB 값을 써서,
    /// 같은 화면 안에서 **두 가격이 다르게 보일 수 있었다**(스토어에서 가격을 바꾸거나
    /// 프로모션을 걸면, 그리고 한국 밖 사용자에게는 통화부터 틀렸다).
    /// StoreKit 이 지역 통화·세금까지 반영한 문자열을 준다.
    ///
    /// 상품을 아직 못 받았으면 **숫자를 지어내지 않는다** — 모를 땐 결제 수단만 말한다.
    private var priceText: String {
        if currentTier == .free { return "0원" }
        if let productID = SubscriptionProduct.make(tier: currentTier)?.rawValue,
           let product = subscriptions.products.first(where: { $0.id == productID }) {
            return "월 \(product.displayPrice)"
        }
        return "App Store 결제"
    }

    private var capacityText: String {
        guard let maxMembers = currentPlan?.maxMembers, maxMembers > 1 else {
            return "개인 사용"
        }
        return "최대 \(maxMembers)명"
    }
}

struct PassSummaryChip: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let label: String

    var body: some View {
        // Android `PassSummaryChip`(BillingPanels.kt:646-661): WakerPillShape,
        // surface@0.7, onSurface 글자, outlineVariant@0.7 보더.
        Text(label)
            .font(.caption.weight(.semibold))
            .foregroundStyle(theme.palette.onSurface)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(theme.palette.surface.opacity(0.7), in: Capsule())
            .overlay(
                Capsule()
                    .stroke(theme.palette.outlineVariant.opacity(0.7), lineWidth: 1)
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
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var subscriptions: SubscriptionManager
    let tier: PlanTier
    let isCurrent: Bool
    let isBusy: Bool
    let vouchers: [VoucherItem]
    let onPurchase: (SubscriptionProduct) -> Void
    let onGiftPersonal: () -> Void
    let onShareVouchers: () -> Void

    var body: some View {
        // Android `SubscriptionPlanCard`(`ui/billing/BillingPanels.kt`): WakerCardShape(22),
        // 현재 플랜이면 primaryContainer@0.44 / primary@0.48 보더, 아니면 surface /
        // outlineVariant 보더. 헤더에 잠금 뱃지를 두지 않고 기능 불릿 목록을 렌더한다.
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Text(tier.displayLabel)
                    .font(.headline)
                    .foregroundStyle(theme.palette.onSurface)
                Spacer()
                if isCurrent {
                    Text("현재 이용권")
                        .font(.caption.weight(.semibold))
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(Capsule().fill(theme.palette.primary))
                        .foregroundStyle(theme.palette.onPrimary)
                }
            }

            Text(Self.description(for: tier))
                .font(.footnote)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(Self.features(for: tier), id: \.self) { feature in
                    PlanFeatureRow(text: feature)
                }
            }

            if tier == .free {
                Text("₩0")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.palette.onSurface)
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
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                .fill(isCurrent ? theme.palette.primaryContainer.opacity(0.44) : theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                .stroke(
                    isCurrent ? theme.palette.primary.opacity(0.48) : theme.palette.outlineVariant,
                    lineWidth: 1
                )
        )
    }

    /// 월간 가격 버튼 (월간만 판매). Product 가 아직 fetch 되지 않았으면 비활성.
    @ViewBuilder
    private var purchaseButtons: some View {
        if let plan = SubscriptionProduct.make(tier: tier) {
            priceButton(for: plan, periodLabel: "월")
        }
    }

    @ViewBuilder
    private func priceButton(for plan: SubscriptionProduct, periodLabel: String) -> some View {
        if let product = subscriptions.product(for: plan) {
            Button {
                onPurchase(plan)
            } label: {
                VStack(spacing: 2) {
                    if subscriptions.isPurchasing {
                        // 결제 진행 중 — 스피너로 in-progress 를 분명히 한다.
                        ProgressView()
                            .controlSize(.small)
                            .tint(theme.palette.onPrimary)
                    } else {
                        Text(product.displayPrice)
                            .font(.subheadline.weight(.semibold))
                        Text("/ \(periodLabel)")
                            .font(.caption2)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .foregroundStyle(theme.palette.onPrimary)
            .disabled(isBusy || subscriptions.isPurchasing || isCurrent)
        } else if subscriptions.isLoadingProducts || !subscriptions.hasAttemptedProductFetch {
            // 아직 첫 fetch 가 끝나지 않음 — "준비중" 대신 로딩 스켈레톤을 보여줘
            // 첫 진입이 망가진 화면처럼 보이지 않게 한다.
            RoundedRectangle(cornerRadius: 6)
                .fill(theme.palette.outline.opacity(0.18))
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .overlay(ProgressView().controlSize(.small))
                .accessibilityLabel("가격 불러오는 중")
        } else {
            // fetch 가 끝났는데도 제품이 없음 — App Store Connect 미등록 등.
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
        case .personal: return "내 목소리 만들기, 광고 제거, 개인 이용권 선물"
        case .couple:   return "두 사람의 알람과 메시지 공유"
        case .family:   return "최대 5인 가족 공유 알람"
        }
    }

    /// 플랜별 기능 불릿. 안드로이드 `ui/billing/BillingPanels.kt` 의
    /// `billing_plan_*_feature_*` 문자열과 **글자까지 같아야 한다.**
    ///
    /// ⚠ 2026-08-08 전까지 여기 문구가 전부 달랐다("목소리"/"음성 메시지"/"최대 2명" …).
    /// 주석은 "1:1" 이라고 적혀 있었지만 실제로는 아니었다 — 같은 상품을 두 스토어에서
    /// **다르게 설명**하고 있었고, 커플 카드의 '개인 이용권 기능 전부 포함' 은 아예 빠져
    /// 있어 왜 더 비싼지 알 수 없었다.
    private static func features(for tier: PlanTier) -> [String] {
        switch tier {
        case .free:
            return ["일반 알람 무제한", "기본 목소리 알람"]
        case .personal:
            return ["원하는 목소리 1개 등록", "날씨·운세 등 매일 다른 문구"]
        case .couple:
            return ["개인 이용권 기능 전부 포함", "서로의 목소리 공유", "상대 알람 맞춰주기", "2명이 함께 사용"]
        case .family:
            return ["개인 이용권 기능 전부 포함", "가족 목소리 공유", "가족에게 알람 보내기", "최대 5명이 함께 사용"]
        }
    }
}

/// 플랜 카드 안의 기능 한 줄(점 + 텍스트). Android `PlanFeatureRow`
/// (BillingPanels.kt:663-680): 6dp primary 점 + bodyMedium onSurfaceVariant 텍스트.
struct PlanFeatureRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(theme.palette.primary)
                .frame(width: 6, height: 6)
            Text(text)
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
        }
    }
}

/// 제품 정보를 불러오는 동안 보여주는 스켈레톤 (3개 유료 플랜 분량).
/// 첫 로딩의 일시적 빈 상태가 "망가진 화면"처럼 보이지 않게 한다.
struct BillingPlansSkeleton: View {
    var body: some View {
        VStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        skeletonBar(width: 80, height: 16)
                        Spacer()
                    }
                    skeletonBar(width: 180, height: 12)
                    RoundedRectangle(cornerRadius: 6)
                        .fill(AlarmTalkTheme.outline.opacity(0.18))
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                }
                .padding(12)
                .background(AlarmTalkTheme.surfaceVariant)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityElement()
        .accessibilityLabel("이용권 정보를 불러오는 중이에요")
    }

    private func skeletonBar(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(AlarmTalkTheme.outline.opacity(0.18))
            .frame(width: width, height: height)
    }
}

/// 제품 fetch 가 실패해 목록이 비어버렸을 때 보여주는 에러/재시도 상태.
/// 일시적 네트워크 blip 으로 페이월이 영구히 구매 불가가 되는 것을 막는다.
struct BillingProductsErrorState: View {
    let isRetrying: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(AlarmTalkTheme.error)
                Text("이용권 정보를 불러오지 못했어요")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.text)
            }
            Text("네트워크 상태를 확인한 뒤 다시 시도해 주세요.")
                .font(.footnote)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: onRetry) {
                HStack(spacing: 6) {
                    if isRetrying {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Label("다시 시도", systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .foregroundStyle(.white)
            .disabled(isRetrying)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AlarmTalkTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

/// 자동 갱신 안내 + 이용약관(EULA)/개인정보 처리방침 링크.
/// Apple App Store Review Guideline 3.1.2 (구독 메타데이터 노출) 충족용.
struct SubscriptionTermsFootnote: View {
    @Environment(\.openURL) private var openURL

    // 약관/개인정보 외부 링크는 RootView 와 동일 출처를 사용한다.
    private static let termsURL = URL(string: "https://alarm-talk.com/ko/terms")!
    private static let privacyURL = URL(string: "https://alarm-talk.com/ko/privacy")!
    // Apple 표준 EULA (앱별 EULA 미지정 시 Apple 이 적용하는 약관).
    private static let eulaURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("구독은 자동으로 갱신돼요. 현재 기간 종료 24시간 전까지 해지하지 않으면 동일 금액으로 갱신되며, 요금은 결제 시점에 Apple ID 계정으로 청구돼요. 구매 후 App Store 계정 설정에서 언제든지 갱신을 끄거나 해지할 수 있어요.")
                .font(.caption2)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 12) {
                Button("이용약관") { openURL(Self.termsURL) }
                Text("·")
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                Button("개인정보 처리방침") { openURL(Self.privacyURL) }
                Text("·")
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                Button("EULA") { openURL(Self.eulaURL) }
            }
            .font(.caption2.weight(.semibold))
            .tint(AlarmTalkTheme.primary)
        }
        .padding(.top, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
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
#endif
