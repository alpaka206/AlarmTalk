import Foundation

// MARK: - LocalAlarmRecord
// Android `AlarmEntity.kt:7-45` 의 33필드와 1:1 매칭.
// 필드명만 Swift camelCase. epoch ms 는 `Int64` 로 직렬화.
struct LocalAlarmRecord: Identifiable, Codable, Equatable, Hashable {
    var id: String                  // UUID().uuidString
    var label: String
    var hour: Int                   // 0..23
    var minute: Int                 // 0..59
    var fireAtMillis: Int64
    var repeatDaysMask: Int         // 0..0x7f (bit 0=Sun..bit 6=Sat)
    var holidayOff: Bool
    var snoozeEnabled: Bool
    var snoozeMinutes: Int          // 1..30
    var snoozeRepeatLimit: Int      // 0/1/3/5 (0 == 무제한)
    var snoozeCount: Int
    var vibrationPattern: String    // VibrationPattern.rawValue
    var playMode: String            // AlarmPlayMode.rawValue (alarm_only / voice_only / sound_then_voice)
    var defaultAlarmSoundId: String
    var localAudioUri: String?      // file:// path
    var audioCacheKey: String?      // SHA-256 hex
    var rawAudioUri: String?
    var voiceSource: String         // VoiceSource.rawValue
    var voiceProfileId: String?
    var voiceText: String?
    var voiceCategory: String?
    var voiceLanguage: String?      // ISO 639-1
    var voiceRandomPrompt: Bool
    var voiceRepeat: Bool
    var ttsMessageId: String?
    var remoteAlarmId: String?
    var lastSyncedAtMillis: Int64?
    var syncState: String           // AlarmSyncState.rawValue
    var origin: String              // AlarmOrigin.rawValue
    var alarmVolumePercent: Int     // 0..100
    var alarmSoundUri: String?
    var alarmSoundLabel: String?
    var enabled: Bool
    var state: String               // AlarmRuntimeState.rawValue
    var createdAtMillis: Int64
    var updatedAtMillis: Int64

    // iOS-only:
    /// AlarmKit `Alarm.id` (UUID). 직렬화는 String 으로.
    var alarmKitID: String?

    // MARK: Convenience accessors (Phase 2-B2/B3 가 사용)

    var playModeEnum: AlarmPlayMode { AlarmPlayMode.decode(playMode) }
    var syncStateEnum: AlarmSyncState { AlarmSyncState(rawValue: syncState) ?? .localOnly }
    var originEnum: AlarmOrigin { AlarmOrigin(rawValue: origin) ?? .localOwned }
    var runtimeStateEnum: AlarmRuntimeState { AlarmRuntimeState.decode(state) }
    var voiceSourceEnum: VoiceSource { VoiceSource(rawValue: voiceSource) ?? .ttsProfile }
    var vibrationPatternEnum: VibrationPattern { VibrationPattern(rawValue: vibrationPattern) ?? .default }

    var hasVoiceAudio: Bool {
        ttsMessageId != nil || rawAudioUri != nil || localAudioUri != nil
    }

    var timeString: String {
        String(format: "%02d:%02d", hour, minute)
    }

    /// 호환 헬퍼: 기존 `repeatWeekdays` (1..7 Calendar weekday) 형식.
    /// Android mask 의 bit 0=Sun..bit 6=Sat 을 Calendar 1=Sun..7=Sat 으로 변환.
    var repeatWeekdays: [Int] {
        repeatDaysMask.repeatDays.map(\.localeWeekdayInt)
    }

    /// AlarmKit UUID 호환 헬퍼.
    var alarmKitUUID: UUID? {
        guard let alarmKitID else { return nil }
        return UUID(uuidString: alarmKitID)
    }

    /// 다음 발화 시각 (fireAtMillis 기반).
    var nextFireDate: Date { Date(timeIntervalSince1970: TimeInterval(fireAtMillis) / 1000.0) }

    // MARK: Defaults / Designated init

