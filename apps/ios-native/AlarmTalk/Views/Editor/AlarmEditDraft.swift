import Foundation

/// 알람 편집 시트 내부 상태 컨테이너.
///
/// `LocalAlarmRecord` 중 **사용자가 시트에서 편집 가능한** 부분만
/// 모아 둔 가벼운 struct. 시트 내부에서는 본 struct 만 `@State` 로 들고,
/// 저장 시점에 `toRecord(...)` 가 기존 record(있다면) 의 나머지 필드를
/// 보존하면서 `LocalAlarmRecord` 를 만들어낸다.
///
/// Android 의 `AlarmEditorState` 와 같은 저장 계약을 쓰되, UI 표현은 iOS 흐름에 맞춘다.
struct AlarmEditDraft: Equatable {
    /// 목소리 음량 하한. **0 을 허용하지 않는다** — 0 은 '무음' 이라는 별개의 뜻인데
    /// 슬라이더 끝값으로 두면 실수로 닿아 목소리 알람이 조용히 안 들리게 된다.
    /// 끄는 것은 재생 방식을 '알람' 으로 바꾸는 것으로 표현한다.
    private static let minVoiceVolumePercent = 10

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

    /// ⚠ 기본 인자가 **목소리**다. 우리는 목소리 알람 앱이라 새 알람은 목소리로 연다
    /// — 무료 등급 잠금은 호출부(`defaultPlayModeForPlan`)가 판단한다.
    static func newDefault(defaultPlayMode: AlarmPlayMode = .voiceOnly) -> AlarmEditDraft {
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
            // 무료 한-탭 저장 경로: 새 알람은 랜덤 문구 ON + preset 컨텍스트로 시작한다.
            // (Android `AlarmEditorState.from` line 331-333 동일.)
            voiceRandomPrompt: true,
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

    /// `음성만` 모드에서는 알람음이 실제 링 경로에 쓰이지 않으므로 사운드 컨트롤을 숨긴다.
    var showsAlarmSoundControls: Bool { playMode != .voiceOnly }

    /// Android `AlarmEditorState.hasFreshTtsAudio` 와 같은 목적.
    /// 기존 TTS 음원이 현재 선택한 목소리/문구/언어와 맞으면 재생성 없이 저장할 수 있다.
    ///
    /// `fireAtMillis` 는 랜덤 문구일 때만 의미가 있다. 랜덤 클립은 특정 발화 시각용으로
    /// 합성되므로(record 의 `dynamicVoicePreparedForFireAtMillis` 에 그 시각이 박혀 있다),
    /// 새 발화 시각이 다르면 재사용을 막아 stale 한 랜덤 음원이 저장되지 않게 한다. 고정 문구는
    /// 시각과 무관하므로(문구/프로필/언어 동일성만 보면 됨) `fireAtMillis` 는 no-op 이다.
    static func canReuseExistingTtsAudio(
        existing record: LocalAlarmRecord?,
        selectedProfileID: String?,
        text: String,
        randomPrompt: Bool,
        randomContext: String?,
        language: String,
        translateText: Bool,
        fireAtMillis: Int64,
        listenerTitle: String?
    ) -> Bool {
        guard let record,
              record.playModeEnum != .alarmOnly,
              record.voiceSourceEnum != .localAudio,
              (record.localAudioUri).nilIfBlank != nil,
              (record.audioCacheKey).nilIfBlank != nil,
              let selectedProfileID = (selectedProfileID).nilIfBlank,
              selectedProfileID == (record.voiceProfileId).nilIfBlank else {
            return false
        }

        let promptContext = RandomPromptContext.normalized(randomContext)
        let activeCategory = randomPrompt ? promptContext.ttsCategory : "custom"
        let activeLanguage = (randomPrompt || translateText)
            ? language.trimmingCharacters(in: .whitespacesAndNewlines)
            : "ko"
        guard activeCategory == ((record.voiceCategory).nilIfBlank ?? "custom"),
               activeLanguage == ((record.voiceLanguage).nilIfBlank ?? "ko") else {
            return false
        }
        guard (listenerTitle).nilIfBlank == (record.voiceListenerTitle).nilIfBlank else {
            return false
        }

        if randomPrompt {
            // 랜덤 클립은 발화 시각에 종속된다. record 가 어떤 시각용으로 준비됐는지
            // (`dynamicVoicePreparedForFireAtMillis`) 새 시각과 다르면 stale 이므로 재합성한다.
            // 준비 시각이 비어 있으면(아직 한 번도 refresh 되지 않은 알람) 재사용을 막는다.
            guard let preparedFireAt = record.dynamicVoicePreparedForFireAtMillis,
                  preparedFireAt == fireAtMillis else {
                return false
            }
            return record.voiceRandomPrompt &&
                RandomPromptContext.normalized(record.voiceRandomContext) == promptContext
        }

        let expectedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !expectedText.isEmpty else { return false }
        return !record.voiceRandomPrompt &&
            expectedText == (record.voiceText).nilIfBlank
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
            // Android `AlarmRepository.updateAlarm` 과 동일하게, 생성/수정 시 스누즈 횟수를 0 으로 초기화한다.
            snoozeCount: 0,
            vibrationPattern: vibrationPattern.rawValue,
            playMode: playMode.rawValue,
            defaultAlarmSoundId: existing?.defaultAlarmSoundId ?? DefaultAlarmSounds.bundledDefault,
            localAudioUri: alarmOnly ? nil : existing?.localAudioUri,
            audioCacheKey: alarmOnly ? nil : existing?.audioCacheKey,
            rawAudioUri: alarmOnly ? nil : existing?.rawAudioUri,
            voiceSource: alarmOnly ? VoiceSource.localAudio.rawValue : existing?.voiceSource ?? VoiceSource.ttsProfile.rawValue,
            voiceProfileId: alarmOnly ? nil : existing?.voiceProfileId,
            voiceListenerTitle: alarmOnly ? nil : existing?.voiceListenerTitle,
            voiceText: alarmOnly ? nil : existing?.voiceText,
            voiceCategory: alarmOnly ? nil : existing?.voiceCategory,
            voiceLanguage: alarmOnly ? nil : existing?.voiceLanguage,
            voiceRandomPrompt: !alarmOnly && voiceRandomPrompt,
            voiceRandomContext: !alarmOnly && voiceRandomPrompt ? promptContext.rawValue : nil,
            voiceWeatherCountry: storesWeather ? (voiceWeatherCountry).nilIfBlank : nil,
            voiceWeatherCity: storesWeather ? (voiceWeatherCity).nilIfBlank : nil,
            voiceFortuneGender: storesFortune ? (voiceFortuneGender).nilIfBlank : nil,
            voiceFortuneBirthDate: storesFortune ? (voiceFortuneBirthDate).nilIfBlank : nil,
            voiceFortuneBirthTime: storesFortune ? (voiceFortuneBirthTime).nilIfBlank : nil,
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
            // iOS 는 OS 알람 톤 음량을 바꿀 수 없어 이 값이 아무것도 제어하지 않는다.
            // 그래도 **0 이 갇히는 것은 막는다** — 예전 빌드의 '알람음' 토글이 0 을 저장했고,
            // 그 값이 in-app 폴백 재생을 막아 '목소리 알람인데 목소리가 안 난다' 가 됐다.
            // 화면에 그 값을 되돌릴 컨트롤이 더는 없으므로 저장 시 정규화한다.
            alarmVolumePercent: alarmVolumePercent > 0 ? alarmVolumePercent : 100,
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

