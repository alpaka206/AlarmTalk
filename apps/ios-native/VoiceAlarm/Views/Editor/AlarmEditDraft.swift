import Foundation

/// 알람 편집 시트 내부 상태 컨테이너.
///
/// `LocalAlarmRecord` 중 **사용자가 시트에서 편집 가능한** 부분만
/// 모아 둔 가벼운 struct. 시트 내부에서는 본 struct 만 `@State` 로 들고,
/// 저장 시점에 `toRecord(...)` 가 기존 record(있다면) 의 나머지 필드를
/// 보존하면서 `LocalAlarmRecord` 를 만들어낸다.
///
/// Android 의 `AlarmEditorState` (in_progress 편집 상태 모델) 와 1:1 대응.
struct AlarmEditDraft: Equatable {
    private static let minVoiceVolumePercent = 30

    var label: String
    var hour: Int           // 0..23
    var minute: Int         // 0..59

    var repeatDaysMask: Int // 0..0x7f
    var holidayOff: Bool

    var playMode: AlarmPlayMode

    var snoozeEnabled: Bool
    var snoozeMinutes: Int           // 1..30
    var snoozeRepeatLimit: SnoozeRepeatLimit

    var vibrationPattern: VibrationPattern
    var alarmVolumePercent: Int      // 0..100
    var voiceRandomPrompt: Bool
    var voiceRandomContext: String?
    var voiceWeatherCountry: String
    var voiceWeatherCity: String
    var voiceFortuneGender: String
    var voiceFortuneBirthDate: String
    var voiceFortuneBirthTime: String
    var voiceRepeat: Bool
    var voiceVolumePercent: Int

    // MARK: - 신규 생성 default

    static func newDefault(defaultPlayMode: AlarmPlayMode = .alarmOnly) -> AlarmEditDraft {
        return AlarmEditDraft(
            label: "",
            hour: 6,
            minute: 0,
            repeatDaysMask: 0,
            holidayOff: false,
            playMode: defaultPlayMode,
            snoozeEnabled: true,
            snoozeMinutes: 5,
            snoozeRepeatLimit: .three,
            vibrationPattern: .default,
            alarmVolumePercent: 100,
            voiceRandomPrompt: false,
            voiceRandomContext: RandomPromptContext.defaultContext.rawValue,
            voiceWeatherCountry: "",
            voiceWeatherCity: "",
            voiceFortuneGender: "",
            voiceFortuneBirthDate: "",
            voiceFortuneBirthTime: "",
            voiceRepeat: true,
            voiceVolumePercent: 100
        )
    }

    // MARK: - LocalAlarmRecord round-trip

    init(from record: LocalAlarmRecord) {
        self.label = record.label
        self.hour = record.hour
        self.minute = record.minute
        self.repeatDaysMask = record.repeatDaysMask
        self.holidayOff = record.holidayOff
        self.playMode = record.playModeEnum
        self.snoozeEnabled = record.snoozeEnabled
        self.snoozeMinutes = max(1, min(30, record.snoozeMinutes))
        self.snoozeRepeatLimit = SnoozeRepeatLimit(rawValue: record.snoozeRepeatLimit) ?? .three
        self.vibrationPattern = record.vibrationPatternEnum
        self.alarmVolumePercent = max(0, min(100, record.alarmVolumePercent))
        self.voiceRandomPrompt = record.voiceRandomPrompt
        self.voiceRandomContext = RandomPromptContext.normalized(record.voiceRandomContext).rawValue
        self.voiceWeatherCountry = record.voiceWeatherCountry ?? ""
        self.voiceWeatherCity = record.voiceWeatherCity ?? ""
        self.voiceFortuneGender = record.voiceFortuneGender ?? ""
        self.voiceFortuneBirthDate = record.voiceFortuneBirthDate ?? ""
        self.voiceFortuneBirthTime = record.voiceFortuneBirthTime ?? ""
        self.voiceRepeat = record.voiceRepeat
        self.voiceVolumePercent = Self.normalizedVoiceVolume(record.voiceVolumePercent)
    }

