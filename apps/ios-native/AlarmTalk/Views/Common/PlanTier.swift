import Foundation

/// 요금제 등급. **화면·게이트 판정의 공용 축**이다.
///
/// ⚠ **`PlanGateState` 를 되살리지 말 것**(2026-08-11 제거). 다이얼로그 상태를 담으려던
/// 구조체였는데 **리포 전체에서 참조가 0건**이었고, 정작 같은 파일에 **다이얼로그 View 는
/// 없었다** — 이름만 있고 실물이 없어, 게이트를 만들 때마다 자리마다 알럿을 손으로 짜게
/// 만든 원인이다. 유료 게이트 문구는 `PaidGateCopy` 가 유일 출처다.
import SwiftUI

/// PlanGate 상태값. View modifier 들이 sheet item 으로 사용.
enum PlanTier: String, CaseIterable, Codable, Equatable {
    case free
    case personal
    case couple
    case family

    /// 화면에 노출하는 한국어 라벨.
    var displayLabel: String {
        switch self {
        case .free: return "무료"
        case .personal: return "개인"
        case .couple: return "커플"
        case .family: return "가족"
        }
    }

    /// 백엔드 plan key (소문자).
    var apiKey: String { rawValue }

    /// 이 플랜을 **함께 쓸 수 있는 인원**. 백엔드 `plans.max_members` 와 같은 값이고,
    /// 안드로이드 `BillingPanels.kt` 의 `planSeats` 와 짝이다.
    /// 정원이 줄어드는 전환인지 판단하는 데 쓴다.
    var sharedSeats: Int {
        switch self {
        case .family: return 5
        case .couple: return 2
        case .personal, .free: return 1
        }
    }

    /// 현재 플랜이 `required` 이상의 권한을 가지는지. 가족 > 커플 > 개인 > 무료.
    func meetsOrExceeds(_ required: PlanTier) -> Bool {
        Self.tierOrder[self] ?? 0 >= Self.tierOrder[required] ?? 0
    }

    private static let tierOrder: [PlanTier: Int] = [
        .free: 0,
        .personal: 1,
        .couple: 2,
        .family: 3,
    ]

    /// `AuthUser.plan` 또는 `BillingPlan.key` 등에서 받은 문자열을 안전하게 매핑.
    /// 알 수 없는 값은 `.free` 로 폴백.
    static func from(_ raw: String?) -> PlanTier {
        guard let raw = raw?.lowercased() else { return .free }
        if let direct = PlanTier(rawValue: raw) { return direct }
        // 과거 코드의 키들을 흡수.
        switch raw {
        case "plus", "plus_monthly", "plus_yearly":
            return .personal
        case "couple_monthly", "couple_yearly":
            return .couple
        case "family_monthly", "family_yearly":
            return .family
        default:
            return .free
        }
    }

    /// iOS 는 StoreKit entitlement, 백엔드 구독 응답, 세션의 마지막 plan 값이
    /// 짧은 시간 서로 다를 수 있다. 화면 게이트는 가장 높은 "최근 확인 상태"를
    /// 사용해 구매 직후 UI가 순간적으로 무료처럼 보이는 일을 줄인다.
    ///
    /// 우선순위는 판정기(`PaidVoiceGate.resolve`, 안드로이드 `resolvePaidVoiceAccess`)와 같은
    /// 순서다 — `docs/spec/billing-lifecycle.md` 「유료 판정 — 우선순위 다섯 단」:
    ///  1. 스토어 등급은 언제나 후보다(서버 값으로 뒤집지 않는다).
    ///  2. 서버가 `users.plan = free` 라고 하면 **거기서 끝**이다(보류로 남은 행을 믿지 않는다).
    ///  3. 활성 구독 행이 있으면 그 플랜으로 가른다.
    ///  4. 활성 구독이 **없으면** `users.plan` 의 유료값을 믿는다.
    ///
    /// ⚠ **4단을 빼지 말 것**(2026-09-27). 예전에는 구독 응답이 **도착하기 전에만**
    /// `users.plan` 을 봤다. 그래서 서버가 "본인 구독 없음(`subscription: null`)" 으로 답하는
    /// 순간 `users.plan` 의 유료값이 통째로 버려졌다 — 판정기는 유료라고 하는데 편집기·등록
    /// 제출·이용권 화면은 무료로 그렸다. 구독 행 없이 `users.plan` 으로 유료를 주는 계정
    /// (기간 한정 개인 플랜 등)이 전부 그 틈에 빠진다.
    ///
    /// - Parameter userPlan: 서버가 준 `users.plan`. 세션 사용자가 있으면
    ///   `bestKnown(serverSubscription:storeTier:user:)` 를 쓴다 — 기간 한정 개인 플랜이
    ///   붙은 계정은 이 값만으로 보류 규칙을 지킬 수 없다(계산값 `plus` 라서).
    static func bestKnown(
        serverSubscription: BillingSubscriptionResponse?,
        storeTier: PlanTier = .free,
        userPlan: String? = nil
    ) -> PlanTier {
        var candidates = [storeTier]
        // ⚠ **서버가 `users.plan = free` 라고 하면 남아 있는 구독 행으로 등급을 올리지
        // 않는다**(2026-09-01 리뷰). 결제 보류는 회복을 위해 구독 행과 그룹을 **그대로 둔
        // 채** plan 만 회수하므로(백엔드 `propagateGroupMemberPlans`), 행만 보면 결제가
        // 밀린 사용자에게 계속 유료 UI 를 보여 주고 **서버가 거부할 액션을 유도한다.**
        // 스토어(`storeTier`)는 후보에 그대로 있어 「스토어가 권위다」는 지켜진다 —
        // 보류가 풀렸는데 서버 반영이 늦어도 잠기지 않는다.
        // 판정기(`PaidVoiceGate.resolve`)의 2단과 같은 규칙이다.
        let suspended = userPlan?.trimmingCharacters(in: .whitespaces).lowercased() == "free"
        if !suspended {
            if serverSubscription?.subscription?.status == "active" {
                candidates.append(PlanTier.from(serverSubscription?.plan?.key))
                candidates.append(PlanTier.from(serverSubscription?.plan?.planType))
            } else {
                // 응답 전(nil)이든 "구독 없음" 이든 — 활성 구독이 없으면 `users.plan` 이 답이다.
                candidates.append(PlanTier.from(userPlan))
            }
        }
        return candidates.max { lhs, rhs in
            (tierOrder[lhs] ?? 0) < (tierOrder[rhs] ?? 0)
        } ?? .free
    }

