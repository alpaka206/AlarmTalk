import Foundation

// MARK: - LocalAlarmRecord
// Android `AlarmEntity.kt:7-45` 의 알람 필드와 1:1 매칭.
// 필드명만 Swift camelCase. epoch ms 는 `Int64` 로 직렬화.
struct LocalAlarmRecord: Identifiable, Codable, Equatable, Hashable {

    /// 화면 확인용 표본 알람의 id 접두사(`-UIPreviewSeed`).
    ///
    /// 진짜 알람 id 는 UUID 라 이 접두사와 겹칠 수 없다 — 그래서 저장소에서 표본만
    /// 골라낼 수 있다. `UIPreviewSeed` 가 만드는 id 는 전부 이걸로 시작해야 한다.
    static let previewIDPrefix = "preview-"

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
    var remoteAlarmId: String?
    var lastSyncedAtMillis: Int64?
    var remoteDeliveryVersion: String?
    /// **이 행을 만들거나 갱신할 때 서버가 준 전달 세대.** 반영·ACK 성패와 무관하게 그 자리에서 적는다.
    ///
    /// ⚠ `remoteDeliveryVersion`(=음원·예약까지 끝냈다)과 다른 값이다. 이 값이 있어야
    /// **재전송**과 **반영 실패**가 갈린다 — 서버 세대가 이 값과 같으면 내가 이미 받은 그
    /// 전달이라 수신자 편집을 보존하고, 다르면 발신자가 **다시 보낸 것**이라 덮어쓴다.
    /// 안드로이드 짝은 `AlarmEntity.observedDeliveryVersion`, 규칙은
    /// `docs/spec/family-alarm.md` 「적용한 전달 버전을 로컬에 남긴다」.
    var observedDeliveryVersion: String?
    var syncState: String           // AlarmSyncState.rawValue
    var origin: String              // AlarmOrigin.rawValue
    var alarmVolumePercent: Int     // 0..100
    var alarmSoundUri: String?
    var alarmSoundLabel: String?
    var enabled: Bool
    var state: String               // AlarmRuntimeState.rawValue
    var createdAtMillis: Int64
    var updatedAtMillis: Int64

    /// 무료 전환으로 **잠그기 전의** 재생 방식.
    ///
    /// ⚠ **잠금은 삭제가 아니다.** 구독이 끝나면 목소리 알람을 지우는 게 아니라
    /// `playMode` 만 `alarm_only` 로 내리고 원래 값을 여기 보관한다. 다시 유료가 되면
    /// 이 값으로 되돌린다 — 안드로이드 `AlarmEntity.preLockPlayMode` 미러.
    ///
    /// iOS 는 예전에 **행과 음원을 함께 영구 삭제**했다. 재결제해도 돌아오지 않아
    /// "내일 아침 알람이 없어졌다" 가 됐다(2026-08-07 수정).
    var preLockPlayMode: String?

    /// 이 알람을 만든 계정. 무료 전환 잠금이 **다른 계정 알람까지 건드리지 않게** 하는 가드.
    /// 안드로이드 `AlarmEntity.ownerUserId` 미러.
    var ownerUserId: String?

    /// 고른 **무료 테마(버킷)**. 안드로이드 `AlarmEntity.bucketId` 미러.
    ///
    /// ⚠ **런타임 파생으로 두지 말 것.** 예전 iOS 는 테마를 `audioCacheKey` 의
    /// `stock_<messageId>` 에서 스톡 매니페스트를 거꾸로 뒤져 알아냈고, 그 복원은
    /// **캐시 파일이 살아 있을 때만** 됐다. 파일이 없으면 편집기가 테마를 잃은 채 열리고,
    /// 그대로 저장하면 고른 적 없는 '기본 인사말' 알람으로 조용히 바뀐다.
    /// 값 하나를 행에 적어 두면 캐시와 무관하게 무엇을 골랐는지 남는다.
    var bucketId: String?

    /// 이 테마에 묶인 클립들의 캐시 키. 안드로이드 `AlarmEntity.bucketClipKeysJson` 미러.
    ///
    /// ⚠ **한 개만 들고 있지 말 것.** 무료 테마는 울릴 때마다 다음 클립으로 넘어가는 게
    /// 기능이다 — 하나만 묶으면 매일 같은 문구를 듣는다(iOS 가 2026-08-08 전까지 그랬다).
    var bucketClipKeys: [String]?

