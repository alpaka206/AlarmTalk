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
    enum Cause: String, Comparable, CaseIterable {
        static func < (lhs: Cause, rhs: Cause) -> Bool { lhs.rank < rhs.rank }

        /// 우선순위 순(앞이 셈). 안드로이드의 `Cause.values()` 선언 순서와 같아야 한다.
        static var ordered: [Cause] { allCases.sorted() }
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

    /// ⚠ **읽기·합치기·쓰기가 한 덩어리다 — 메인 액터에서만 부른다**(Codex #703 P2).
    /// 안드로이드는 같은 자리에 프로세스 전역 잠금을 뒀다(`data/DowngradeNoticeStore.kt`) —
    /// 거기서는 전경 정리와 `VoiceAccessSyncWorker` 가 **다른 스레드로** 함께 적기 때문이다.
    /// iOS 는 세 호출부(권위 새로고침·교체 푸시·무료 잠금)가 전부 `@MainActor` 라 액터가
    /// 그 직렬화를 대신한다. `@MainActor` 를 붙여 **컴파일러가 지키게** 한다.
    @MainActor
    func record(userID: String?, cause: Cause, count: Int) {
        guard let userID, !userID.isEmpty, count > 0 else { return }
        migrateLegacy(userID)
        // ⚠ **원인별로 따로 담는다**(Codex #703 P2). 예전에는 적는 순간 하나로 뭉갰는데
        // (`min(previous.cause, cause)`), 그러면 `.voiceReplaced` 가 대기 중일 때
        // `.freePlan` 하나가 들어오는 것만으로 저장된 원인이 `.freePlan` 이 되어,
        // 유료 복원의 `clear(ifCause: .freePlan)` 이 **복원되지 않는 교체 안내까지** 지웠다.
        let previous = defaults.integer(forKey: countKey(userID, cause))
        defaults.set(previous + count, forKey: countKey(userID, cause))
    }

    /// 지금 띄울 안내.
    ///
    /// 고르는 규칙은 그대로다 — **가장 할 수 있는 일이 많은 원인**(선언 순서가 앞선 것)으로
    /// 말하고, 개수는 대기 중인 것을 **전부 더한다** — 한 번 띄울 때 다 말한다.
    ///
    /// ⚠ 그래서 '확인' 을 누르면 한 번에 다 지워진다. 다만 **유료 복원처럼 원인 하나만
    /// 지우는 경우**에는 남은 원인이 다음에 다시 뜬다 — 그건 의도다(교체 안내는 이용권으로
    /// 복원되지 않으므로 사용자가 반드시 봐야 한다).
    func read(userID: String?) -> Notice? {
        guard let userID, !userID.isEmpty else { return nil }
        migrateLegacy(userID)
        var total = 0
        var top: Cause?
        for cause in Cause.ordered {
            let count = defaults.integer(forKey: countKey(userID, cause))
            guard count > 0 else { continue }
            total += count
            if top == nil { top = cause }
        }
        guard let cause = top else { return nil }
        return Notice(cause: cause, count: total)
    }

    /// 사용자가 '확인' 을 눌렀을 때만 부른다 — 말해 준 것을 전부 비운다.
    func clear(userID: String?) {
        guard let userID, !userID.isEmpty else { return }
        for cause in Cause.ordered { defaults.removeObject(forKey: countKey(userID, cause)) }
        defaults.removeObject(forKey: legacyCauseKey(userID))
        defaults.removeObject(forKey: legacyCountKey(userID))
    }

    /// **그 원인의 안내만** 지운다.
    ///
    /// ⚠ 유료 복원은 `.freePlan` 안내만 지워야 한다(Codex #703 P2). 무조건 비우면, 다른
    /// 기기가 적어 둔 `.voiceReplaced`(복원되지 않는 안내)를 유료 사용자의 콜드 스타트가
    /// 화면에 띄우기도 전에 지운다 — `docs/spec/voice-and-message.md` 는 그 안내를 **다음에
    /// 앱을 열 때까지 남기라고** 규정한다.
    func clear(userID: String?, ifCause cause: Cause) {
        guard let userID, !userID.isEmpty else { return }
        migrateLegacy(userID)
        defaults.removeObject(forKey: countKey(userID, cause))
    }

    /// 원인을 하나로 뭉개 두던 시절의 값을 원인별 칸으로 옮긴다.
    ///
    /// 업그레이드 순간 대기 중이던 안내를 잃지 않기 위한 것이고, 한 번 옮기면 옛 키는 없앤다.
    private func migrateLegacy(_ userID: String) {
        guard let raw = defaults.string(forKey: legacyCauseKey(userID)) else { return }
        let count = defaults.integer(forKey: legacyCountKey(userID))
        defaults.removeObject(forKey: legacyCauseKey(userID))
        defaults.removeObject(forKey: legacyCountKey(userID))
        guard let cause = Cause(rawValue: raw), count > 0 else { return }
        let previous = defaults.integer(forKey: countKey(userID, cause))
        defaults.set(previous + count, forKey: countKey(userID, cause))
    }

    private func countKey(_ userID: String, _ cause: Cause) -> String {
        "downgrade_notice_count_\(cause.rawValue)_\(userID)"
    }

    private func legacyCauseKey(_ userID: String) -> String { "downgrade_notice_cause_\(userID)" }
    private func legacyCountKey(_ userID: String) -> String { "downgrade_notice_count_\(userID)" }
}
