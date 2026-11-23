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

    var displayLabel: String { localizedDisplayLabel() }

    func localizedDisplayLabel(bundle: Bundle = .main) -> String {
        switch self {
        case .free: return String(localized: "plan.name.free", defaultValue: "무료", bundle: bundle)
        case .personal: return String(localized: "plan.name.personal", defaultValue: "플러스", bundle: bundle)
        }
    }

    /// 표시만 바꾼다. 권한 판정(from)은 기존 계약을 유지한다. 모르는 키는 호출부가 폴백한다.
    static func displayName(forPlanKey key: String?, bundle: Bundle = .main) -> String? {
        let tier: PlanTier
        switch key?.lowercased() {
        case "free": tier = .free
        case "personal", "individual", "plus", "plus_monthly", "plus_yearly": tier = .personal
        default: return nil
        }
        return tier.localizedDisplayLabel(bundle: bundle)
    }

    /// 현재 플랜이 `required` 이상의 권한을 가지는지. 개인 > 무료.
    func meetsOrExceeds(_ required: PlanTier) -> Bool {
        Self.tierOrder[self] ?? 0 >= Self.tierOrder[required] ?? 0
    }

    private static let tierOrder: [PlanTier: Int] = [
        .free: 0,
        .personal: 1,
    ]

    /// `AuthUser.plan` 또는 `BillingPlan.key` 등에서 받은 문자열을 안전하게 매핑.
    /// 알 수 없는 값은 `.free` 로 폴백(유료 목록은 shared `PAID_USER_PLANS` 와 같다).
    static func from(_ raw: String?) -> PlanTier {
        switch raw?.lowercased() {
        // 플랜 키는 `personal`, `users.plan` 은 `plus` 다(`plus_*` 는 과거 코드의 키).
        case "personal", "plus", "plus_monthly", "plus_yearly":
            return .personal
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
    /// 제출·이용권 화면은 무료로 그렸다. 구독 행 없이 `users.plan` 으로 유료를 주는 계정이
    /// 전부 그 틈에 빠진다.
    ///
    /// - Parameter userPlan: 서버가 준 `users.plan`(원시 plan).
    static func bestKnown(
        serverSubscription: BillingSubscriptionResponse?,
        storeTier: PlanTier = .free,
        userPlan: String? = nil
    ) -> PlanTier {
        var candidates = [storeTier]
        // ⚠ **서버가 `users.plan = free` 라고 하면 남아 있는 구독 행으로 등급을 올리지
        // 않는다**(2026-09-01 리뷰). 결제 보류는 회복을 위해 구독 행을 **그대로 둔
        // 채** plan 만 회수하므로(백엔드 `resolvePlanAfterSuspend`), 행만 보면 결제가
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

    /// 세션 사용자로 등급을 본다. 편집기·목소리 등록처럼 **쓸 수 있는가** 를 묻는 자리가 쓴다.
    static func bestKnown(
        serverSubscription: BillingSubscriptionResponse?,
        storeTier: PlanTier = .free,
        user: AuthUser?
    ) -> PlanTier {
        bestKnown(serverSubscription: serverSubscription, storeTier: storeTier, userPlan: user?.plan)
    }
}

/// 이용권 화면의 **'현재 이용권' 카드**와 결제 버튼. 현재 카드는 산 이용권이다(`BillingPanel.currentTier`).
struct PlanScreenCurrent: Equatable {
    /// '현재 이용권' 뱃지·강조를 다는 카드.
    let currentTier: PlanTier

    func isCurrent(_ tier: PlanTier) -> Bool { tier == currentTier }

    /// 결제 버튼 — 무료 카드엔 없고, 현재 이용권 카드에도 없다(다시 살 것이 없다).
    func showsPurchase(_ tier: PlanTier) -> Bool {
        tier != .free && !isCurrent(tier)
    }

    /// - Parameter purchasedTier: 산 이용권(`BillingPanel.currentTier`).
    static func resolve(purchasedTier: PlanTier) -> PlanScreenCurrent {
        PlanScreenCurrent(currentTier: purchasedTier)
    }
}
