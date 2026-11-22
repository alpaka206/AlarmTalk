import SwiftUI

/// 스토어에서 가격을 못 받았을 때 쓰는 **폴백 가격**.
///
/// ⚠ **스토어 가격이 언제나 이긴다.** 이건 "값이 아예 없어서 빈칸으로 보이는" 것을 막는
/// 안전망일 뿐이다(2026-08-11 결정). `Product.displayPrice` 가 있으면 그걸 쓴다 —
/// 지역 통화·세금·프로모션이 반영된 값이라 그쪽이 정확하다.
///
/// ⚠ **숫자의 출처는 백엔드 `plans.price_krw` 다**(`packages/backend/src/lib/migrations.ts`
/// 의 personal 3900). 거기를 바꾸면 여기도, 안드로이드의
/// `FallbackPlanPriceKrw` 도 함께 바꾼다 — 서버는 **현재 플랜 하나**만 내려주기 때문에
/// 목록 화면에서는 이 표가 필요하다.
///
/// ⚠ 한국 밖 사용자에게는 이 값이 틀릴 수 있다. 그래서 폴백이고, 실제 결제 금액은
/// App Store 결제 시트가 다시 보여준다.
enum FallbackPlanPrice {
    private static let krw: [PlanTier: Int] = [.personal: 3900]

    /// "3,900원" 꼴. 무료 등급이나 모르는 등급이면 nil.
    static func label(for tier: PlanTier, bundle: Bundle = .main) -> String? {
        krw[tier].map { String(localized: "\($0.formatted())원", bundle: bundle) }
    }
}

extension SubscriptionManager {
    /// 등급의 가격 문자열 — 스토어 값이 있으면 그걸, 없으면 폴백표. 플랜 카드와 결제 확인
    /// 알럿이 **같은 값**을 보여 주도록 둘 다 이걸 부른다.
    func priceLabel(for tier: PlanTier) -> String? {
        SubscriptionProduct.make(tier: tier).flatMap(product(for:))?.displayPrice
            ?? FallbackPlanPrice.label(for: tier)
    }

    /// 체험이 있을 때 결제 버튼 아래(와 결제 확인 알럿)에 두는 한 문장 — "12월 9일부터 매월 ₩3,900씩 결제돼요. …"(2026-11-09
    /// 오너 — 고르기 시안 '무료 기간 크게 + 첫 결제일'. 같은 날 "오늘은 결제되지 않아요." 는 뺐다). 첫 결제일은 **오늘 + 체험 기간**이다.
    /// 안드로이드 짝은 `trialDisclosureText`(`ui/billing/BillingPanels.kt`).
    func trialDisclosure(for tier: PlanTier, now: Date = Date()) -> String? {
        guard let period = freeTrialPeriod(for: tier), let price = priceLabel(for: tier) else { return nil }
        let component: Calendar.Component
        switch period.unit {
        case .day: component = .day
        case .week: component = .weekOfYear
        case .month: component = .month
        case .year: component = .year
        @unknown default: return nil
        }
        guard let firstCharge = Calendar.current.date(byAdding: component, value: period.value, to: now) else { return nil }
        let date = firstCharge.formatted(.dateTime.month(.wide).day())
        // ⚠ **App Store 는 체험 종료 24시간 전까지 해지해야 청구되지 않는다**(2026-11-09 iOS 출시 검토 — 같은 화면 각주
        // `SubscriptionTermsFootnote` 의 갱신 규칙과 맞춘다). "그 전에 언제든" 이라고 쓰면 마지막 하루에 해지한 사람이 청구된다.
        // 안드로이드(Google Play)는 체험 종료 전이면 언제든이라 문장이 다르다.
        return String(localized: "\(String(date))부터 매월 \(String(price))씩 결제돼요. 체험이 끝나기 24시간 전까지 App Store에서 해지하면 결제되지 않아요.")
    }
}
import StoreKit