    /// 다음에 쓸 클립의 자리. 울린 뒤 하나씩 전진한다.
    ///
    /// ⚠ **날씨·운세 테마는 전진하지 않는다.** 그 둘은 '조건에 맞는 클립' 을 고르는
    /// 것이라(비 오는 날엔 비 문구) 순서를 돌리면 엉뚱한 문구가 나온다. 안드로이드
    /// `MATCHING_BUCKET_IDS` 와 같은 이유다.
    var bucketRotationIndex: Int?

    /// 날씨 테마가 **실제 예보로 확정한** 클립 자리(0-based, `StockClip.variant` 와 같은 축).
    ///
    /// 저장할 때 서버에 그 도시·그 날짜의 조건을 물어(`getPrerenderVariant`) 여기 적어 둔다.
    /// 울릴 때는 이 값만 읽으므로 **발사 순간 네트워크가 필요 없다.**
    /// `nil` = 아직 못 받았다(≠ 맑음). 안드로이드 `AlarmEntity.contextVariantIndex` 미러.
    var contextVariantIndex: Int?

    /// 위 값을 **언제** 받았는가(epoch ms). 한 발사분에 한 번만 받기 위한 시계다 —
    /// 판정은 `BucketVariantResolver.weatherVariantNeedsRefresh`.
    /// 안드로이드 `AlarmEntity.contextResolvedAtMillis` 미러.
    var contextResolvedAtMillis: Int64?

    // iOS-only:
    /// AlarmKit `Alarm.id` (UUID). 직렬화는 String 으로.
    var alarmKitID: String?

    /// **그 예약에 실어 보낸 소리의 지문**(`AlarmSoundPlan.fingerprint`).
    ///
    /// iOS 는 발사 시점에 우리 코드가 돌지 않아, 예약할 때 넘긴 사운드가 그대로 울린다.
    /// 그래서 행만 고치고 재예약을 잊으면 **행과 실제 소리가 갈라진다.**
    /// 이 값이 지금 행의 지문과 다르면 `AlarmScheduleReconciler` 가 다시 예약한다.
    /// `nil` = 아직 예약한 적 없거나 옛 버전이 만든 행(그때는 예약 경로가 채운다).
    var scheduledSoundFingerprint: String?

    // MARK: Convenience accessors (Phase 2-B2/B3 가 사용)

    var playModeEnum: AlarmPlayMode { AlarmPlayMode.decode(playMode) }
    var syncStateEnum: AlarmSyncState { AlarmSyncState(rawValue: syncState) ?? .localOnly }
    var originEnum: AlarmOrigin { AlarmOrigin(rawValue: origin) ?? .localOwned }
    var runtimeStateEnum: AlarmRuntimeState { AlarmRuntimeState.decode(state) }
    var voiceSourceEnum: VoiceSource { VoiceSource(rawValue: voiceSource) ?? .ttsProfile }
    var vibrationPatternEnum: VibrationPattern { VibrationPattern(rawValue: vibrationPattern) ?? .default }