    /// 풀 33필드 designated init. 누락된 필드는 default 사용.
    init(
        id: String = UUID().uuidString,
        label: String,
        hour: Int,
        minute: Int,
        fireAtMillis: Int64,
        repeatDaysMask: Int = 0,
        holidayOff: Bool = false,
        snoozeEnabled: Bool = true,
        snoozeMinutes: Int = 5,
        snoozeRepeatLimit: Int = SnoozeRepeatLimit.three.rawValue,
        snoozeCount: Int = 0,
        vibrationPattern: String = VibrationPattern.default.rawValue,
        playMode: String = AlarmPlayMode.alarmOnly.rawValue,
        defaultAlarmSoundId: String = DefaultAlarmSounds.bundledDefault,
        localAudioUri: String? = nil,
        audioCacheKey: String? = nil,
        rawAudioUri: String? = nil,
        voiceSource: String = VoiceSource.ttsProfile.rawValue,
        voiceProfileId: String? = nil,
        voiceText: String? = nil,
        voiceCategory: String? = nil,
        voiceLanguage: String? = nil,
        voiceRandomPrompt: Bool = false,
        voiceRepeat: Bool = true,
        ttsMessageId: String? = nil,
        remoteAlarmId: String? = nil,
        lastSyncedAtMillis: Int64? = nil,
        syncState: String = AlarmSyncState.localOnly.rawValue,
        origin: String = AlarmOrigin.localOwned.rawValue,
        alarmVolumePercent: Int = 80,
        alarmSoundUri: String? = nil,
        alarmSoundLabel: String? = nil,
        enabled: Bool = true,
        state: String = AlarmRuntimeState.idle.rawValue,
        createdAtMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        updatedAtMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        alarmKitID: String? = nil
    ) {
        self.id = id
        self.label = label
        self.hour = hour
        self.minute = minute
        self.fireAtMillis = fireAtMillis
        self.repeatDaysMask = repeatDaysMask
        self.holidayOff = holidayOff
        self.snoozeEnabled = snoozeEnabled
        self.snoozeMinutes = snoozeMinutes
        self.snoozeRepeatLimit = snoozeRepeatLimit
        self.snoozeCount = snoozeCount
        self.vibrationPattern = vibrationPattern
        self.playMode = playMode
        self.defaultAlarmSoundId = defaultAlarmSoundId
        self.localAudioUri = localAudioUri
        self.audioCacheKey = audioCacheKey
        self.rawAudioUri = rawAudioUri
        self.voiceSource = voiceSource
        self.voiceProfileId = voiceProfileId
        self.voiceText = voiceText
        self.voiceCategory = voiceCategory
        self.voiceLanguage = voiceLanguage
        self.voiceRandomPrompt = voiceRandomPrompt
        self.voiceRepeat = voiceRepeat
        self.ttsMessageId = ttsMessageId
        self.remoteAlarmId = remoteAlarmId
        self.lastSyncedAtMillis = lastSyncedAtMillis
        self.syncState = syncState
        self.origin = origin
        self.alarmVolumePercent = alarmVolumePercent
        self.alarmSoundUri = alarmSoundUri
        self.alarmSoundLabel = alarmSoundLabel
        self.enabled = enabled
        self.state = state
        self.createdAtMillis = createdAtMillis
        self.updatedAtMillis = updatedAtMillis
        self.alarmKitID = alarmKitID
    }

    enum CodingKeys: String, CodingKey {
        case id
        case label
        case hour
        case minute
        case fireAtMillis
        case repeatDaysMask
        case holidayOff
        case snoozeEnabled
        case snoozeMinutes
        case snoozeRepeatLimit
        case snoozeCount
        case vibrationPattern
        case playMode
        case defaultAlarmSoundId
        case localAudioUri
        case audioCacheKey
        case rawAudioUri
        case voiceSource
        case voiceProfileId
        case voiceText
        case voiceCategory
        case voiceLanguage
        case voiceRandomPrompt
        case voiceRepeat
        case ttsMessageId
        case remoteAlarmId
        case lastSyncedAtMillis
        case syncState
        case origin
        case alarmVolumePercent
        case alarmSoundUri
        case alarmSoundLabel
        case enabled
        case state
        case createdAtMillis
        case updatedAtMillis
        case alarmKitID

        // Legacy 17필드 호환 키 (iOS 초기 빌드 JSON)
        case legacyRemoteID = "remoteID"
        case legacyRepeatWeekdays = "repeatWeekdays"
        case legacyVoiceProfileID = "voiceProfileID"
        case legacyMessageID = "messageID"
        case legacyRawAudioURL = "rawAudioURL"
        case legacyLocalAudioFilePath = "localAudioFilePath"
        case legacyUpdatedAt = "updatedAt"
        case legacyAlarmKitID = "alarmKitID"  // 동일 키 — UUID 형식이면 String 으로 재해석
    }

