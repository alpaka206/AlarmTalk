import Foundation

struct LocalAlarmRecord: Identifiable, Codable, Equatable {
    var id: UUID
    var remoteID: String?
    var label: String
    var hour: Int
    var minute: Int
    var repeatWeekdays: [Int]
    var alarmKitID: UUID?
    var enabled: Bool
    var snoozeMinutes: Int
    var playMode: AlarmPlayMode
    var voiceProfileID: String?
    var messageID: String?
    var rawAudioURL: String?
    var localAudioFilePath: String?
    var voiceText: String?
    var voiceLanguage: String?
    var updatedAt: Date

    var hasVoiceAudio: Bool {
        messageID != nil || rawAudioURL != nil || localAudioFilePath != nil
    }

    var timeString: String {
        String(format: "%02d:%02d", hour, minute)
    }

    var nextFireDate: Date {
        var calendar = Calendar.current
        calendar.timeZone = .current
        let now = Date()
        var components = calendar.dateComponents([.year, .month, .day], from: now)
        components.hour = hour
        components.minute = minute
        components.second = 0
        let today = calendar.date(from: components) ?? now
        return today > now ? today : calendar.date(byAdding: .day, value: 1, to: today) ?? today
    }

    init(
        id: UUID,
        remoteID: String? = nil,
        label: String,
        hour: Int,
        minute: Int,
        repeatWeekdays: [Int],
        alarmKitID: UUID?,
        enabled: Bool,
        snoozeMinutes: Int = 5,
        playMode: AlarmPlayMode = .alarmOnly,
        voiceProfileID: String? = nil,
        messageID: String? = nil,
        rawAudioURL: String? = nil,
        localAudioFilePath: String? = nil,
        voiceText: String? = nil,
        voiceLanguage: String? = nil,
        updatedAt: Date
    ) {
        self.id = id
        self.remoteID = remoteID
        self.label = label
        self.hour = hour
        self.minute = minute
        self.repeatWeekdays = repeatWeekdays
        self.alarmKitID = alarmKitID
        self.enabled = enabled
        self.snoozeMinutes = snoozeMinutes
        self.playMode = playMode
        self.voiceProfileID = voiceProfileID
        self.messageID = messageID
        self.rawAudioURL = rawAudioURL
        self.localAudioFilePath = localAudioFilePath
        self.voiceText = voiceText
        self.voiceLanguage = voiceLanguage
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case remoteID
        case label
        case hour
        case minute
        case repeatWeekdays
        case alarmKitID
        case enabled
        case snoozeMinutes
        case playMode
        case voiceProfileID
        case messageID
        case rawAudioURL
        case localAudioFilePath
        case voiceText
        case voiceLanguage
        case updatedAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        remoteID = try values.decodeIfPresent(String.self, forKey: .remoteID)
        label = try values.decode(String.self, forKey: .label)
        hour = try values.decode(Int.self, forKey: .hour)
        minute = try values.decode(Int.self, forKey: .minute)
        repeatWeekdays = try values.decode([Int].self, forKey: .repeatWeekdays)
        alarmKitID = try values.decodeIfPresent(UUID.self, forKey: .alarmKitID)
        enabled = try values.decode(Bool.self, forKey: .enabled)
        snoozeMinutes = try values.decodeIfPresent(Int.self, forKey: .snoozeMinutes) ?? 5
        playMode = try values.decodeIfPresent(AlarmPlayMode.self, forKey: .playMode) ?? .alarmOnly
        voiceProfileID = try values.decodeIfPresent(String.self, forKey: .voiceProfileID)
        messageID = try values.decodeIfPresent(String.self, forKey: .messageID)
        rawAudioURL = try values.decodeIfPresent(String.self, forKey: .rawAudioURL)
        localAudioFilePath = try values.decodeIfPresent(String.self, forKey: .localAudioFilePath)
        voiceText = try values.decodeIfPresent(String.self, forKey: .voiceText)
        voiceLanguage = try values.decodeIfPresent(String.self, forKey: .voiceLanguage)
        updatedAt = try values.decode(Date.self, forKey: .updatedAt)
    }
}

enum AlarmPlayMode: String, Codable, CaseIterable, Identifiable {
    case alarmOnly = "alarm_only"
    case voiceOnly = "voice_only"
    case alarmVoice = "alarm_voice"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .alarmOnly: return "알람만"
        case .voiceOnly: return "음성만"
        case .alarmVoice: return "알람 + 음성"
        }
    }

    var remoteWakeMode: String {
        switch self {
        case .voiceOnly: return "voice_only"
        default: return "sound_then_voice"
        }
    }
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

    func markRemote(localID: UUID, remoteID: String) {
        guard let index = alarms.firstIndex(where: { $0.id == localID }) else { return }
        alarms[index].remoteID = remoteID
        alarms[index].updatedAt = Date()
        save()
    }

    func markStopped(alarmKitID: UUID) {
        guard let index = alarms.firstIndex(where: { $0.alarmKitID == alarmKitID }) else { return }
        alarms[index].enabled = false
        alarms[index].updatedAt = Date()
        save()
    }

    func delete(_ alarm: LocalAlarmRecord) {
        alarms.removeAll { $0.id == alarm.id }
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