    init(
        label: String,
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        holidayOff: Bool,
        playMode: AlarmPlayMode,
        snoozeEnabled: Bool,
        snoozeMinutes: Int,
        snoozeRepeatLimit: SnoozeRepeatLimit,
        vibrationPattern: VibrationPattern,
        alarmVolumePercent: Int,
        voiceRandomPrompt: Bool = false,
        voiceRandomContext: String? = RandomPromptContext.defaultContext.rawValue,
        voiceWeatherCountry: String = "",
        voiceWeatherCity: String = "",
        voiceFortuneGender: String = "",
        voiceFortuneBirthDate: String = "",
        voiceFortuneBirthTime: String = "",
        voiceRepeat: Bool = true,
        voiceVolumePercent: Int = 100
    ) {
        self.label = label
        self.hour = hour
        self.minute = minute
        self.repeatDaysMask = repeatDaysMask
        self.holidayOff = holidayOff
        self.playMode = playMode
        self.snoozeEnabled = snoozeEnabled
        self.snoozeMinutes = snoozeMinutes
        self.snoozeRepeatLimit = snoozeRepeatLimit
        self.vibrationPattern = vibrationPattern
        self.alarmVolumePercent = alarmVolumePercent
        self.voiceRandomPrompt = voiceRandomPrompt
        self.voiceRandomContext = RandomPromptContext.normalized(voiceRandomContext).rawValue
        self.voiceWeatherCountry = voiceWeatherCountry
        self.voiceWeatherCity = voiceWeatherCity
        self.voiceFortuneGender = voiceFortuneGender
        self.voiceFortuneBirthDate = voiceFortuneBirthDate
        self.voiceFortuneBirthTime = voiceFortuneBirthTime
        self.voiceRepeat = voiceRepeat
        self.voiceVolumePercent = voiceVolumePercent
    }

    // MARK: - Validation

    enum ValidationError: Error, Equatable {
        case invalidHour
        case invalidMinute
        case invalidRepeatDaysMask
        case invalidSnoozeMinutes
        case invalidAlarmVolume
        case invalidVoiceVolume
    }

    /// 저장 가능한 상태인지 확인. 모든 오류를 묶어 반환.
    func validate() -> [ValidationError] {
        var errors: [ValidationError] = []
        if !(0...23).contains(hour) {
            errors.append(.invalidHour)
        }
        if !(0...59).contains(minute) {
            errors.append(.invalidMinute)
        }
        if !(0...0x7f).contains(repeatDaysMask) {
            errors.append(.invalidRepeatDaysMask)
        }
        if !(1...30).contains(snoozeMinutes) {
            errors.append(.invalidSnoozeMinutes)
        }
        if !(0...100).contains(alarmVolumePercent) {
            errors.append(.invalidAlarmVolume)
        }
        if playMode != .alarmOnly && !(Self.minVoiceVolumePercent...100).contains(voiceVolumePercent) {
            errors.append(.invalidVoiceVolume)
        }
        return errors
    }

    /// validate 가 빈 배열이면 true.
    var isValid: Bool { validate().isEmpty }

    /// Android `AlarmEditorState.hasFreshTtsAudio` 와 같은 목적.
    /// 기존 TTS 음원이 현재 선택한 목소리/문구/언어와 맞으면 재생성 없이 저장할 수 있다.
    static func canReuseExistingTtsAudio(
        existing record: LocalAlarmRecord?,
        selectedProfileID: String?,
        text: String,
        randomPrompt: Bool,
        randomContext: String?,
        language: String,
        translateText: Bool
    ) -> Bool {
        guard let record,
              record.playModeEnum != .alarmOnly,
              record.voiceSourceEnum != .localAudio,
              nonEmpty(record.localAudioUri) != nil,
              nonEmpty(record.audioCacheKey) != nil,
              let selectedProfileID = nonEmpty(selectedProfileID),
              selectedProfileID == nonEmpty(record.voiceProfileId) else {
            return false
        }

        let promptContext = RandomPromptContext.normalized(randomContext)
        let activeCategory = randomPrompt ? promptContext.ttsCategory : "custom"
        let activeLanguage = (randomPrompt || translateText)
            ? language.trimmingCharacters(in: .whitespacesAndNewlines)
            : "ko"
        guard activeCategory == (nonEmpty(record.voiceCategory) ?? "custom"),
              activeLanguage == (nonEmpty(record.voiceLanguage) ?? "ko") else {
            return false
        }

        if randomPrompt {
            return record.voiceRandomPrompt &&
                RandomPromptContext.normalized(record.voiceRandomContext) == promptContext
        }

        let expectedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !expectedText.isEmpty else { return false }
        return !record.voiceRandomPrompt &&
            expectedText == nonEmpty(record.voiceText)
    }

    // MARK: - Convert to record