    /// ⚠ **재생 방식만으로 '유료 목소리' 라고 하지 말 것**(2026-08-18, 실제 계정으로 확인).
    /// 예전에는 `playMode != .alarmOnly` 하나만 참이어도 유료로 봤다. 그래서 **목소리 자원이
    /// 하나도 없는 알람**(profileId·ttsMessageId·오디오 전부 없음)이 유료로 분류돼,
    /// **한 번도 유료였던 적 없는 계정**의 알람이 잠기고 "무료 이용권으로 바뀌었어요" 가
    /// 떴다(구독 이력 0건인 `ronald@estsoft.com` 의 07:30 알람이 `mode=sound-only` 로
    /// 서버에 박혀 있었다). 말할 자원이 없는 알람은 유료 기능을 쓰는 게 아니다 —
    /// 그런 알람은 `RemoteAlarmMapper` 가 이미 알람음으로 내려 둔다.
    ///
    /// 잠긴 뒤에도 참이어야 한다는 점은 그대로다: 잠금은 `playMode` 만 바꾸고
    /// `voiceProfileId` 는 남기므로 자원 기준으로 봐도 계속 대상으로 잡힌다.
    var usesPaidVoiceFeatures: Bool {
        !(localAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) ||
            !(rawAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) ||
            !(voiceProfileId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) ||
            !(ttsMessageId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    }

    /// **직접 입력 문구로 합성한 음성 알람인가** — 서버 `messages.category = 'custom'` 의 로컬 짝.
    ///
    /// 제자리 목소리 교체는 프리셋(버킷) 알람을 **같은 message id 로 재렌더해 살리고**, 다시
    /// 만들 수 없는 직접 입력만 내린다. 그래서 이 판정식을 넓히면 되돌릴 수 없이 프리셋
    /// 알람까지 벗긴다. 안드로이드 짝은 `AlarmEntity.usesCustomMessageVoice()` —
    /// **둘은 철자까지 같아야 한다.**
    var usesCustomMessageVoice: Bool {
        // ⚠ **`voiceCategory == "custom"` 만 보면 안 된다.** 버킷이 붙으면 랜덤 생성이 꺼지고
        // 저장 카테고리가 "custom" 이 되므로, 버킷 없이 프리셋 클립 하나만 물린 **옛 행**은
        // 세 값이 직접 입력과 똑같아 보인다. 그 행은 캐시 키가 `stock_<messageId>` 라서
        // 갈라진다 — 직접 입력의 캐시 키는 문구 해시라 이 접두가 붙지 않는다.
        !voiceRandomPrompt &&
            bucketId?.nilIfBlank == nil &&
            !(audioCacheKey?.hasPrefix(AudioCacheStore.stockCacheKeyPrefix) ?? false) &&
            (voiceCategory == nil || voiceCategory == "custom")
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
        // **직접 녹음은 강등 대상이 아니다**(2026-08-12 확정).
        // ⚠ 이 술어와 `PaidVoiceGate.usesFreeSystemVoice` 는 **한 쌍이다 — 항상 같이 고친다.**
        // 한쪽만 고치면 '예약은 목소리로 되는데 앱을 껐다 켜면 잠긴다'(또는 그 반대)가 된다.
        if voiceSourceEnum == .localAudio, localAudioUri?.nilIfBlank != nil { return false }
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

    /// 알람 행에 쓰는 **12시간제** 시각(오전/오후는 [meridiemLabel] 로 따로 그린다).
    /// 안드로이드 `alarmRowClockLabel` 과 같다 — 시계 화면과 같은 읽기 방식이라
    /// 24시간제("19:30")보다 알람 목록에서 알아보기 쉽다.
    var clockLabel12h: String {
        let h12 = hour % 12 == 0 ? 12 : hour % 12
        return String(format: "%d:%02d", h12, minute)
    }

    /// 오전/오후. 시각 앞에 **작게** 붙인다(안드로이드 `rd2_am`/`rd2_pm`).
    var meridiemLabel: String { hour < 12 ? String(localized: "오전") : String(localized: "오후") }

    /// 행 둘째 줄의 '다음 울릴 날짜' — 예: "8월 7일 (금)".
    ///
    /// 안드로이드는 `DateUtils.formatDateTime(SHOW_DATE|ABBREV_MONTH|SHOW_WEEKDAY|
    /// ABBREV_WEEKDAY|NO_YEAR)` 로 만든다. 라벨(알람 이름) 대신 이걸 두는 게 의도다 —
    /// 기본 시계 앱의 라벨보다 '언제 울리나' 가 실용적이라서.
    func nextFireDateLabel() -> String {
        // ⚠ **로케일을 고정하지 말 것.** 사용자에게 보여 주는 날짜라 기기 언어를 따라야 한다
        // (안드로이드는 어디에서도 로케일을 고정하지 않는다). 기계 파싱용 포맷터만
        // `en_US_POSIX` 를 쓴다.
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.setLocalizedDateFormatFromTemplate("MMMEd")
        return formatter.string(from: nextFireDate)
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
        remoteAlarmId: String? = nil,
        lastSyncedAtMillis: Int64? = nil,
        remoteDeliveryVersion: String? = nil,
        observedDeliveryVersion: String? = nil,
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
        self.remoteAlarmId = remoteAlarmId
        self.lastSyncedAtMillis = lastSyncedAtMillis
        self.remoteDeliveryVersion = remoteDeliveryVersion
        self.observedDeliveryVersion = observedDeliveryVersion
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
        case remoteAlarmId
        case lastSyncedAtMillis
        case remoteDeliveryVersion
        case observedDeliveryVersion
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
        case scheduledSoundFingerprint
        // ⚠ 아래 셋은 **한때 빠져 있었다**(2026-08-07 발견). CodingKeys 에 없으면
        // 디스크 왕복에서 조용히 사라진다 — 무료 전환 잠금이 원래 재생 방식을 잃어
        // 재결제해도 복원되지 않았고(preLockPlayMode), 잠금이 다른 계정 알람까지
        // 건드리지 않게 막는 가드도 늘 통과했다(ownerUserId).
        // **새 필드를 추가할 때는 여기와 디코더·인코더 세 곳을 함께 고칠 것.**
        case preLockPlayMode
        case ownerUserId
        case bucketId
        case bucketClipKeys
        case bucketRotationIndex
        case contextVariantIndex
        case contextResolvedAtMillis
    }

    /// Codable 디코딩. 신규 필드 누락 시 default 폴백.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // id 는 String 직렬화가 기본. 없으면 새 UUID.
        self.id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString

        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? "알람"
        self.hour = try c.decodeIfPresent(Int.self, forKey: .hour) ?? 7
        self.minute = try c.decodeIfPresent(Int.self, forKey: .minute) ?? 0

        self.repeatDaysMask = try c.decodeIfPresent(Int.self, forKey: .repeatDaysMask) ?? 0

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

        self.localAudioUri = try c.decodeIfPresent(String.self, forKey: .localAudioUri)

        self.audioCacheKey = try c.decodeIfPresent(String.self, forKey: .audioCacheKey)
        self.rawAudioUri = try c.decodeIfPresent(String.self, forKey: .rawAudioUri)

        self.voiceSource = try c.decodeIfPresent(String.self, forKey: .voiceSource)
            ?? VoiceSource.ttsProfile.rawValue
        self.voiceProfileId = try c.decodeIfPresent(String.self, forKey: .voiceProfileId)
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

        self.remoteAlarmId = try c.decodeIfPresent(String.self, forKey: .remoteAlarmId)
        self.lastSyncedAtMillis = try c.decodeIfPresent(Int64.self, forKey: .lastSyncedAtMillis)
        self.remoteDeliveryVersion = try c.decodeIfPresent(String.self, forKey: .remoteDeliveryVersion)
        // 옛 저장본에는 없다 — nil 이면 '어느 전달을 받았는지 모른다' 가 사실이라 예전 규칙을 쓴다.
        self.observedDeliveryVersion = try c.decodeIfPresent(String.self, forKey: .observedDeliveryVersion)

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

        self.updatedAtMillis = try c.decodeIfPresent(Int64.self, forKey: .updatedAtMillis) ?? now

        // alarmKitID: String 직렬화. 없으면 nil.
        self.alarmKitID = try c.decodeIfPresent(String.self, forKey: .alarmKitID)
        self.scheduledSoundFingerprint = try c.decodeIfPresent(String.self, forKey: .scheduledSoundFingerprint)
        self.preLockPlayMode = try c.decodeIfPresent(String.self, forKey: .preLockPlayMode)
        self.ownerUserId = try c.decodeIfPresent(String.self, forKey: .ownerUserId)
        self.bucketId = try c.decodeIfPresent(String.self, forKey: .bucketId)
        self.bucketClipKeys = try c.decodeIfPresent([String].self, forKey: .bucketClipKeys)
        self.bucketRotationIndex = try c.decodeIfPresent(Int.self, forKey: .bucketRotationIndex)
        self.contextVariantIndex = try c.decodeIfPresent(Int.self, forKey: .contextVariantIndex)
        self.contextResolvedAtMillis = try c.decodeIfPresent(Int64.self, forKey: .contextResolvedAtMillis)

        // fireAtMillis: 신규는 Int64. 없으면 hour/minute 으로 today/tomorrow 기본값.
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

    /// Encodable. 커스텀 디코더(default 폴백)와 짝을 맞춰 stored property 만
    /// 직렬화하는 인코더를 직접 구현한다.
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
        try c.encodeIfPresent(remoteAlarmId, forKey: .remoteAlarmId)
        try c.encodeIfPresent(lastSyncedAtMillis, forKey: .lastSyncedAtMillis)
        try c.encodeIfPresent(remoteDeliveryVersion, forKey: .remoteDeliveryVersion)
        try c.encodeIfPresent(observedDeliveryVersion, forKey: .observedDeliveryVersion)
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
        try c.encodeIfPresent(scheduledSoundFingerprint, forKey: .scheduledSoundFingerprint)
        try c.encodeIfPresent(preLockPlayMode, forKey: .preLockPlayMode)
        try c.encodeIfPresent(ownerUserId, forKey: .ownerUserId)
        try c.encodeIfPresent(bucketId, forKey: .bucketId)
        try c.encodeIfPresent(bucketClipKeys, forKey: .bucketClipKeys)
        try c.encodeIfPresent(bucketRotationIndex, forKey: .bucketRotationIndex)
        try c.encodeIfPresent(contextVariantIndex, forKey: .contextVariantIndex)
        try c.encodeIfPresent(contextResolvedAtMillis, forKey: .contextResolvedAtMillis)
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
        case .invalidSnoozeMinutes: return "다시 울림은 1~30분이어야 해요."
        case .invalidSnoozeRepeatLimit: return "다시 울림 반복 횟수가 유효하지 않아요."
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
/**
 * **알람 파일 쓰기를 한 줄로 세운다 — 늦게 도착한 옛 스냅샷이 새 파일을 덮지 않게.**
 *
 * 비동기 저장(`persist`)은 upsert 마다 그때의 스냅샷을 실어 보내고, 동기 저장(`saveNow`)은
 * 최신 스냅샷을 바로 쓴다. 둘이 다른 길로 가면 **먼저 큐에 실린 옛 스냅샷이 나중에 도착해**
 * 방금 확인한 저장을 되돌린다 — 그 위에서 교체 표식이 '반영함' 으로 확정되면, 다음 실행은
 * 목소리가 살아 있는 알람을 다시 읽어 오고도 영영 다시 내리지 않는다.
 *
 * 그래서 두 경로가 같은 자물쇠와 **스냅샷을 뜬 시점의 순번**을 쓴다. 순번이 뒤진 쓰기는 조용히
 * 버린다(이미 더 새 내용이 파일에 있다).
 */
final class LocalAlarmFileWriter: @unchecked Sendable {
    private let url: URL
    private let lock = NSLock()
    private var lastWrittenSeq: UInt64 = 0

    init(url: URL) { self.url = url }

    @discardableResult
    func write(_ alarms: [LocalAlarmRecord], seq: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        // 이미 더 새 스냅샷이 파일에 있다 — 되돌리지 않는다(성공으로 본다).
        guard seq >= lastWrittenSeq else { return true }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(alarms) else { return false }
        do {
            try data.write(to: url, options: [.atomic])
            lastWrittenSeq = seq
            return true
        } catch {
            return false
        }
    }
}

actor LocalAlarmPersistence {
    private let storageURL: URL
    private let writer: LocalAlarmFileWriter

    init(storageURL: URL, writer: LocalAlarmFileWriter) {
        self.storageURL = storageURL
        self.writer = writer
    }

    func load() -> [LocalAlarmRecord] {
        guard let data = try? Data(contentsOf: storageURL) else { return [] }
        let decoder = JSONDecoder()
        let loaded = (try? decoder.decode([LocalAlarmRecord].self, from: data)) ?? []
        // ⚠ **화면 확인용 가짜 알람은 디스크에서 걷어낸다**(2026-08-17).
        // `-UIPreviewSeed` 가 심은 표본이 실제 저장소에 눌러앉아 있었고, 다음에 **로그인한
        // 채로** 앱을 켜면 sync 가 그걸 사용자 알람으로 보고 서버에 올렸다. 실제 피해:
        //   · `preview-morning` 은 voiceProfileId 가 UUID 가 아니라 매 회차 400
        //     (INVALID_VOICE_PROFILE_ID)으로 떨어져 "알람 변경사항 일부를 저장하지
        //     못했어요" 가 영원히 반복됐다(실패한 건은 다음 회차에 또 걸린다).
        //   · `preview-weekday` 는 **성공**해서, 실행할 때마다 07:30 평일 알람이 계정에
        //     하나씩 새로 생겼다(dev 계정에 11개가 쌓여 있었다 — 전부 켜진 채로).
        // 심는 쪽도 임시 파일을 쓰도록 고쳤지만(`LocalAlarmStore`), 이미 저장된 기기가
        // 스스로 회복해야 하므로 읽는 자리에서도 거른다.
        let cleaned = loaded.filter { !$0.id.hasPrefix(LocalAlarmRecord.previewIDPrefix) }
        // 걸러낸 것이 있으면 **파일도 그 자리에서 고친다.** 메모리에서만 빼면 표본은
        // 디스크에 남아, 이 걸름을 되돌리거나 다른 경로가 파일을 직접 읽는 순간 되살아난다.
        // 표본 청소는 아직 아무 쓰기도 없는 시점이라 순번 0 으로 남긴다.
        if cleaned.count != loaded.count { save(cleaned, seq: 0) }
        return cleaned
    }

    /// 스냅샷을 뜬 시점의 순번과 함께 쓴다 — 동기 저장(`LocalAlarmStore.saveNow`)과 같은
    /// 자물쇠를 거치므로 늦게 도착해도 새 파일을 덮지 않는다.
    func save(_ alarms: [LocalAlarmRecord], seq: UInt64) {
        writer.write(alarms, seq: seq)
    }
}
