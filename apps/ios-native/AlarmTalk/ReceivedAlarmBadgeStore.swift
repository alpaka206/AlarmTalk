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
    /// 지금 있는 받은 알람까지 **다 봤다**고 기록한다.
    ///
    /// ⚠ **수위선은 뒤로 가지 않는다**(2026-08-27, 안드로이드 `ReceivedAlarmBadgeStore` 와
    /// 같다). 예전에는 지금 목록의 최댓값을 그대로 썼는데, 사용자가 **가장 최근에 받은
    /// 알람을 지우면** 그 최댓값이 내려가 이미 본 옛 알람들이 다시 '안 본 것' 으로 살아났다 —
    /// 배지가 1 이 아니라 **누적된 값**으로 뜬다. 본 사실은 되돌릴 수 없다.
    func markSeen(userID: String, alarms: [LocalAlarmRecord]) -> Int64 {
        let latest = alarms
            .filter { $0.originEnum == .receivedRemote }
            .map(\.createdAtMillis)
            .max() ?? 0
        let seenAtMillis = max(latest, readSeenAtMillis(userID: userID))
        defaults.set(NSNumber(value: seenAtMillis), forKey: key(userID))
        return seenAtMillis
    }

    private func key(_ userID: String) -> String {
        let normalized = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        return "received_alarm_seen_at_\(normalized.isEmpty ? "unknown" : normalized)"
    }
}