    /// 세션 사용자로 등급을 본다. 편집기·목소리 공유처럼 **쓸 수 있는가** 를 묻는 자리가 쓴다.
    ///
    /// 기간 한정 개인 플랜(`personalPromo`)이 붙은 계정은 두 규칙을 더 지킨다:
    ///  - **기간 중에는 보류 규칙을 그대로 둔다**(2026-09-27 리뷰). 프로모가 있다 = 원시
    ///    plan 이 free 다. 결제 보류(ON_HOLD·PAUSED) 그룹의 소유자·멤버는 그룹·구독 행이
    ///    남아 있어, 계산값 `plus` 로 `suspended` 를 풀어 버리면 **남은 행이 등급을 커플·
    ///    가족으로 올린다** — 서버는 그 기능을 원시값으로 막는다(`docs/spec/billing-lifecycle.md`
    ///    「무엇이 계산값을 보고, 무엇이 원시값을 보나」). 그래서 행은 보지 않고 스토어와
    ///    계산값(개인)만 후보다.
    ///  - **끝난 뒤의 낡은 캐시**(`PersonalPromo.isStale`)는 계산값 `plus` 를 버리고, **활성
    ///    구독 행이 이긴다** — 판정기(`PaidVoiceGate.resolve`)와 같은 순서다. 프로모 뒤에
    ///    결제한 사람을 프로모 날짜로 잠그지 않는다.
    ///
    /// ⚠ 이용권 화면(**무엇을 샀는가**)은 이걸 쓰지 않는다 — `purchasedPlan` 을 넘긴다
    /// (`BillingPanel.currentTier`). 프로모는 산 이용권이 아니다.
    static func bestKnown(
        serverSubscription: BillingSubscriptionResponse?,
        storeTier: PlanTier = .free,
        user: AuthUser?,
        now: Date = Date()
    ) -> PlanTier {
        guard let promo = user?.personalPromo else {
            return bestKnown(serverSubscription: serverSubscription, storeTier: storeTier, userPlan: user?.plan)
        }
        if promo.isStale(at: now) {
            // 계산값은 끝났다 — plan 을 모르는 것으로 두면 활성 행이 있으면 행이, 없으면 무료다.
            return bestKnown(serverSubscription: serverSubscription, storeTier: storeTier, userPlan: nil)
        }
        // 기간 중 — 원시 free 라 남은 행으로 올리지 않는다(보류 규칙). 계산값만 후보다.
        let computed = PlanTier.from(user?.plan)
        return (tierOrder[computed] ?? 0) > (tierOrder[storeTier] ?? 0) ? computed : storeTier
    }

