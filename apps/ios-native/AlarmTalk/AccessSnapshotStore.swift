import Foundation

struct AccessSnapshot: Codable, Equatable {
    var subscriptionResponse: BillingSubscriptionResponse?
    var familyGroup: FamilyGroupCurrentResponse?
    /// 스토어(StoreKit)가 확인해 준 등급. nil = 무료가 아니라 **확인 못 함**.
    /// 예약 시점 게이트가 StoreKit 을 직접 못 볼 때도 「스토어가 권위다」를 지키게 한다.
    var storePlanKey: String?

    static let empty = AccessSnapshot(subscriptionResponse: nil, familyGroup: nil, storePlanKey: nil)
}

struct AccessSnapshotStore {
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
        var snapshot = read(userID: userID)
        snapshot.subscriptionResponse = response
        save(userID: userID, snapshot: snapshot)
    }

    /// 스토어가 확인해 준 등급을 캐시에 적는다 — 예약 시점 게이트가 StoreKit 을 직접 못 볼 때
    /// 「스토어가 권위다」를 지키는 근거가 된다.
    func updateStorePlanKey(userID: String, planKey: String?) {
        var snapshot = read(userID: userID)
        snapshot.storePlanKey = planKey
        save(userID: userID, snapshot: snapshot)
    }

    func updateFamilyGroup(userID: String, response: FamilyGroupCurrentResponse?) {
        var snapshot = read(userID: userID)
        snapshot.familyGroup = response
        save(userID: userID, snapshot: snapshot)
    }

    func clear(userID: String) {
        defaults.removeObject(forKey: key(for: userID))
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
