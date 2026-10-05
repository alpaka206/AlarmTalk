import Foundation

enum AlarmPresentationLanguage {
    static var current: String { Bundle.main.preferredLocalizations.first ?? "ko" }
    private static func ownerKey(_ owner: String) -> String { "alarm.presentation.owner.\(owner)" }
    private static func alarmKey(_ id: String) -> String { "alarm.presentation.record.\(id)" }

    static func rearmTargets(stamp: String?, current: String, alarms: [LocalAlarmRecord]) -> Set<String> {
        Set(alarms.filter { record in
            guard record.enabled, record.alarmKitID != nil else { return false }
            if let stamp { return stamp != current }
            return record.originEnum == .receivedRemote && record.localizedDisplayLabel != record.label
        }.map(\.id))
    }

    static func pending(owner: String, alarms: [LocalAlarmRecord], defaults: UserDefaults = .standard) -> Set<String> {
        rearmTargets(stamp: defaults.string(forKey: ownerKey(owner)), current: current, alarms: alarms)
            .filter { defaults.string(forKey: alarmKey($0)) != current }
    }

    static func didSchedule(_ id: String, defaults: UserDefaults = .standard) {
        defaults.set(current, forKey: alarmKey(id))
    }

    static func finishIfComplete(owner: String, alarms: [LocalAlarmRecord], defaults: UserDefaults = .standard) {
        guard pending(owner: owner, alarms: alarms, defaults: defaults).isEmpty else { return }
        defaults.set(current, forKey: ownerKey(owner))
    }
}