    /// Codable 디코딩. 신규 필드 누락 시 default + legacy 17필드 JSON 호환.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // id 는 String 직렬화가 기본. 단 legacy 가 UUID 객체로 인코딩됐을 수 있어 폴백.
        if let raw = try? c.decode(String.self, forKey: .id) {
            self.id = raw
        } else if let uuid = try? c.decode(UUID.self, forKey: .id) {
            self.id = uuid.uuidString
        } else {
            self.id = UUID().uuidString
        }

        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? "알람"
        self.hour = try c.decodeIfPresent(Int.self, forKey: .hour) ?? 7
        self.minute = try c.decodeIfPresent(Int.self, forKey: .minute) ?? 0

        // repeatDaysMask: 신규 우선, 없으면 legacy `repeatWeekdays` (1..7 Calendar) 에서 변환
        if let mask = try c.decodeIfPresent(Int.self, forKey: .repeatDaysMask) {
            self.repeatDaysMask = mask
        } else if let legacy = try c.decodeIfPresent([Int].self, forKey: .legacyRepeatWeekdays) {
            // legacy [Int] 가 1..7 Calendar weekday 였음 (1=Sun..7=Sat).
            self.repeatDaysMask = legacy.reduce(0) { acc, weekday in
                guard let day = RepeatDay.fromCalendarWeekday(weekday) else { return acc }
                return acc | day.mask
            }
        } else {
            self.repeatDaysMask = 0
        }

        self.holidayOff = try c.decodeIfPresent(Bool.self, forKey: .holidayOff) ?? false
        self.snoozeEnabled = try c.decodeIfPresent(Bool.self, forKey: .snoozeEnabled) ?? true
        self.snoozeMinutes = try c.decodeIfPresent(Int.self, forKey: .snoozeMinutes) ?? 5
        self.snoozeRepeatLimit = try c.decodeIfPresent(Int.self, forKey: .snoozeRepeatLimit)
            ?? SnoozeRepeatLimit.three.rawValue
        self.snoozeCount = try c.decodeIfPresent(Int.self, forKey: .snoozeCount) ?? 0
        self.vibrationPattern = try c.decodeIfPresent(String.self, forKey: .vibrationPattern)
            ?? VibrationPattern.default.rawValue

        // playMode: 신규는 sound_then_voice, legacy 는 alarm_voice 일 수 있어 AlarmPlayMode.decode 거침.
        if let rawPlayMode = try c.decodeIfPresent(String.self, forKey: .playMode) {
            self.playMode = AlarmPlayMode.decode(rawPlayMode).rawValue
        } else {
            self.playMode = AlarmPlayMode.alarmOnly.rawValue
        }

        self.defaultAlarmSoundId = try c.decodeIfPresent(String.self, forKey: .defaultAlarmSoundId)
            ?? DefaultAlarmSounds.bundledDefault

        // localAudioUri 신규 우선, 없으면 legacy localAudioFilePath 사용 (파일명만 보관됐던 시절).
        self.localAudioUri = try c.decodeIfPresent(String.self, forKey: .localAudioUri)
            ?? c.decodeIfPresent(String.self, forKey: .legacyLocalAudioFilePath)

        self.audioCacheKey = try c.decodeIfPresent(String.self, forKey: .audioCacheKey)
        self.rawAudioUri = try c.decodeIfPresent(String.self, forKey: .rawAudioUri)
            ?? c.decodeIfPresent(String.self, forKey: .legacyRawAudioURL)

        self.voiceSource = try c.decodeIfPresent(String.self, forKey: .voiceSource)
            ?? VoiceSource.ttsProfile.rawValue
        self.voiceProfileId = try c.decodeIfPresent(String.self, forKey: .voiceProfileId)
            ?? c.decodeIfPresent(String.self, forKey: .legacyVoiceProfileID)
        self.voiceText = try c.decodeIfPresent(String.self, forKey: .voiceText)
        self.voiceCategory = try c.decodeIfPresent(String.self, forKey: .voiceCategory)
        self.voiceLanguage = try c.decodeIfPresent(String.self, forKey: .voiceLanguage)
        self.voiceRandomPrompt = try c.decodeIfPresent(Bool.self, forKey: .voiceRandomPrompt) ?? false
        self.voiceRepeat = try c.decodeIfPresent(Bool.self, forKey: .voiceRepeat) ?? true
        self.ttsMessageId = try c.decodeIfPresent(String.self, forKey: .ttsMessageId)
            ?? c.decodeIfPresent(String.self, forKey: .legacyMessageID)

