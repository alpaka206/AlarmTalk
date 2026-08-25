import Foundation

/// **"목소리 알람이 기본 알람음으로 바뀌었다" 를 한 번 알리기 위한 대기표.**
///
/// 안드로이드 `data/DowngradeNoticeStore.kt` 와 같은 규칙이다.
///
/// 왜 저장하는가: 강등이 확정되는 자리는 **화면이 없을 수도 있다**(백그라운드 sync).
/// 그 순간 안내를 띄워 봐야 볼 사람이 없으니, 여기 적어 두고 앱이 **보여줄 수 있는
/// 상태가 됐을 때** 모달로 띄운다.
///
/// ⚠ **소진 플래그가 아니라 대기표다.** `PromoPromptStore` 는 "떴다" 를 기록하므로 차단
/// 화면 아래에서 잘못 뜨면 **본 적도 없이 소진**된다(`docs/spec/gates-and-overlays.md`).
/// 여기는 반대로 **'확인' 을 눌러야 지운다** — 못 보고 지나가면 다음에 또 뜬다.
struct DowngradeNoticeStore {
    /// ⚠ **선언 순서가 곧 우선순위다**(앞이 셈). 안드로이드 `DowngradeNoticeStore.Cause` 와
    /// 같은 순서여야 한다 — 섞였을 때 두 앱이 다른 문구를 말하면 안 된다.
    enum Cause: String, Comparable {
        static func < (lhs: Cause, rhs: Cause) -> Bool { lhs.rank < rhs.rank }
        private var rank: Int {
            switch self {
            case .freePlan: return 0
            case .sharedReleased: return 1
            case .voiceReplaced: return 2
            }
        }

        /// 유료 → 무료 강등. 이용권을 다시 등록하면 **복원된다**.
        case freePlan
        /// 공유받던 목소리가 끊겼다. **복원되지 않는다** — 다시 공유받아야 한다.
        case sharedReleased
        /// 내가 **목소리를 새로 등록하며 옛 목소리를 교체**했다. 직접 입력으로 만들어 둔
        /// 알람은 옛 목소리로 합성해 둔 것이라 다시 만들 수 없어 기본 알람음이 된다.
        /// 프리셋 알람은 새 목소리로 다시 만들어지므로 그대로 남는다. **복원되지 않는다.**
        case voiceReplaced
    }

    struct Notice: Equatable {
        let cause: Cause
        let count: Int
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func record(userID: String?, cause: Cause, count: Int) {
        guard let userID, !userID.isEmpty, count > 0 else { return }
        // 확인 전에 또 강등되면 **합쳐서** 한 번만 알린다.
        let previous = read(userID: userID)
        let mergedCount = (previous?.count ?? 0) + count
        // 섞이면 **우선순위가 높은(= 안내할 액션이 있는) 쪽**으로 말한다(안드로이드와 같은 규칙).
        let mergedCause = previous.map { min($0.cause, cause) } ?? cause
        defaults.set(mergedCause.rawValue, forKey: causeKey(userID))
        defaults.set(mergedCount, forKey: countKey(userID))
    }

    func read(userID: String?) -> Notice? {
        guard let userID, !userID.isEmpty else { return nil }
        guard let raw = defaults.string(forKey: causeKey(userID)),
              let cause = Cause(rawValue: raw) else { return nil }
        let count = defaults.integer(forKey: countKey(userID))
        guard count > 0 else { return nil }
        return Notice(cause: cause, count: count)
    }

    /// 사용자가 '확인' 을 눌렀을 때만 부른다.
    func clear(userID: String?) {
        guard let userID, !userID.isEmpty else { return }
        defaults.removeObject(forKey: causeKey(userID))
        defaults.removeObject(forKey: countKey(userID))
    }

    private func causeKey(_ userID: String) -> String { "downgrade_notice_cause_\(userID)" }
    private func countKey(_ userID: String) -> String { "downgrade_notice_count_\(userID)" }
}