    /// 기간 한정 개인 플랜의 **보류 규칙**이 지금 걸려 있는가(스펙 D2·D9) — 세션 사용자에게
    /// 프로모가 있고 낡지 않았다(`PersonalPromo.isStale`).
    ///
    /// 걸려 있으면 커플·가족 기능(상대 알람·목소리 공유)은 **등급**(`bestKnown(user:)` — 스토어와
    /// 계산값)으로만 열린다. 가족 그룹·그 멤버 수 같은 **다른 근거로 열지 않는다** — 결제 보류는
    /// 그룹을 남긴 채 plan 만 회수하므로, 그룹으로 열면 서버가 원시값으로 거절할 액션을 앱이
    /// 연다. 안드로이드 `personalPromoTierHoldOf` 가 null 이 아닌 경우와 같은 답이다.
    /// 프로모가 없거나 끝난 뒤의 낡은 캐시면 false — 예전 규칙(그룹도 연다) 그대로다.
    static func personalPromoHoldActive(user: AuthUser?, now: Date = Date()) -> Bool {
        guard let promo = user?.personalPromo else { return false }
        return !promo.isStale(at: now)
    }
}

/// 이용권 화면의 **'현재 이용권' 카드**와 기간 한정 개인 플랜 문구의 자리.
///
/// 규칙은 `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」 D4 「이용권 화면의 프로모 문구」 이고,
/// 안드로이드 `PlanScreenCurrent`(`ui/billing/BillingPanels.kt` 의 `planScreenCurrentOf`)와 **같은 입력에
/// 같은 답**을 낸다.
///
/// 프로모가 이 계정의 **유일한 이용권**일 때만 개인 카드가 현재가 된다 — 산 이용권이 없고(`free`),
/// 공유 멤버가 아니고, 보류 행도 없다. 그 밖(산 이용권·공유 멤버·보류 행·프로모 없음/끝남)은 예전
/// 그대로다 — 현재 카드는 산 이용권, 프로모는 카드 위 한 줄.
///
/// ⚠ **여기 답으로 결제·전환을 가르지 말 것.** 버튼 라벨('결제하기'/'이용권 변경')·확인 알럿의 전환·
/// 환산 문구·결제 차단(`BillingPanel.purchaseBlockReason`)은 산 이용권(`BillingPanel.currentTier`)으로만
/// 가른다 — 프로모는 산 이용권이 아니다.
struct PlanScreenCurrent: Equatable {
    /// '현재 이용권' 뱃지·강조를 다는 카드.
    let currentTier: PlanTier
    /// 프로모가 이 계정의 **유일한** 이용권이라 개인 카드가 현재가 됐다 — 그 카드의 상태 문구가
    /// 프로모 한 줄이고, 결제 버튼은 남는다(산 이용권이 아니다).
    let promoOnPersonalCard: Bool
    /// 프로모 한 줄을 카드 목록 **위에** 그린다 — 프로모가 있는데 개인 카드에 앉지 않는 계정(산 이용권·
    /// 공유 멤버·보류 행). 예전 그대로다. `promoOnPersonalCard` 와 동시에 참이 되지 않는다.
    let promoLineAboveList: Bool

    func isCurrent(_ tier: PlanTier) -> Bool { tier == currentTier }

    /// 결제 버튼 — 무료 카드엔 없고, **산** 현재 이용권 카드에도 없다(다시 살 것이 없다).
    /// 프로모로 현재가 된 개인 카드에는 **있다** — '현재' 와 '결제 버튼 숨김' 은 다른 질문이다.
    func showsPurchase(_ tier: PlanTier) -> Bool {
        tier != .free && (!isCurrent(tier) || promoOnPersonalCard)
    }

    /// - Parameters:
    ///   - purchasedTier: 산 이용권 — 예전에 현재 카드를 고르던 값 그대로(`BillingPanel.currentTier`).
    ///   - isSharedMember: 가족·커플 그룹의 멤버(`familyGroup.role == "member"`, 그룹 있음).
    ///   - promoActive: 이용권 화면에 보일 프로모가 **지금** 살아 있다(끝나지 않았고 마지막 날을 읽을 수 있다).
    ///   - hasHeldSubscriptionRow: 그 프로모의 `deletesVoicesAtEnd == false` — 원시 free 인데 `active`
    ///     구독 행이 남은 계정(결제 보류 등). 보류 행은 구독 응답에 실리지 않아 이 값이 아니면 프로모
    ///     계정과 구별되지 않는다. 키를 모르는 서버는 `true`(보류 아님)로 읽힌다(`PersonalPromo.init(from:)`).
    static func resolve(
        purchasedTier: PlanTier,
        isSharedMember: Bool,
        promoActive: Bool,
        hasHeldSubscriptionRow: Bool
    ) -> PlanScreenCurrent {
        let promoIsOnlyPlan = promoActive
            && purchasedTier == .free
            && !isSharedMember
            && !hasHeldSubscriptionRow
        return PlanScreenCurrent(
            currentTier: promoIsOnlyPlan ? .personal : purchasedTier,
            promoOnPersonalCard: promoIsOnlyPlan,
            promoLineAboveList: promoActive && !promoIsOnlyPlan
        )
    }
}