        self.remoteAlarmId = try c.decodeIfPresent(String.self, forKey: .remoteAlarmId)
            ?? c.decodeIfPresent(String.self, forKey: .legacyRemoteID)
        self.lastSyncedAtMillis = try c.decodeIfPresent(Int64.self, forKey: .lastSyncedAtMillis)

        // syncState 보정: remoteAlarmId 가 있으면 synced, 없으면 local_only.
        if let raw = try c.decodeIfPresent(String.self, forKey: .syncState),
           let _ = AlarmSyncState(rawValue: raw) {
            self.syncState = raw
        } else {
            self.syncState = (self.remoteAlarmId != nil)
                ? AlarmSyncState.synced.rawValue
                : AlarmSyncState.localOnly.rawValue
        }

        self.origin = try c.decodeIfPresent(String.self, forKey: .origin) ?? AlarmOrigin.localOwned.rawValue
        self.alarmVolumePercent = try c.decodeIfPresent(Int.self, forKey: .alarmVolumePercent) ?? 80
        self.alarmSoundUri = try c.decodeIfPresent(String.self, forKey: .alarmSoundUri)
        self.alarmSoundLabel = try c.decodeIfPresent(String.self, forKey: .alarmSoundLabel)
        self.enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        self.state = try c.decodeIfPresent(String.self, forKey: .state) ?? AlarmRuntimeState.idle.rawValue

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        self.createdAtMillis = try c.decodeIfPresent(Int64.self, forKey: .createdAtMillis) ?? now

        if let updated = try c.decodeIfPresent(Int64.self, forKey: .updatedAtMillis) {
            self.updatedAtMillis = updated
        } else if let legacyUpdated = try c.decodeIfPresent(Date.self, forKey: .legacyUpdatedAt) {
            self.updatedAtMillis = Int64(legacyUpdated.timeIntervalSince1970 * 1000)
        } else {
            self.updatedAtMillis = now
        }

        // alarmKitID: 신규는 String 직렬화. legacy 는 UUID 객체로 인코딩됐을 수 있어 두 경로 시도.
        if let stringID = try? c.decode(String.self, forKey: .alarmKitID) {
            self.alarmKitID = stringID
        } else if let uuid = try? c.decode(UUID.self, forKey: .alarmKitID) {
            self.alarmKitID = uuid.uuidString
        } else {
            self.alarmKitID = nil
        }

        // fireAtMillis: 신규는 Int64. legacy JSON 에는 없을 수 있어 hour/minute 으로 today/tomorrow 기본값.
        if let raw = try c.decodeIfPresent(Int64.self, forKey: .fireAtMillis) {
            self.fireAtMillis = raw
        } else {
            self.fireAtMillis = LocalAlarmRecord.fallbackFireAtMillis(
                hour: hour,
                minute: minute,
                referenceMillis: now
            )
        }
    }

    /// hour/minute 만 알 때 다음 발화 시각 계산 (legacy import 폴백용).
    static func fallbackFireAtMillis(hour: Int, minute: Int, referenceMillis: Int64) -> Int64 {
        let reference = Date(timeIntervalSince1970: TimeInterval(referenceMillis) / 1000.0)
        var cal = Calendar.current
        cal.timeZone = .current
        var comps = cal.dateComponents([.year, .month, .day], from: reference)
        comps.hour = hour
        comps.minute = minute
        comps.second = 0
        let candidate = cal.date(from: comps) ?? reference
        let resolved = candidate > reference
            ? candidate
            : (cal.date(byAdding: .day, value: 1, to: candidate) ?? candidate)
        return Int64(resolved.timeIntervalSince1970 * 1000)
    }
}

// MARK: - Validation
// Android `AlarmRepository.kt:471-484` `validateDraft` 의 검증 규칙을 Swift error 로 이식.
enum LocalAlarmValidationError: LocalizedError, Equatable {
    case emptyLabel
    case invalidHour
    case invalidMinute
    case invalidRepeatDaysMask
    case invalidSnoozeMinutes
    case invalidSnoozeRepeatLimit
    case invalidAlarmVolume
    case unknownVibrationPattern
    case unknownPlayMode
    case unknownVoiceSource
    case voiceAudioRequired
    case duplicateTime

