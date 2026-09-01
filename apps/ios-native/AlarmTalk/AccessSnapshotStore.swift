import Foundation

struct AccessSnapshot: Codable, Equatable {
    var subscriptionResponse: BillingSubscriptionResponse?
    var familyGroup: FamilyGroupCurrentResponse?
    /// 스토어(StoreKit)가 확인해 준 등급. nil = 무료가 아니라 **확인 못 함**.
    /// 예약 시점 게이트가 StoreKit 을 직접 못 볼 때도 「스토어가 권위다」를 지키게 한다.
    var storePlanKey: String?
    /// 위 값의 **유효기한**(epoch millis). 지나면 없는 것으로 본다 — 기한이 없으면 한 번
    /// 유료였던 기기가 영구 통행증을 갖는다(안드로이드와 같은 규칙). StoreKit 은 실제
    /// 만료 시각을 주므로 그것을 그대로 쓴다.
    var storeEntitlementUntilMillis: Int64?
    /// 서버가 말한 `users.plan`. **그룹 접근보다 먼저 본다** — 결제 보류(Play ON_HOLD·애플
    /// 재시도)는 **그룹을 남긴 채 이 값만 회수**하므로(`resolvePlanAfterSuspend`), 그룹만
    /// 보면 소유자 결제가 밀린 멤버 전원이 계속 유료로 읽힌다(2026-08-31 리뷰).
    var userPlan: String?

    static let empty = AccessSnapshot(
        subscriptionResponse: nil,
        familyGroup: nil,
        storePlanKey: nil,
        storeEntitlementUntilMillis: nil,
        userPlan: nil
    )
}

struct AccessSnapshotStore {
    /// 읽고-고치고-쓰기를 **직렬화한다**(2026-09-01 리뷰).
    ///
    /// ⚠ 이 스냅샷은 필드마다 다른 곳에서 갱신된다 — 전경 갱신(`refreshAll`)과
    /// StoreKit `Transaction.updates` 배경 처리가 **다른 태스크에서 동시에** 들어온다.
    /// 잠그지 않으면 둘이 같은 옛 값을 읽고 각자 자기 필드만 얹어 저장해, 나중 쓰기가
    /// 상대의 필드를 **지운다**(스토어 갱신이 방금 받은 free `userPlan` 을 날리는 식).
    /// 그 결과를 예약 시점의 `PaidVoiceGate` 가 읽는다.
    ///
    /// 잠금은 **타입에 둔다** — 호출부가 `AccessSnapshotStore()` 를 그때그때 새로 만들어
    /// 인스턴스 잠금은 아무것도 막지 못한다(안드로이드도 companion 에 둔 것과 같은 이유).
    private static let lock = NSLock()

    private let defaults: UserDefaults
    private let keyPrefix = "access_snapshot_"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func read(userID: String) -> AccessSnapshot {
        let key = key(for: userID)
        guard let data = defaults.data(forKey: key),
              let snapshot = try? JSONDecoder().decode(AccessSnapshot.self, from: data) else {
            return .empty
        }
        return snapshot
    }

    func updateSubscription(userID: String, response: BillingSubscriptionResponse?) {
        mutate(userID: userID) { $0.subscriptionResponse = response }
    }

    /// 스토어가 확인해 준 등급을 캐시에 적는다 — 예약 시점 게이트가 StoreKit 을 직접 못 볼 때
    /// 「스토어가 권위다」를 지키는 근거가 된다.
    func updateUserPlan(userID: String, plan: String?) {
        mutate(userID: userID) { $0.userPlan = plan }
    }

    func updateStorePlanKey(userID: String, planKey: String?, untilMillis: Int64?) {
        mutate(userID: userID) {
            $0.storePlanKey = planKey
            $0.storeEntitlementUntilMillis = untilMillis
        }
    }

    func updateFamilyGroup(userID: String, response: FamilyGroupCurrentResponse?) {
        mutate(userID: userID) { $0.familyGroup = response }
    }

    func clear(userID: String) {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        defaults.removeObject(forKey: key(for: userID))
    }

    /// 위 `lock` 주석 참조 — 갱신은 전부 이 문을 지난다.
    private func mutate(userID: String, transform: (inout AccessSnapshot) -> Void) {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        var snapshot = read(userID: userID)
        transform(&snapshot)
        save(userID: userID, snapshot: snapshot)
    }

    private func save(userID: String, snapshot: AccessSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: key(for: userID))
    }

    private func key(for userID: String) -> String {
        let normalized = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(keyPrefix)\(normalized.isEmpty ? "unknown" : normalized)"
    }
}
