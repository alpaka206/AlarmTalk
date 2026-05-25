import Foundation

struct AccessSnapshot: Codable, Equatable {
    var subscriptionResponse: BillingSubscriptionResponse?
    var familyGroup: FamilyGroupCurrentResponse?

    static let empty = AccessSnapshot(subscriptionResponse: nil, familyGroup: nil)
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