    var errorDescription: String? {
        switch self {
        case .emptyLabel: return "알람 이름을 입력해 주세요."
        case .invalidHour: return "시는 0~23 사이여야 해요."
        case .invalidMinute: return "분은 0~59 사이여야 해요."
        case .invalidRepeatDaysMask: return "반복 요일 비트가 유효하지 않아요."
        case .invalidSnoozeMinutes: return "다시 알림은 1~30분이어야 해요."
        case .invalidSnoozeRepeatLimit: return "다시 알림 반복 횟수가 유효하지 않아요."
        case .invalidAlarmVolume: return "알람 볼륨은 0~100 사이여야 해요."
        case .unknownVibrationPattern: return "지원하지 않는 진동 패턴이에요."
        case .unknownPlayMode: return "지원하지 않는 재생 방식이에요."
        case .unknownVoiceSource: return "지원하지 않는 음성 소스예요."
        case .voiceAudioRequired: return "음성 알람은 음원을 먼저 캐싱해야 해요."
        case .duplicateTime: return "이미 같은 시간에 알람이 있어요. 다른 시간을 선택해 주세요."
        }
    }
}

// MARK: - Persistence Actor
// 디스크 I/O 를 별도 actor 로 격리. `LocalAlarmStore` 가 wrapper.
actor LocalAlarmPersistence {
    private let storageURL: URL

    init(storageURL: URL) {
        self.storageURL = storageURL
    }

    func load() -> [LocalAlarmRecord] {
        guard let data = try? Data(contentsOf: storageURL) else { return [] }
        let decoder = JSONDecoder()
        return (try? decoder.decode([LocalAlarmRecord].self, from: data)) ?? []
    }

    func save(_ alarms: [LocalAlarmRecord]) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(alarms) else { return }
        try? data.write(to: storageURL, options: [.atomic])
    }
}

// MARK: - Store
@MainActor
final class LocalAlarmStore: ObservableObject {
    @Published private(set) var alarms: [LocalAlarmRecord] = []

    private let persistence: LocalAlarmPersistence

    init() {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let storageURL = directory.appendingPathComponent("voice-alarm-ios-alarms.json")
        self.persistence = LocalAlarmPersistence(storageURL: storageURL)
        Task { [persistence] in
            let loaded = await persistence.load()
            await MainActor.run { self.alarms = loaded }
        }
    }

    // MARK: Queries

    func record(id: String) -> LocalAlarmRecord? {
        alarms.first { $0.id == id }
    }

    func record(alarmKitID: String) -> LocalAlarmRecord? {
        alarms.first { $0.alarmKitID == alarmKitID }
    }

    func recordsBy(syncState: AlarmSyncState) -> [LocalAlarmRecord] {
        alarms.filter { $0.syncStateEnum == syncState }
    }

    func recordsBy(origin: AlarmOrigin) -> [LocalAlarmRecord] {
        alarms.filter { $0.originEnum == origin }
    }

    func countByAudioCacheKey(_ key: String) -> Int {
        alarms.reduce(0) { acc, record in
            (record.audioCacheKey == key) ? acc + 1 : acc
        }
    }

    /// `AlarmRepository.requireUniqueTime` 와 동일 의미. mask 동일 + 동일 시각이면 중복.
    /// 단순화: hour+minute 만 일치해도 중복으로 본다 (Android 원본 의도와 동일).
    func requireUniqueTime(
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        excludingID: String? = nil
    ) throws {
        let collision = alarms.contains { record in
            record.id != excludingID &&
                record.hour == hour &&
                record.minute == minute
        }
        if collision { throw LocalAlarmValidationError.duplicateTime }
    }

    // MARK: Validation