// BillingPanel 에서 분리한 하위 카드·버튼 컴포넌트. 값은 안드로이드 `ui/billing/BillingPanels.kt` 와 같다.

/// 이용권 카드 상태 줄의 날짜 — "2026.12.09"(안드로이드 `PassDateFormatter` 의 `yyyy.MM.dd`).
func formatPassDate(_ value: String?) -> String? {
    parsePassDate(value).map { BillingDisplayDateFormatter.string(from: $0) }
}

/// 해지 알럿의 날짜 — "12월 9일"(기기 로케일의 '월 일'). 체험 첫 결제일·기간 한정 개인 플랜의 날짜와 같은 꼴이다
/// (`PersonalPromo.dayLabel`, 안드로이드 해지 알럿도 같은 꼴로 맞춘다 — 2026-11-22 두 앱 통일).
func formatPassDay(_ value: String?) -> String? {
    parsePassDate(value).map { PersonalPromo.dayLabel($0) }
}

private func parsePassDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    return BillingISODateFormatter.date(from: value)
        ?? BillingShortISODateFormatter.date(from: value)
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

/// 이용권 카드의 기능 문구 — 플러스 큰 카드의 체크 목록과 무료 한 줄 카드가 쓴다(A안, 2026-11-15).
/// 이름은 옛 카드(`PlanCard`)의 것을 그대로 둔다 — 문구 테스트(`PlanCardCopyTests`)가 이 이름으로 읽는다.
enum PlanCard {
    /// 플랜별 기능 불릿. 안드로이드 `ui/billing/BillingPanels.kt` 의
    /// `billing_plan_*_feature_*` 문자열과 **글자까지 같아야 한다.**
    ///
    /// ⚠ 2026-08-08 전까지 여기 문구가 전부 달랐다 — 주석은 "1:1" 이라고 적혀 있었지만
    /// 같은 상품을 두 스토어에서 **다르게 설명**하고 있었다.
    ///
    /// ⚠ **무료에도 있는 것을 유료 혜택처럼 적지 말 것.** 개인 카드는 2026-09-30 까지
    /// "날씨·운세 등 매일 다른 문구" 라고 적었는데, 날씨·운세·응원·약 문구는 기본 목소리로
    /// 무료다(`docs/spec/voice-and-message.md` §2 — 목록은 등급으로 자르지 않는다). 클립은
    /// 준비된 것을 돌려 쓰므로 '매일 새 문구' 도 사실이 아니다. 개인 이용권이 파는 것은
    /// 그 문구를 **등록한 목소리로** 듣는 것이다.
    ///
    /// 돌려주는 것은 `Localizable.xcstrings` 의 키(한국어 원문)다 — 테스트가 줄마다 영어·일본어
    /// 번역이 있는지 볼 수 있도록 `LocalizedStringKey` 가 아니라 `String` 이고 `private` 이 아니다.
    /// 고정 목록이라 뷰의 메인 액터에 묶지 않는다(`nonisolated`) — 테스트가 어느 격리에서든 읽는다.
    nonisolated static func features(for tier: PlanTier) -> [String] {
        switch tier {
        case .free:
            // 직접 입력 횟수(무료 3 · 플러스 30)는 shared `MANUAL_TTS_MONTHLY_LIMIT` 의 값이다(voice-and-message.md §8).
            // 카드는 등급 비교라 서버 현황이 아니라 정해진 기본분을 적는다 — 값이 바뀌면 같이 고친다.
            return [
                String(localized: "일반 알람 무제한"),
                String(localized: "기본 목소리 알람"),
                String(localized: "기본 목소리로 직접 입력 월 3회"),
            ]
        case .personal:
            return [
                String(localized: "원하는 목소리 1개 등록"),
                String(localized: "등록한 목소리로 듣는 날씨·운세 문구"),
                String(localized: "직접 입력 월 30회(등록한 목소리 포함)"),
                // 플러스는 광고를 보지 않는다(보상형 광고는 무료 계정에게만 — `docs/spec/ad-rewards.md` §1). 2026-11-15 오너: 나중에
                // 무료 화면 중간중간에도 광고를 넣을 예정이라 플러스 혜택으로 적는다. 안드로이드 `billing_plan_personal_feature_no_ads`.
                String(localized: "광고 없이 쓰기"),
            ]
        }
    }
}

