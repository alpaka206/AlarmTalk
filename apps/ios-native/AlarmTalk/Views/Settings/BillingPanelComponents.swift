import SwiftUI

/// 스토어에서 가격을 못 받았을 때 쓰는 **폴백 가격**.
///
/// ⚠ **스토어 가격이 언제나 이긴다.** 이건 "값이 아예 없어서 빈칸으로 보이는" 것을 막는
/// 안전망일 뿐이다(2026-08-11 결정). `Product.displayPrice` 가 있으면 그걸 쓴다 —
/// 지역 통화·세금·프로모션이 반영된 값이라 그쪽이 정확하다.
///
/// ⚠ **숫자의 출처는 백엔드 `plans.price_krw` 다**(`packages/backend/src/lib/migrations.ts`
/// 의 personal 3900 / couple 6900 / family 14900). 거기를 바꾸면 여기도, 안드로이드의
/// `FallbackPlanPriceKrw` 도 함께 바꾼다 — 서버는 **현재 플랜 하나**만 내려주기 때문에
/// 목록 화면에서는 이 표가 필요하다.
///
/// ⚠ 한국 밖 사용자에게는 이 값이 틀릴 수 있다. 그래서 폴백이고, 실제 결제 금액은
/// App Store 결제 시트가 다시 보여준다.
enum FallbackPlanPrice {
    private static let krw: [PlanTier: Int] = [.personal: 3900, .couple: 6900, .family: 14900]

    /// "3,900원" 꼴. 무료 등급이나 모르는 등급이면 nil.
    static func label(for tier: PlanTier) -> String? {
        guard let value = krw[tier] else { return nil }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        let number = formatter.string(from: NSNumber(value: value)) ?? String(value)
        return "\(number)원"
    }
}
import StoreKit
import UIKit

// BillingPanel 에서 분리한 하위 카드/시트 컴포넌트. 동작/디자인 변경 없음.

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
    // 숫자 포맷이라 로케일 영향이 거의 없지만, 고정할 이유도 없다(연·월·일 숫자 체계가
    // 다른 로케일에서 아라비아 숫자가 아닌 글자로 나오는 것을 막으려면 en_US_POSIX 가 맞다).
    formatter.locale = Locale(identifier: "en_US_POSIX")
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

    /// 카드에 보여줄 가격. 스토어 값이 있으면 그걸, 없으면 폴백을 쓴다.
    /// 무료는 상품이 아니라 그냥 0원이다.
    private var priceLabel: String? {
        if tier == .free { return "0원" }
        if let productID = SubscriptionProduct.make(tier: tier)?.rawValue,
           let product = subscriptions.products.first(where: { $0.id == productID }) {
            return "월 \(product.displayPrice)"
        }
        return FallbackPlanPrice.label(for: tier).map { "월 \($0)" }
    }

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

            // ⚠ **한 줄 설명(`description(for:)`)을 되살리지 말 것**(2026-08-11 요청).
            // 아래 기능 불릿이 같은 말을 더 구체적으로 하고 있었다 — 안드로이드에도 없다.

            // 가격은 **플랜 이름 바로 아래**다(안드로이드와 같은 자리). 버튼에 넣으면
            // 액션 라벨과 가격이 한 덩어리가 되어 무엇을 누르는지 흐려진다.
            if let priceLabel = priceLabel {
                Text(priceLabel)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.palette.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(alignment: .leading, spacing: 6) {
                // `LocalizedStringKey` 는 Hashable 이 아니라 `id: \.self` 를 못 쓴다.
                // 목록이 고정 순서라 인덱스를 id 로 삼아도 안전하다.
                ForEach(Array(Self.features(for: tier).enumerated()), id: \.offset) { _, feature in
                    PlanFeatureRow(text: feature)
                }
            }

            if tier != .free {
                purchaseButtons
            }

            if tier == .personal {
                Button(action: onGiftPersonal) {
                    Label("선물하기", systemImage: "gift")
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
        if subscriptions.product(for: plan) != nil {
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
                        // ⚠ **버튼에 가격을 넣지 말 것**(2026-08-11 요청). 가격은 카드 위쪽
                        // 제 자리에 있고, 버튼은 **무엇을 하는지**만 말한다 — 안드로이드도
                        // '이용권 변경' 처럼 액션 라벨만 둔다.
                        Text(isCurrent ? "사용 중" : "결제하기")
                            .font(.subheadline.weight(.semibold))
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
            // ⚠ **"준비중" 같은 말을 지어내지 말 것.** 가격은 **스토어가 권위**라 못 받아
            // 올 수 있는데(시뮬레이터·미출시 트랙 등), 그때 "준비중" 이라고 쓰면 우리가
            // 상품 상태를 단정하는 셈이다 — 대개는 상품이 멀쩡하고 조회만 실패한 것이다.
            // 가격은 카드 위쪽이 폴백으로 이미 말하고 있다.
            // 누르면 결제로는 못 가므로 **비활성**이다 — 살 수 없다는 사실은 그대로 전한다.
            Button {
                // no-op — 상품을 못 받았으니 결제로 갈 수 없다.
            } label: {
                Text("결제하기")
                    .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.bordered)
            .disabled(true)
        }
    }


    /// 플랜별 기능 불릿. 안드로이드 `ui/billing/BillingPanels.kt` 의
    /// `billing_plan_*_feature_*` 문자열과 **글자까지 같아야 한다.**
    ///
    /// ⚠ 2026-08-08 전까지 여기 문구가 전부 달랐다("목소리"/"음성 메시지"/"최대 2명" …).
    /// 주석은 "1:1" 이라고 적혀 있었지만 실제로는 아니었다 — 같은 상품을 두 스토어에서
    /// **다르게 설명**하고 있었고, 커플 카드의 '개인 이용권 기능 전부 포함' 은 아예 빠져
    /// 있어 왜 더 비싼지 알 수 없었다.
    private static func features(for tier: PlanTier) -> [LocalizedStringKey] {
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
    let text: LocalizedStringKey

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
                        // 클립보드는 **코드만**, 설치 안내는 공유 본문에만
                        // (안드로이드 `ui/billing/BillingPanels.kt` 의 `shareVoucher` 와 같다).
                        UIPasteboard.general.string = voucher.code
                        shareText = CodeShareText.forCode(voucher.code)
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
