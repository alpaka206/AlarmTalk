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
    static func bestKnown(
        serverSubscription: BillingSubscriptionResponse?,
        storeTier: PlanTier = .free,
        userPlan: String? = nil
    ) -> PlanTier {
        var candidates = [storeTier]
        if serverSubscription == nil {
            candidates.append(PlanTier.from(userPlan))
        }
        if serverSubscription?.subscription?.status == "active" {
            candidates.append(PlanTier.from(serverSubscription?.plan?.key))
            candidates.append(PlanTier.from(serverSubscription?.plan?.planType))
        }
        return candidates.max { lhs, rhs in
            (tierOrder[lhs] ?? 0) < (tierOrder[rhs] ?? 0)
        } ?? .free
    }
}
