import Foundation

// MARK: - LocalAlarmRecord
// Android `AlarmEntity.kt:7-45` 의 알람 필드와 1:1 매칭.
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
    var snoozeRepeatLimit: Int      // 0/3/5 (0 == 무제한)
    var snoozeCount: Int
    var vibrationPattern: String    // VibrationPattern.rawValue
    var playMode: String            // AlarmPlayMode.rawValue (alarm_only / voice_only / sound_then_voice)
    var defaultAlarmSoundId: String
    var localAudioUri: String?      // file:// path
    var audioCacheKey: String?      // SHA-256 hex
    var rawAudioUri: String?
    var voiceSource: String         // VoiceSource.rawValue
    var voiceProfileId: String?
    var voiceListenerTitle: String?
    var voiceText: String?
    var voiceCategory: String?
    var voiceLanguage: String?      // ISO 639-1
    var voiceRandomPrompt: Bool
    var voiceRandomContext: String?
    var voiceWeatherCountry: String?
    var voiceWeatherCity: String?
    var voiceFortuneGender: String?
    var voiceFortuneBirthDate: String?
    var voiceFortuneBirthTime: String?
    var dynamicVoicePreparedForFireAtMillis: Int64?
    var voiceRepeat: Bool
    var voiceVolumePercent: Int     // 0..100
    var ttsMessageId: String?
    // 무료 버킷 회전(Android `AlarmEntity` 미러). voiceBucket=가리키는 버킷 카테고리,
    // voiceRotationIndex=매 발화마다 +1 되는 순차 인덱스, voiceBucketClipKeys=사전 캐시한
    // N개 클립의 audioCacheKey(variant 순). 옵션(a): 재스케줄 시 다음 클립을 localAudioUri 로 지정.
    var voiceBucket: String?
    var voiceRotationIndex: Int
    var voiceBucketClipKeys: [String]?
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

    var usesPaidVoiceFeatures: Bool {
        playModeEnum != .alarmOnly ||
            !(localAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) ||
            !(rawAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) ||
            !(voiceProfileId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) ||
            !(ttsMessageId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    }

    /// 시스템 스톡 보이스 클립 알람인지 — 무료 플랜에서도 보존되어야 한다.
    /// 스톡 클립은 저장 시 스테이징된 `stock_<messageId>` 캐시 파일을 가지므로
    /// `localAudioUri`/`rawAudioUri` 가 NON-blank 다. 따라서 빈 음원 가정에 의존하지 않고
    /// `audioCacheKey` 의 `stock_` prefix(저장 경로 AlarmEditorSheet 1127 / Android
    /// `setStockClipAudio` 와 동일 술어)를 1차 신호로 쓴다. 미래의 비-시스템 server_tts
    /// 알람이 우연히 stock 모양 key 를 가져도 새지 않도록 `isSystemVoiceId(voiceProfileId)`
    /// 를 함께 요구한다. `ttsMessageId` 는 생성 TTS 도 채우므로 단독 신호로 쓰지 않는다.
    var isStockVoiceClip: Bool {
        (audioCacheKey?.hasPrefix("stock_") ?? false) && isSystemVoiceId(voiceProfileId)
    }

    var isGeneratedFreeSystemPresetVoice: Bool {
        guard voiceSource != VoiceSource.localAudio.rawValue,
              isSystemVoiceId(voiceProfileId),
              voiceRandomPrompt else {
            return false
        }
        let language = voiceLanguage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return RandomPromptContext.normalized(voiceRandomContext) == .preset &&
            (language.isEmpty || language == "ko")
    }

    /// 무료 플랜 다운그레이드 시 삭제 대상인지.
    /// Android `AlarmRepository.deletePaidAlarmTalks` 의 `usesVoice && !stockVoiceOnly` 동일.
    /// 시스템 스톡 보이스 TTS 알람(로컬/raw 음원이 없고 voiceProfileId 가 시스템 보이스)은
    /// 무료 플랜에서도 유효하므로 보존한다. 또한 스톡 클립 알람(스테이징된 `stock_` 캐시
    /// 파일이 있어 localAudioUri 가 NON-blank)과 생성된 시스템 프리셋 TTS도 보존한다.
    var isPaidVoiceForDowngrade: Bool {
        let stockVoiceOnly =
            (localAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) &&
            (rawAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) &&
            isSystemVoiceId(voiceProfileId)
        return usesPaidVoiceFeatures &&
            !stockVoiceOnly &&
            !isStockVoiceClip &&
            !isGeneratedFreeSystemPresetVoice
    }

    var canSnooze: Bool {
        snoozeEnabled &&
            (snoozeRepeatLimit == SnoozeRepeatLimit.unlimited.rawValue ||
                snoozeCount < snoozeRepeatLimit)
    }

    /// PR3 하이브리드 분기의 단일 진실 원천.
    /// `repeatDaysMask != 0 && holidayOff` 인 반복 알람만 `.fixed` one-shot 경로를 타며,
    /// AlarmKit `.weekly` 가 표현할 수 없는 공휴일 skip 을 앱이 직접 재무장으로 구현한다.
    /// 그 외(반복+공휴일off 아님 -> `.relative(.weekly)`, 단발 -> `.relative(.never)`)는
    /// AlarmKit 네이티브 timezone 적응 + 자동 재무장을 그대로 유지한다.
    /// makeSchedule / recoverScheduledAlarms 후보 필터 / markStopped / BackgroundSyncTask
    /// 가 모두 이 헬퍼로 동일한 분기를 표현해 inline 술어 분기 발산을 막는다.
    var isHolidayOffRecurring: Bool { repeatDaysMask != 0 && holidayOff }

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

    /// Android `AlarmEntity` 와 맞춘 designated init. 누락된 필드는 default 사용.
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
        voiceListenerTitle: String? = nil,
        voiceText: String? = nil,
        voiceCategory: String? = nil,
        voiceLanguage: String? = nil,
        voiceRandomPrompt: Bool = false,
        voiceRandomContext: String? = nil,
        voiceWeatherCountry: String? = nil,
        voiceWeatherCity: String? = nil,
        voiceFortuneGender: String? = nil,
        voiceFortuneBirthDate: String? = nil,
        voiceFortuneBirthTime: String? = nil,
        dynamicVoicePreparedForFireAtMillis: Int64? = nil,
        voiceRepeat: Bool = true,
        voiceVolumePercent: Int = 100,
        ttsMessageId: String? = nil,
        voiceBucket: String? = nil,
        voiceRotationIndex: Int = 0,
        voiceBucketClipKeys: [String]? = nil,
        remoteAlarmId: String? = nil,
        lastSyncedAtMillis: Int64? = nil,
        syncState: String = AlarmSyncState.localOnly.rawValue,
        origin: String = AlarmOrigin.localOwned.rawValue,
        alarmVolumePercent: Int = 100,
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
        self.voiceListenerTitle = voiceListenerTitle
        self.voiceText = voiceText
        self.voiceCategory = voiceCategory
        self.voiceLanguage = voiceLanguage
        self.voiceRandomPrompt = voiceRandomPrompt
        self.voiceRandomContext = voiceRandomContext
        self.voiceWeatherCountry = voiceWeatherCountry
        self.voiceWeatherCity = voiceWeatherCity
        self.voiceFortuneGender = voiceFortuneGender
        self.voiceFortuneBirthDate = voiceFortuneBirthDate
        self.voiceFortuneBirthTime = voiceFortuneBirthTime
        self.dynamicVoicePreparedForFireAtMillis = dynamicVoicePreparedForFireAtMillis
        self.voiceRepeat = voiceRepeat
        self.voiceVolumePercent = voiceVolumePercent
        self.ttsMessageId = ttsMessageId
        self.voiceBucket = voiceBucket
        self.voiceRotationIndex = voiceRotationIndex
        self.voiceBucketClipKeys = voiceBucketClipKeys
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
        case voiceListenerTitle
        case voiceText
        case voiceCategory
        case voiceLanguage
        case voiceRandomPrompt
        case voiceRandomContext
        case voiceWeatherCountry
        case voiceWeatherCity
        case voiceFortuneGender
        case voiceFortuneBirthDate
        case voiceFortuneBirthTime
        case dynamicVoicePreparedForFireAtMillis
        case voiceRepeat
        case voiceVolumePercent
        case ttsMessageId
        case voiceBucket
        case voiceRotationIndex
        case voiceBucketClipKeys
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

        // Legacy 17필드 호환 키 (iOS 초기 빌드 JSON). 디코딩 전용.
        // alarmKitID 는 동일 키를 String/UUID 두 형식으로 시도하므로 별도 케이스 불필요.
        case legacyRemoteID = "remoteID"
        case legacyRepeatWeekdays = "repeatWeekdays"
        case legacyVoiceProfileID = "voiceProfileID"
        case legacyMessageID = "messageID"
        case legacyRawAudioURL = "rawAudioURL"
        case legacyLocalAudioFilePath = "localAudioFilePath"
        case legacyUpdatedAt = "updatedAt"
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
        self.voiceListenerTitle = try c.decodeIfPresent(String.self, forKey: .voiceListenerTitle)
        self.voiceText = try c.decodeIfPresent(String.self, forKey: .voiceText)
        self.voiceCategory = try c.decodeIfPresent(String.self, forKey: .voiceCategory)
        self.voiceLanguage = try c.decodeIfPresent(String.self, forKey: .voiceLanguage)
        self.voiceRandomPrompt = try c.decodeIfPresent(Bool.self, forKey: .voiceRandomPrompt) ?? false
        self.voiceRandomContext = try c.decodeIfPresent(String.self, forKey: .voiceRandomContext)
        self.voiceWeatherCountry = try c.decodeIfPresent(String.self, forKey: .voiceWeatherCountry)
        self.voiceWeatherCity = try c.decodeIfPresent(String.self, forKey: .voiceWeatherCity)
        self.voiceFortuneGender = try c.decodeIfPresent(String.self, forKey: .voiceFortuneGender)
        self.voiceFortuneBirthDate = try c.decodeIfPresent(String.self, forKey: .voiceFortuneBirthDate)
        self.voiceFortuneBirthTime = try c.decodeIfPresent(String.self, forKey: .voiceFortuneBirthTime)
        self.dynamicVoicePreparedForFireAtMillis = try c.decodeIfPresent(
            Int64.self,
            forKey: .dynamicVoicePreparedForFireAtMillis
        )
        self.voiceRepeat = try c.decodeIfPresent(Bool.self, forKey: .voiceRepeat) ?? true
        self.voiceVolumePercent = try c.decodeIfPresent(Int.self, forKey: .voiceVolumePercent) ?? 100
        self.ttsMessageId = try c.decodeIfPresent(String.self, forKey: .ttsMessageId)
            ?? c.decodeIfPresent(String.self, forKey: .legacyMessageID)
        self.voiceBucket = try c.decodeIfPresent(String.self, forKey: .voiceBucket)
        self.voiceRotationIndex = try c.decodeIfPresent(Int.self, forKey: .voiceRotationIndex) ?? 0
        self.voiceBucketClipKeys = try c.decodeIfPresent([String].self, forKey: .voiceBucketClipKeys)

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
        self.alarmVolumePercent = try c.decodeIfPresent(Int.self, forKey: .alarmVolumePercent) ?? 100
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

    /// Encodable. legacy 키 케이스는 디코딩 전용이라 auto-synthesis 가 실패하므로
    /// stored property 만 직렬화하는 인코더를 직접 구현한다.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(label, forKey: .label)
        try c.encode(hour, forKey: .hour)
        try c.encode(minute, forKey: .minute)
        try c.encode(fireAtMillis, forKey: .fireAtMillis)
        try c.encode(repeatDaysMask, forKey: .repeatDaysMask)
        try c.encode(holidayOff, forKey: .holidayOff)
        try c.encode(snoozeEnabled, forKey: .snoozeEnabled)
        try c.encode(snoozeMinutes, forKey: .snoozeMinutes)
        try c.encode(snoozeRepeatLimit, forKey: .snoozeRepeatLimit)
        try c.encode(snoozeCount, forKey: .snoozeCount)
        try c.encode(vibrationPattern, forKey: .vibrationPattern)
        try c.encode(playMode, forKey: .playMode)
        try c.encode(defaultAlarmSoundId, forKey: .defaultAlarmSoundId)
        try c.encodeIfPresent(localAudioUri, forKey: .localAudioUri)
        try c.encodeIfPresent(audioCacheKey, forKey: .audioCacheKey)
        try c.encodeIfPresent(rawAudioUri, forKey: .rawAudioUri)
        try c.encode(voiceSource, forKey: .voiceSource)
        try c.encodeIfPresent(voiceProfileId, forKey: .voiceProfileId)
        try c.encodeIfPresent(voiceListenerTitle, forKey: .voiceListenerTitle)
        try c.encodeIfPresent(voiceText, forKey: .voiceText)
        try c.encodeIfPresent(voiceCategory, forKey: .voiceCategory)
        try c.encodeIfPresent(voiceLanguage, forKey: .voiceLanguage)
        try c.encode(voiceRandomPrompt, forKey: .voiceRandomPrompt)
        try c.encodeIfPresent(voiceRandomContext, forKey: .voiceRandomContext)
        try c.encodeIfPresent(voiceWeatherCountry, forKey: .voiceWeatherCountry)
        try c.encodeIfPresent(voiceWeatherCity, forKey: .voiceWeatherCity)
        try c.encodeIfPresent(voiceFortuneGender, forKey: .voiceFortuneGender)
        try c.encodeIfPresent(voiceFortuneBirthDate, forKey: .voiceFortuneBirthDate)
        try c.encodeIfPresent(voiceFortuneBirthTime, forKey: .voiceFortuneBirthTime)
        try c.encodeIfPresent(dynamicVoicePreparedForFireAtMillis, forKey: .dynamicVoicePreparedForFireAtMillis)
        try c.encode(voiceRepeat, forKey: .voiceRepeat)
        try c.encode(voiceVolumePercent, forKey: .voiceVolumePercent)
        try c.encodeIfPresent(ttsMessageId, forKey: .ttsMessageId)
        try c.encodeIfPresent(voiceBucket, forKey: .voiceBucket)
        try c.encode(voiceRotationIndex, forKey: .voiceRotationIndex)
        try c.encodeIfPresent(voiceBucketClipKeys, forKey: .voiceBucketClipKeys)
        try c.encodeIfPresent(remoteAlarmId, forKey: .remoteAlarmId)
        try c.encodeIfPresent(lastSyncedAtMillis, forKey: .lastSyncedAtMillis)
        try c.encode(syncState, forKey: .syncState)
        try c.encode(origin, forKey: .origin)
        try c.encode(alarmVolumePercent, forKey: .alarmVolumePercent)
        try c.encodeIfPresent(alarmSoundUri, forKey: .alarmSoundUri)
        try c.encodeIfPresent(alarmSoundLabel, forKey: .alarmSoundLabel)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(state, forKey: .state)
        try c.encode(createdAtMillis, forKey: .createdAtMillis)
        try c.encode(updatedAtMillis, forKey: .updatedAtMillis)
        try c.encodeIfPresent(alarmKitID, forKey: .alarmKitID)
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
    case alarmNotFound
    case invalidHour
    case invalidMinute
    case invalidRepeatDaysMask
    case invalidSnoozeMinutes
    case invalidSnoozeRepeatLimit
    case invalidAlarmVolume
    case invalidVoiceVolume
    case unknownVibrationPattern
    case unknownPlayMode
    case unknownVoiceSource
    case voiceAudioRequired
    case duplicateTime

    var errorDescription: String? {
        switch self {
        case .alarmNotFound: return "알람을 찾지 못했어요."
        case .invalidHour: return "시는 0~23 사이여야 해요."
        case .invalidMinute: return "분은 0~59 사이여야 해요."
        case .invalidRepeatDaysMask: return "반복 요일 비트가 유효하지 않아요."
        case .invalidSnoozeMinutes: return "다시 알림은 1~30분이어야 해요."
        case .invalidSnoozeRepeatLimit: return "다시 알림 반복 횟수가 유효하지 않아요."
        case .invalidAlarmVolume: return "알람 볼륨은 0~100 사이여야 해요."
        case .invalidVoiceVolume: return "목소리 크기는 0~100 사이여야 해요."
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

