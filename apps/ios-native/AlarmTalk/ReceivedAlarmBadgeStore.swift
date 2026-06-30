import Foundation

struct ReceivedAlarmBadgeStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func hasBaseline(userID: String) -> Bool {
        defaults.object(forKey: key(userID)) != nil
    }

    func readSeenAtMillis(userID: String) -> Int64 {
        guard let value = defaults.object(forKey: key(userID)) as? NSNumber else {
            return 0
        }
        return value.int64Value
    }

    @discardableResult
    func markSeen(userID: String, alarms: [LocalAlarmRecord]) -> Int64 {
        let seenAtMillis = alarms
            .filter { $0.originEnum == .receivedRemote }
            .map(\.createdAtMillis)
            .max() ?? 0
        defaults.set(NSNumber(value: seenAtMillis), forKey: key(userID))
        return seenAtMillis
    }

    private func key(_ userID: String) -> String {
        let normalized = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        return "received_alarm_seen_at_\(normalized.isEmpty ? "unknown" : normalized)"
    }
}