    /// Draft → record 변환. 기존 record 가 있다면 *시트 외부* 에서만 의미 있는
    /// 필드 (audio cache, sync state, alarmKitID 등) 를 그대로 보존한다.
    func toRecord(
        existing: LocalAlarmRecord?,
        fireAtMillis: Int64,
        nowMillis: Int64
    ) -> LocalAlarmRecord {
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let safeLabel = trimmedLabel.isEmpty ? "알람" : trimmedLabel
        let promptContext = RandomPromptContext.normalized(voiceRandomContext)
        let alarmOnly = playMode == .alarmOnly
        let storesWeather = !alarmOnly && voiceRandomPrompt && promptContext.usesWeather
        let storesFortune = !alarmOnly && voiceRandomPrompt && promptContext.usesFortune

        return LocalAlarmRecord(
            id: existing?.id ?? UUID().uuidString,
            label: safeLabel,
            hour: hour,
            minute: minute,
            fireAtMillis: fireAtMillis,
            repeatDaysMask: repeatDaysMask,
            holidayOff: holidayOff,
            snoozeEnabled: snoozeEnabled,
            snoozeMinutes: snoozeMinutes,
            snoozeRepeatLimit: snoozeRepeatLimit.rawValue,
            snoozeCount: existing?.snoozeCount ?? 0,
            vibrationPattern: vibrationPattern.rawValue,
            playMode: playMode.rawValue,
            defaultAlarmSoundId: existing?.defaultAlarmSoundId ?? DefaultAlarmSounds.bundledDefault,
            localAudioUri: alarmOnly ? nil : existing?.localAudioUri,
            audioCacheKey: alarmOnly ? nil : existing?.audioCacheKey,
            rawAudioUri: alarmOnly ? nil : existing?.rawAudioUri,
            voiceSource: alarmOnly ? VoiceSource.localAudio.rawValue : existing?.voiceSource ?? VoiceSource.ttsProfile.rawValue,
            voiceProfileId: alarmOnly ? nil : existing?.voiceProfileId,
            voiceText: alarmOnly ? nil : existing?.voiceText,
            voiceCategory: alarmOnly ? nil : existing?.voiceCategory,
            voiceLanguage: alarmOnly ? nil : existing?.voiceLanguage,
            voiceRandomPrompt: !alarmOnly && voiceRandomPrompt,
            voiceRandomContext: !alarmOnly && voiceRandomPrompt ? promptContext.rawValue : nil,
            voiceWeatherCountry: storesWeather ? nonEmpty(voiceWeatherCountry) : nil,
            voiceWeatherCity: storesWeather ? nonEmpty(voiceWeatherCity) : nil,
            voiceFortuneGender: storesFortune ? nonEmpty(voiceFortuneGender) : nil,
            voiceFortuneBirthDate: storesFortune ? nonEmpty(voiceFortuneBirthDate) : nil,
            voiceFortuneBirthTime: storesFortune ? nonEmpty(voiceFortuneBirthTime) : nil,
            dynamicVoicePreparedForFireAtMillis: !alarmOnly && voiceRandomPrompt
                ? existing?.dynamicVoicePreparedForFireAtMillis
                : nil,
            voiceRepeat: alarmOnly ? true : voiceRepeat,
            voiceVolumePercent: alarmOnly ? 100 : Self.normalizedVoiceVolume(voiceVolumePercent),
            ttsMessageId: alarmOnly ? nil : existing?.ttsMessageId,
            remoteAlarmId: existing?.remoteAlarmId,
            lastSyncedAtMillis: existing?.lastSyncedAtMillis,
            syncState: existing?.remoteAlarmId == nil
                ? AlarmSyncState.localOnly.rawValue
                : AlarmSyncState.dirty.rawValue,
            origin: existing?.origin ?? AlarmOrigin.localOwned.rawValue,
            alarmVolumePercent: alarmVolumePercent,
            alarmSoundUri: existing?.alarmSoundUri,
            alarmSoundLabel: existing?.alarmSoundLabel,
            enabled: true,
            state: AlarmRuntimeState.armed.rawValue,
            createdAtMillis: existing?.createdAtMillis ?? nowMillis,
            updatedAtMillis: nowMillis,
            alarmKitID: nil
        )
    }

    private static func normalizedVoiceVolume(_ value: Int) -> Int {
        max(minVoiceVolumePercent, min(100, value))
    }
}

private func nonEmpty(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
}