/// 플러스 큰 카드(A안, 2026-11-15 오너 — 캔버스 proposal-10). 안드로이드 `PlusPlanHeroCard` 와 같다.
/// 배지는 지금 쓰는 중이면 '현재 이용권', 체험을 줄 수 있으면 'n개월 무료'. 가격 줄은 체험이 있으면
/// "1개월 무료, 이후 월 ₩3,900", 없으면 "월 ₩3,900". 상태 한 줄(프로모)은 가격 아래다. 시작 버튼은 카드가 아니라
/// 화면 아래 고정 영역(`BillingPanel.bottomBar`)에 있다.
struct PlusPlanHeroCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var subscriptions: SubscriptionManager
    let isCurrent: Bool
    /// 시작 버튼을 그리는가(`PlanScreenCurrent.showsPurchase`) — 체험 표기도 이때만 한다.
    let showsPurchase: Bool
    let statusText: String?

    private var priceLabel: String? {
        subscriptions.priceLabel(for: .personal).map { String(localized: "월 \(String($0))") }
    }

    private var trialLabel: String? {
        guard showsPurchase, let period = subscriptions.freeTrialPeriod(for: .personal) else { return nil }
        return SubscriptionManager.trialPeriodLabel(period)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 10) {
                // 이름 17 SemiBold — 안드로이드 `PlusPlanHeroCard` 의 `titleMedium.copy(fontSize = 17.sp)`(토큰에 17 이 없다).
                Text(PlanTier.personal.displayLabel)
                    .font(.pretendard(.semibold, size: 17, relativeTo: .body))
                    .foregroundStyle(theme.palette.onSurface)
                Spacer()
                if let badge = isCurrent ? String(localized: "현재 이용권") : trialLabel.map({ String(localized: "\(String($0)) 무료") }) {
                    Text(badge)
                        .font(theme.typography.labelMedium)
                        .fontWeight(.bold)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(Capsule().fill(theme.palette.primary))
                        .foregroundStyle(theme.palette.onPrimary)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(String(localized: "billing.plan.personal.headline", defaultValue: "원하는 목소리로\n깨워 줘요"))
                    .font(theme.typography.headlineSmall)
                    .fontWeight(.bold)
                    .foregroundStyle(theme.palette.onSurface)
                    .fixedSize(horizontal: false, vertical: true)
                if let priceLabel {
                    // 가격 줄 15 SemiBold — 안드로이드 `bodyMedium.copy(fontSize = 15.sp)`.
                    Text(trialLabel.map { String(localized: "\(String($0)) 무료, 이후 \(String(priceLabel))") } ?? priceLabel)
                        .font(.pretendard(.semibold, size: 15, relativeTo: .subheadline))
                        .foregroundStyle(theme.palette.primary)
                }
                if isCurrent, let statusText {
                    // 상태 줄(만료·해지 예정·프로모) 14 SemiBold — 안드로이드 `bodyMedium` + SemiBold.
                    Text(statusText)
                        .font(theme.typography.bodyMedium)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Rectangle()
                .fill(theme.palette.primary.opacity(0.24))
                .frame(height: 1)
            VStack(alignment: .leading, spacing: 10) {
                // 목록은 카탈로그 키(한국어 원문)라 그리는 자리에서 `LocalizedStringKey` 로 감싼다.
                ForEach(PlanCard.features(for: .personal), id: \.self) { feature in
                    PlanCheckRow(text: LocalizedStringKey(feature))
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.large, style: .continuous)
                .fill(theme.palette.primaryContainer.opacity(0.44))
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.large, style: .continuous)
                .stroke(theme.palette.primary.opacity(0.48), lineWidth: 1)
        )
        // UI 테스트가 '현재 이용권' 배지·상태 문구가 **어느 카드에** 있는지 가리는 자리다(`PersonalPromoNoticeUITests`).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("planCard.personal")
    }
}