    /// Android `AlarmRepository.validateDraft` 동일.
    static func validateDraft(_ record: LocalAlarmRecord) throws {
        if record.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw LocalAlarmValidationError.emptyLabel
        }
        guard (0...23).contains(record.hour) else { throw LocalAlarmValidationError.invalidHour }
        guard (0...59).contains(record.minute) else { throw LocalAlarmValidationError.invalidMinute }
        guard (0...0x7f).contains(record.repeatDaysMask) else {
            throw LocalAlarmValidationError.invalidRepeatDaysMask
        }
        guard (1...30).contains(record.snoozeMinutes) else {
            throw LocalAlarmValidationError.invalidSnoozeMinutes
        }
        guard SnoozeRepeatLimit.isValid(record.snoozeRepeatLimit) else {
            throw LocalAlarmValidationError.invalidSnoozeRepeatLimit
        }
        guard (0...100).contains(record.alarmVolumePercent) else {
            throw LocalAlarmValidationError.invalidAlarmVolume
        }
        guard VibrationPattern(rawValue: record.vibrationPattern) != nil else {
            throw LocalAlarmValidationError.unknownVibrationPattern
        }
        guard AlarmPlayMode(rawValue: record.playMode) != nil else {
            throw LocalAlarmValidationError.unknownPlayMode
        }
        guard VoiceSource(rawValue: record.voiceSource) != nil else {
            throw LocalAlarmValidationError.unknownVoiceSource
        }
        if record.playModeEnum != .alarmOnly {
            if record.localAudioUri?.isEmpty ?? true {
                throw LocalAlarmValidationError.voiceAudioRequired
            }
        }
    }

    // MARK: Mutations

    /// 동일 ID 가 있으면 갱신, 없으면 추가. updatedAtMillis 자동 갱신.
    @discardableResult
    func upsert(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        var copy = record
        copy.updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        if let index = alarms.firstIndex(where: { $0.id == copy.id }) {
            alarms[index] = copy
        } else {
            alarms.append(copy)
        }
        persist()
        return copy
    }

    func delete(_ alarm: LocalAlarmRecord) {
        alarms.removeAll { $0.id == alarm.id }
        persist()
    }

    func deleteByID(_ id: String) {
        alarms.removeAll { $0.id == id }
        persist()
    }

    // MARK: State transitions
    // Android `AlarmRepository` 의 markRinging / dismiss / snooze / setEnabled 흐름 이식.

    func markScheduled(localID: String, alarmKitID: String) {
        guard let index = alarms.firstIndex(where: { $0.id == localID }) else { return }
        alarms[index].alarmKitID = alarmKitID
        alarms[index].enabled = true
        alarms[index].state = AlarmRuntimeState.armed.rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    func markRinging(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].state = AlarmRuntimeState.ringing.rawValue
        alarms[index].enabled = true
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// AlarmKit alarmUpdates 에서 알람이 사라졌을 때 호출.
    func markStopped(alarmKitID: String) {
        guard let index = alarms.firstIndex(where: { $0.alarmKitID == alarmKitID }) else { return }
        alarms[index].state = AlarmRuntimeState.dismissed.rawValue
        alarms[index].enabled = false
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// Snooze 갱신. fireAtMillis 는 호출자가 미리 계산해서 전달 (now + snoozeMinutes*60s).
    func markSnoozed(id: String, newFireAtMillis: Int64, incrementCount: Bool = true) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].fireAtMillis = newFireAtMillis
        alarms[index].state = AlarmRuntimeState.snoozed.rawValue
        alarms[index].enabled = true
        if incrementCount {
            alarms[index].snoozeCount += 1
        }
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    func markFailed(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].state = AlarmRuntimeState.failed.rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    func setEnabled(id: String, enabled: Bool) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].enabled = enabled
        alarms[index].state = enabled ? AlarmRuntimeState.armed.rawValue : AlarmRuntimeState.disabled.rawValue
        alarms[index].syncState = nextLocalSyncState(for: alarms[index]).rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    // MARK: Sync transitions (Phase 2-B3 가 사용)

    /// 서버에 push/pull 이 성공하여 remote id 와 sync 시각을 기록.
    func markRemote(localID: String,
                    remoteID: String,
                    lastSyncedAtMillis: Int64,
                    syncState: AlarmSyncState = .synced) {
        guard let index = alarms.firstIndex(where: { $0.id == localID }) else { return }
        alarms[index].remoteAlarmId = remoteID
        alarms[index].lastSyncedAtMillis = lastSyncedAtMillis
        alarms[index].syncState = syncState.rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// 오프라인 수정 시 dirty 표시.
    func markDirty(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].syncState = nextLocalSyncState(for: alarms[index]).rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// 동기화 실패 시 호출.
    func markSyncFailed(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].syncState = AlarmSyncState.syncFailed.rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// Android `AlarmRepository.nextLocalSyncState` 동일.
    /// - received_remote 는 항상 synced 로 회귀
    /// - remoteAlarmId 없으면 local_only
    /// - 그 외엔 dirty
    func nextLocalSyncState(for record: LocalAlarmRecord) -> AlarmSyncState {
        if record.originEnum == .receivedRemote { return .synced }
        if record.remoteAlarmId == nil { return .localOnly }
        return .dirty
    }

    // MARK: Persistence

    private func persist() {
        let snapshot = alarms
        Task { [persistence] in
            await persistence.save(snapshot)
        }
    }
}
