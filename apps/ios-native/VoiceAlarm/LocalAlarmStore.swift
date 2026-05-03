import Foundation

struct LocalAlarmRecord: Identifiable, Codable, Equatable {
    var id: UUID
    var label: String
    var hour: Int
    var minute: Int
    var repeatWeekdays: [Int]
    var alarmKitID: UUID?
    var enabled: Bool
    var updatedAt: Date
}

@MainActor
final class LocalAlarmStore: ObservableObject {
    @Published private(set) var alarms: [LocalAlarmRecord] = []

    private let storageURL: URL

    init() {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        storageURL = directory.appendingPathComponent("voice-alarm-ios-alarms.json")
        load()
    }

    func upsert(_ alarm: LocalAlarmRecord) {
        if let index = alarms.firstIndex(where: { $0.id == alarm.id }) {
            alarms[index] = alarm
        } else {
            alarms.append(alarm)
        }
        save()
    }

    func markScheduled(localID: UUID, alarmKitID: UUID) {
        guard let index = alarms.firstIndex(where: { $0.id == localID }) else { return }
        alarms[index].alarmKitID = alarmKitID
        alarms[index].enabled = true
        alarms[index].updatedAt = Date()
        save()
    }

    func markStopped(alarmKitID: UUID) {
        guard let index = alarms.firstIndex(where: { $0.alarmKitID == alarmKitID }) else { return }
        alarms[index].enabled = false
        alarms[index].updatedAt = Date()
        save()
    }

    private func load() {
        guard let data = try? Data(contentsOf: storageURL) else { return }
        alarms = (try? JSONDecoder().decode([LocalAlarmRecord].self, from: data)) ?? []
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(alarms) else { return }
        try? data.write(to: storageURL, options: [.atomic])
    }
}