/// 무료 한 줄 카드(A안) — 이름·가격 한 줄(지금 쓰는 중이면 '현재 이용권' 배지), 아래에 혜택을 " · " 로 이은 한 줄.
/// 안드로이드 `FreePlanSummaryCard` 와 같다.
struct FreePlanSummaryCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let isCurrent: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 8) {
                // 이름 15 SemiBold · 가격 14 SemiBold — 안드로이드 `FreePlanSummaryCard` 와 같다.
                Text(PlanTier.free.displayLabel)
                    .font(.pretendard(.semibold, size: 15, relativeTo: .subheadline))
                    .foregroundStyle(theme.palette.onSurface)
                Text(String(localized: "0원"))
                    .font(theme.typography.bodyMedium)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.primary)
                Spacer()
                if isCurrent {
                    Text(String(localized: "현재 이용권"))
                        .font(theme.typography.labelMedium)
                        .fontWeight(.bold)
                        .padding(.vertical, 5)
                        .padding(.horizontal, 10)
                        .background(Capsule().fill(theme.palette.primary))
                        .foregroundStyle(theme.palette.onPrimary)
                }
            }
            // 혜택 한 줄 13 — 안드로이드 `bodySmall.copy(fontSize = 13.sp)`.
            Text(verbatim: PlanCard.features(for: .free).joined(separator: " · "))
                .font(.pretendard(.regular, size: 13, relativeTo: .footnote))
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                .fill(theme.palette.surface)
        )
        .overlay(
            // 카드 테두리 — 안드로이드 `FreePlanSummaryCard` 의 `wakerCardBorder()`(다크에서 한 단계 밝다).
            RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                .stroke(theme.palette.cardBorder, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("planCard.free")
    }
}

/// 화면 아래 고정 영역의 시작 버튼(A안) — 안드로이드 `SubscriptionPanel` 의 시작 버튼과 같다: 채움 primary·잠김
/// surfaceVariant/onSurfaceVariant(`wakerButtonColors`), 반경 18, 높이 52 이상, 글자 titleSmall SemiBold. 진행 표시는 없다.
///
/// ⚠ **누를 수 없는 '결제하기' 를 두지 않는다**(2026-11-22 두 앱 통일). 예전에는 상품을 받는 동안 자리표시, 못 받으면 꺼진
/// '결제하기' 를 그렸다 — 이유를 말하지 않는 죽은 버튼이었다. 이제 상품이 없어도 버튼은 늘 눌리고, 누르면 그때 상품을 다시
/// 받는다. 그래도 못 받으면 "이용권 정보를 불러오지 못했어요" 알럿이다(`BillingPanel.beginPurchase`).
struct PlanPurchaseButton: View {
    @EnvironmentObject private var subscriptions: SubscriptionManager
    let tier: PlanTier
    let isBusy: Bool
    let onPurchase: () -> Void

    private var trialLabel: String? {
        subscriptions.freeTrialPeriod(for: tier).map { SubscriptionManager.trialPeriodLabel($0) }
    }

    var body: some View {
        Button(action: onPurchase) {
            // ⚠ **버튼에 가격을 넣지 말 것**(2026-08-11 요청) — 가격은 카드가 말하고, 버튼은 무엇을 하는지만 말한다.
            Text(trialLabel.map { String(localized: "\(String($0)) 무료로 시작하기") } ?? String(localized: "결제하기"))
        }
        .buttonStyle(PlanStartButtonStyle())
        .disabled(isBusy)
    }
}

/// 이용권 시작 버튼의 모양 — 안드로이드 M3 `Button` + `wakerButtonColors()` + `WakerButtonShape` 와 같은 값이다.
private struct PlanStartButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PlanStartButtonBody(label: configuration.label, isPressed: configuration.isPressed)
    }
}

private struct PlanStartButtonBody: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    let label: ButtonStyleConfiguration.Label
    let isPressed: Bool

    var body: some View {
        label
            .font(theme.typography.titleSmall)
            .fontWeight(.semibold)
            .multilineTextAlignment(.center)
            .foregroundStyle(isEnabled ? theme.palette.onPrimary : theme.palette.onSurfaceVariant)
            // 안쪽 여백은 M3 버튼 기본값(좌우 24 · 위아래 8)이다 — 큰 글꼴에서 줄이 늘면 높이가 그만큼 자란다.
            .padding(.horizontal, 24)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                isEnabled ? theme.palette.primary : theme.palette.surfaceVariant,
                in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
            )
            .opacity(isPressed ? 0.8 : 1)
            .contentShape(Rectangle())
    }
}

/// 플러스 혜택 한 줄 — 강조색 체크 + 글자(A안). 안드로이드 `PlanCheckRow` 와 같다: 아이콘 칸 18 · 사이 10 · 글자 15.
struct PlanCheckRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let text: LocalizedStringKey

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(theme.palette.primary)
                .frame(width: 18, height: 18)
                .accessibilityHidden(true)
            Text(text)
                .font(.pretendard(.regular, size: 15, relativeTo: .subheadline))
                .foregroundStyle(theme.palette.onSurface)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// ⚠ **상품을 기다리는 스켈레톤·가져오기 실패 카드(`BillingPlansSkeleton`·`BillingProductsErrorState`)를 되살리지 말 것**
// (2026-11-22 두 앱 통일). 카드는 언제나 그리고 가격은 폴백(`FallbackPlanPrice` — "월 3,900원")으로 둔다. 못 받은 상품은
// 시작 버튼을 누를 때 다시 받는다 — 안드로이드 `SubscriptionPanel` 도 카드를 언제나 그린다.

/// 자동 갱신 안내 + 이용약관(EULA)/개인정보 처리방침 링크.
/// Apple App Store Review Guideline 3.1.2 (구독 메타데이터 노출) 충족용.
struct SubscriptionTermsFootnote: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.voiceAlarmTheme) private var theme

    // 약관/개인정보 외부 링크는 RootView 와 동일 출처를 사용한다.
    private static var termsURL: URL { LegalLinks.terms }
    private static var privacyURL: URL { LegalLinks.privacy }
    // Apple 표준 EULA (앱별 EULA 미지정 시 Apple 이 적용하는 약관).
    private static let eulaURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(String(localized: "구독은 자동으로 갱신돼요. 현재 기간 종료 24시간 전까지 해지하지 않으면 동일 금액으로 갱신되며, 요금은 결제 시점에 Apple ID 계정으로 청구돼요. 구매 후 App Store 계정 설정에서 언제든지 갱신을 끄거나 해지할 수 있어요."))
                .font(.pretendard(.regular, size: 11, relativeTo: .caption2))
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 12) {
                Button(String(localized: "이용약관")) { openURL(Self.termsURL) }
                Text("·")
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Button(String(localized: "개인정보 처리방침")) { openURL(Self.privacyURL) }
                Text("·")
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Button("EULA") { openURL(Self.eulaURL) }
            }
            .font(.pretendard(.semibold, size: 11, relativeTo: .caption2))
            .tint(theme.palette.primary)
        }
        .padding(.top, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// ⚠ **개인 이용권 선물 안내 시트(`PersonalGiftPassSheet`)를 되살리지 말 것**(2026-10-14, App Store
// 지침 3.1.1 두 번째 반려 — 선물하기 폐지). 할인·무료 이용은 스토어 오퍼 코드로 준다.

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
