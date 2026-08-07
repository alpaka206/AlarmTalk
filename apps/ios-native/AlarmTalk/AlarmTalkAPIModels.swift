import Foundation

struct AuthSession: Codable, Equatable {
    var token: String
    var user: AuthUser
}

// MARK: - Holiday API (GET /holiday)
// 백엔드 다국가 공휴일 응답. decoder 가 convertFromSnakeCase 이므로 Swift 프로퍼티는 camelCase.
struct HolidayApiResponse: Decodable {
    let holidays: [HolidayApiItem]
}

struct HolidayApiItem: Decodable {
    let date: String        // "yyyy-MM-dd"
    let name: String
    let type: String        // "public" 만 알람 skip 대상
    let substitute: Bool?
    let source: String?
}

struct FamilyAlarmQuietWindow: Codable, Equatable {
    var days: [Int]
    var start: String
    var end: String
}

struct DynamicPromptWeatherSettings: Codable, Equatable {
    var country: String?
    var city: String?
}

struct DynamicPromptFortuneSettings: Codable, Equatable {
    var gender: String?
    var birthDate: String?
    var birthTime: String?
}

struct DynamicPromptSettings: Codable, Equatable {
    var weather: DynamicPromptWeatherSettings
    var fortune: DynamicPromptFortuneSettings

    init(
        weather: DynamicPromptWeatherSettings = DynamicPromptWeatherSettings(country: nil, city: nil),
        fortune: DynamicPromptFortuneSettings = DynamicPromptFortuneSettings(gender: nil, birthDate: nil, birthTime: nil)
    ) {
        self.weather = DynamicPromptWeatherSettings(
            country: (weather.country).nilIfBlank,
            city: (weather.city).nilIfBlank
        )
        self.fortune = DynamicPromptFortuneSettings(
            gender: (fortune.gender).nilIfBlank,
            birthDate: (fortune.birthDate).nilIfBlank,
            birthTime: (fortune.birthTime).nilIfBlank
        )
    }

    static let empty = DynamicPromptSettings(
        weather: DynamicPromptWeatherSettings(country: nil, city: nil),
        fortune: DynamicPromptFortuneSettings(gender: nil, birthDate: nil, birthTime: nil)
    )

    private enum CodingKeys: String, CodingKey {
        case weather
        case fortune
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            weather: try container.decodeIfPresent(DynamicPromptWeatherSettings.self, forKey: .weather)
                ?? DynamicPromptWeatherSettings(country: nil, city: nil),
            fortune: try container.decodeIfPresent(DynamicPromptFortuneSettings.self, forKey: .fortune)
                ?? DynamicPromptFortuneSettings(gender: nil, birthDate: nil, birthTime: nil)
        )
    }

}

struct DynamicPromptSettingsState: Codable, Equatable {
    var weatherReady: Bool?
    var fortuneReady: Bool?
}

struct DynamicPromptPreferences: Codable, Equatable {
    var weatherCountry: String = ""
    var weatherCity: String = ""
    var fortuneGender: String = ""
    var fortuneBirthDate: String = ""
    var fortuneBirthTime: String = ""

    /// Keychain account 키. 과거 UserDefaults 키와 동일 문자열을 재사용하되 저장소만
    /// Keychain 으로 옮긴다. 운세용 성별/생년월일/태어난 시각은 민감 정보라
    /// UserDefaults(plist, 평문) 대신 Keychain 에 보관한다(audit low 대응).
    private static let storageKey = "dynamic_prompt_preferences"

    static func from(settings: DynamicPromptSettings?) -> DynamicPromptPreferences {
        DynamicPromptPreferences(
            weatherCountry: settings?.weather.country?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            weatherCity: settings?.weather.city?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            fortuneGender: settings?.fortune.gender?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            fortuneBirthDate: settings?.fortune.birthDate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            fortuneBirthTime: settings?.fortune.birthTime?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        )
    }

    /// Keychain 에서 로드한다. API 시그니처는 유지(`loadFromDefaults`)하되 저장소는
    /// Keychain. 과거 UserDefaults 에 남아 있을 수 있는 평문 잔재가 있으면 본 호출에서
    /// 정리한다(민감 정보가 plist 에 남지 않도록).
    static func loadFromDefaults() -> DynamicPromptPreferences {
        // 평문 UserDefaults 잔재 제거(있다면). 신규 설치엔 없음.
        UserDefaults.standard.removeObject(forKey: storageKey)
        guard let data = KeychainStore.readData(account: storageKey),
              let decoded = try? JSONDecoder().decode(DynamicPromptPreferences.self, from: data) else {
            return DynamicPromptPreferences()
        }
        return decoded.normalized()
    }

    /// Keychain 에 저장한다. API 시그니처는 유지(`saveToDefaults`).
    func saveToDefaults() {
        guard let data = try? JSONEncoder().encode(normalized()) else { return }
        KeychainStore.saveData(data, account: Self.storageKey)
    }

    func toSettings() -> DynamicPromptSettings {
        DynamicPromptSettings(
            weather: DynamicPromptWeatherSettings(
                country: (weatherCountry).nilIfBlank,
                city: (weatherCity).nilIfBlank
            ),
            fortune: DynamicPromptFortuneSettings(
                gender: (fortuneGender).nilIfBlank,
                birthDate: (fortuneBirthDate).nilIfBlank,
                birthTime: (fortuneBirthTime).nilIfBlank
            )
        )
    }

    var weatherReady: Bool {
        (weatherCountry).nilIfBlank != nil && (weatherCity).nilIfBlank != nil
    }

    var fortuneReady: Bool {
        (fortuneGender).nilIfBlank != nil &&
            (fortuneBirthDate).nilIfBlank != nil &&
            (fortuneBirthTime).nilIfBlank != nil
    }

    private func normalized() -> DynamicPromptPreferences {
        DynamicPromptPreferences(
            weatherCountry: weatherCountry.trimmingCharacters(in: .whitespacesAndNewlines),
            weatherCity: weatherCity.trimmingCharacters(in: .whitespacesAndNewlines),
            fortuneGender: fortuneGender.trimmingCharacters(in: .whitespacesAndNewlines),
            fortuneBirthDate: fortuneBirthDate.trimmingCharacters(in: .whitespacesAndNewlines),
            fortuneBirthTime: fortuneBirthTime.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

}

struct AuthUser: Codable, Equatable, Identifiable {
    var id: String
    var email: String
    var name: String
    var plan: String
    var allowFamilyAlarms: Bool? = nil
    var familyAlarmQuietDays: [Int]? = nil
    var familyAlarmQuietStart: String? = nil
    var familyAlarmQuietEnd: String? = nil
    var familyAlarmQuietWindows: [FamilyAlarmQuietWindow]? = nil
    /// Apple `sub` (user identifier). Apple 로그인 사용자만 비-nil.
    /// `ASAuthorizationAppleIDProvider.credentialState(forUserID:)` 호출에 사용.
    /// 백엔드 `/auth/apple` 와 `/auth/me` 응답이 `apple_user_id` 키로 전달한다.
    /// legacy 세션(키 없음)도 디코드 가능하도록 옵셔널.
    var appleUserId: String? = nil
    var dynamicPromptSettings: DynamicPromptSettings? = nil
    /// 계정 탈퇴 유예 상태. `"active"` | `"pending_deletion"`.
    /// 백엔드 `/auth/me` 가 `deletion_status` 키로 전달한다. legacy 세션(키 없음)
    /// 호환을 위해 기본값 `"active"`. Android `AuthApi.kt:53`.
    var deletionStatus: String = "active"

    /// 30일 유예 탈퇴 진행 중인지. RootView 게이팅에 사용. Android `pendingDeletion`.
    var isPendingDeletion: Bool { deletionStatus == "pending_deletion" }

    init(
        id: String,
        email: String,
        name: String = "",
        plan: String = "free",
        allowFamilyAlarms: Bool? = nil,
        familyAlarmQuietDays: [Int]? = nil,
        familyAlarmQuietStart: String? = nil,
        familyAlarmQuietEnd: String? = nil,
        familyAlarmQuietWindows: [FamilyAlarmQuietWindow]? = nil,
        appleUserId: String? = nil,
        dynamicPromptSettings: DynamicPromptSettings? = nil,
        deletionStatus: String = "active"
    ) {
        let legacyDays = Self.normalizedQuietDays(familyAlarmQuietDays)
        let legacyStart = Self.normalizedQuietTime(familyAlarmQuietStart, fallback: "09:00")
        let legacyEnd = Self.normalizedQuietTime(familyAlarmQuietEnd, fallback: "18:30")
        let fallbackWindow = FamilyAlarmQuietWindow(days: legacyDays, start: legacyStart, end: legacyEnd)
        let quietWindows = Self.normalizedQuietWindows(familyAlarmQuietWindows, fallback: fallbackWindow)
        let firstWindow = quietWindows.first ?? fallbackWindow

        self.id = id
        self.email = email
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.plan = Self.normalizedPlan(plan)
        self.allowFamilyAlarms = allowFamilyAlarms ?? false
        self.familyAlarmQuietDays = firstWindow.days
        self.familyAlarmQuietStart = firstWindow.start
        self.familyAlarmQuietEnd = firstWindow.end
        self.familyAlarmQuietWindows = quietWindows
        self.appleUserId = (appleUserId).nilIfBlank
        self.dynamicPromptSettings = dynamicPromptSettings ?? .empty
        let trimmedDeletion = deletionStatus.trimmingCharacters(in: .whitespacesAndNewlines)
        self.deletionStatus = trimmedDeletion.isEmpty ? "active" : trimmedDeletion
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case email
        case name
        case plan
        case allowFamilyAlarms
        case familyAlarmQuietDays
        case familyAlarmQuietStart
        case familyAlarmQuietEnd
        case familyAlarmQuietWindows
        case appleUserId
        case dynamicPromptSettings
        case deletionStatus
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decode(String.self, forKey: .id),
            email: try container.decode(String.self, forKey: .email),
            name: try container.decodeIfPresent(String.self, forKey: .name) ?? "",
            plan: try container.decodeIfPresent(String.self, forKey: .plan) ?? "free",
            allowFamilyAlarms: try container.decodeIfPresent(Bool.self, forKey: .allowFamilyAlarms),
            familyAlarmQuietDays: try container.decodeIfPresent([Int].self, forKey: .familyAlarmQuietDays),
            familyAlarmQuietStart: try container.decodeIfPresent(String.self, forKey: .familyAlarmQuietStart),
            familyAlarmQuietEnd: try container.decodeIfPresent(String.self, forKey: .familyAlarmQuietEnd),
            familyAlarmQuietWindows: try container.decodeIfPresent([FamilyAlarmQuietWindow].self, forKey: .familyAlarmQuietWindows),
            appleUserId: try container.decodeIfPresent(String.self, forKey: .appleUserId),
            dynamicPromptSettings: try container.decodeIfPresent(DynamicPromptSettings.self, forKey: .dynamicPromptSettings),
            deletionStatus: try container.decodeIfPresent(String.self, forKey: .deletionStatus) ?? "active"
        )
    }

    private static func normalizedPlan(_ value: String?) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "free" : trimmed
    }

    private static func normalizedQuietDays(_ days: [Int]?) -> [Int] {
        let normalized = Array(Set(days?.filter { (0...6).contains($0) } ?? [])).sorted()
        return normalized.isEmpty ? [1, 2, 3, 4, 5] : normalized
    }

    private static func normalizedQuietTime(_ value: String?, fallback: String) -> String {
        guard let value, value.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil else {
            return fallback
        }
        return value
    }

    private static func normalizedQuietWindows(
        _ windows: [FamilyAlarmQuietWindow]?,
        fallback: FamilyAlarmQuietWindow
    ) -> [FamilyAlarmQuietWindow] {
        guard let windows else { return [fallback] }
        let normalized = windows.compactMap { window -> FamilyAlarmQuietWindow? in
            let days = Array(Set(window.days.filter { (0...6).contains($0) })).sorted()
            guard !days.isEmpty else { return nil }
            guard window.start.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil,
                  window.end.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil else {
                return nil
            }
            return FamilyAlarmQuietWindow(days: days, start: window.start, end: window.end)
        }
        return Array(normalized.prefix(8))
    }

}

struct RemoteAlarmListResponse: Decodable {
    var alarms: [RemoteAlarm]
}

struct RemoteAlarmResponse: Decodable {
    var alarm: RemoteAlarm
}

struct RemoteAlarm: Codable, Identifiable, Equatable {
    var id: String
    var time: String?
    var repeatDays: [Int]?
    var isActive: Bool?
    var snoozeMinutes: Int?
    var mode: String?
    var vibrationPattern: String?
    var wakeMode: String?
    var voiceProfileId: String?
    var messageId: String?
    var messageText: String?
    var category: String?
    var messageAudioUrl: String?
    var targetUserId: String?
    var senderUserId: String?
    var senderName: String?
    var senderEmail: String?
    var isFamilyAlarm: Bool?
    var isReceivedFamilyAlarm: Bool?
}

struct RemoteAlarmWriteRequest: Encodable {
    var time: String
    var repeatDays: [Int]
    var snoozeMinutes: Int
    var mode: String
    var vibrationPattern: String
    var wakeMode: String
    var isActive: Bool?
    var messageId: String?
    var voiceProfileId: String?
    var targetUserId: String?
    /// 고른 무료 테마. 서버 `alarms.bucket_id` — 안드로이드도 같은 키로 보낸다.
    /// 서버가 값을 검증하므로(`alarm-helpers.ts` 의 `INVALID_BUCKET_ID`) 아무 문자열이나
    /// 넣으면 400 이 난다.
    var bucketId: String?
    /// 기기 타임존 식별자 (예: "Asia/Seoul"). 서버가 사용자 로컬 시각 기준으로
    /// 알람을 해석할 수 있도록 생성/수정 페이로드에 항상 동봉한다.
    var timezone: String? = TimeZone.current.identifier
}

struct VoiceProfileListResponse: Decodable {
    var profiles: [VoiceProfile]
}

struct VoiceProfileResponse: Decodable {
    var profile: VoiceProfile
}

struct VoiceProfile: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var status: String?
    var createdAt: String?
    var isShared: Bool?
    /// 시스템/스톡 보이스 여부. 서버가 `GET /voice` 의 모든 row 에 `is_system`
    /// 으로 실어 보낸다(voice-profile.ts:218). 무료 등급의 스톡 클립 노출 판정에
    /// 사용. legacy 응답(키 없음) 호환을 위해 옵셔널이며, prefix 기반
    /// `isSystemVoiceId(_:)` 가 폴백이다. Android `VoiceProfile.isSystem` 미러.
    var isSystem: Bool? = nil
    /// 작성 중 임시 프로필 여부. promote 하기 전엔 알람 선택에 노출하지 않는다.
    /// Android `VoiceProfileApi.kt:72`.
    var isDraft: Bool? = nil
    /// 공유 음성을 받은 사람이 음성 주인과의 관계를 기록한 라벨.
    /// (예: "엄마", "할머니"). Android `VoiceProfileApi.kt:73`.
    var relationshipLabel: String? = nil
    /// 공유 음성이 viewer 를 부를 때 쓰는 호칭(예: "지호야").
    /// Android `VoiceProfileApi.kt:74`.
    var listenerTitle: String? = nil
    /// 말투 분석 상태(`ready` / `failed` / nil). 서버가 `GET /voice-profile` 에 실어 보낸다
    /// (`voice-profile.ts` 의 `speech_style_status`).
    ///
    /// ⚠ **`failed` 를 화면에 드러내야 한다.** 분석이 실패하면 그 목소리는 말투 없이
    /// 밋밋하게 읽는데, iOS 는 상태를 디코딩조차 안 해서 사용자가 **실패한 줄도 모르고
    /// 다시 시도할 수도 없었다**(서버에는 `/:id/speech-style/retry` 가 있다).
    /// 안드로이드는 `voicesr_speech_style_failed` + `_retry` 행을 그린다.
    var speechStyleStatus: String? = nil
}

/// `PATCH voice/{id}` 로 초안을 승격할 때만 쓰는 최소 바디.
///
/// ⚠ **이름·관계·호칭을 함께 보내지 말 것.** 정식 프로필이 된 뒤 관계·호칭을 보내면
/// 서버가 409 `VOICE_PERSONA_LOCKED` 로 거절한다(`voice-profile.ts:733-741`).
struct VoiceDraftPromoteRequest: Encodable {
    var isDraft: Bool
}

struct VoicePreviewPlayedRequest: Encodable {
    var previewPlaybackToken: String
}

struct VoicePreviewTextUpdateRequest: Encodable {
    var previewText: String
}

/// `GET voice/{id}/prerender-status` — 유료 클론 사전렌더 진행 상태.
struct VoicePrerenderStatus: Decodable, Equatable {
    /// "pending" | "done" | "failed" | "none"("none" = 큐 행이 없음 → retry 로 재적재 가능)
    var status: String?
    var total: Int
    var generated: Int
    var attempts: Int
}

/// `POST voice/{id}/prerender/advance` — 호출당 최대 3클립 전진.
struct VoicePrerenderAdvance: Decodable, Equatable {
    var done: Bool
    var generated: Int
    var total: Int
}

struct VoiceProfileUpdateRequest: Encodable {
    var name: String?
    var isShared: Bool?
    var relationshipLabel: String?
    var listenerTitle: String?

    init(
        name: String? = nil,
        isShared: Bool? = nil,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil,
    ) {
        self.name = name
        self.isShared = isShared
        self.relationshipLabel = relationshipLabel
        self.listenerTitle = listenerTitle
    }
}

/// `PATCH /voice/:id/relationship` 의 body. 공유받은 음성 viewer 가 자신의
/// 관계/호칭을 등록할 때 사용. 두 값 모두 필수.
/// Android `VoiceProfileApi.kt:61-64`.
struct VoiceProfileRelationshipUpdateRequest: Encodable {
    var relationshipLabel: String
    var listenerTitle: String
}

/// 이번 달(KST) 목소리 쿼터. Android `VoiceDraftQuotaResponse` 미러.
///
/// ⚠ **두 쿼터가 한 응답에 들어 있고 뜻이 다르다.**
///  - `limit`/`used`/`remaining` : 초안(draft) 재시도 여유. iOS 는 draft 플로우가 없어 쓰지 않는다.
///    제한 해제 후 호환용으로 `remaining` 이 0 고정이라, 이걸로 판정하면 **이번 달 등록이
///    남아 있어도** 소진으로 읽힌다.
///  - `registration*` : **정식 등록** 쿼터(한 달에 1개). 화면 표시와 삭제 경고는 이쪽이다.
struct VoiceDraftQuotaResponse: Decodable, Equatable {
    var limit: Int = 0
    var used: Int = 0
    var remaining: Int = 0
    var registrationLimit: Int = 0
    var registrationUsed: Int = 0
    var registrationRemaining: Int = 0
}

struct VoiceUploadResponse: Decodable {
    var upload: VoiceUpload
}

struct VoiceUpload: Decodable, Identifiable, Equatable {
    var id: String
    var mimeType: String?
    var durationMs: Int?
    var originalName: String?
    var createdAt: String?
}

struct TtsGenerateRequest: Encodable {
    var voiceProfileId: String
    var text: String
    var category: String
    var language: String
    var translate: Bool
    var random: Bool
    /// 랜덤 프롬프트 컨텍스트 (preset / wake_weather / wake_fortune / meal /
    /// sleep / exercise / love). Android `TtsApi.kt:17` 참고.
    var randomContext: String?
    /// 알람이 울릴 시각 (랜덤 프롬프트에 시간 컨텍스트 제공).
    var alarmHour: Int?
    var alarmMinute: Int?
    /// 날씨 랜덤 프롬프트용 위치.
    var weatherCountry: String?
    var weatherCity: String?
    /// 운세 랜덤 프롬프트용 사주.
    var fortuneGender: String?
    var fortuneBirthDate: String?
    var fortuneBirthTime: String?
    /// Family/member alarm TTS target. Android `TtsApi.kt` sends `target_user_id`.
    var targetUserId: String?
    /// 공유 음성 viewer 가 자신을 부를 호칭.
    var listenerTitle: String?
    /// 등록 확인 스텝의 미리듣기 합성인가. 서버가 이때만 `preview_playback_token` 을
    /// 함께 내려주고, 그 토큰을 `preview-played` 로 돌려줘야 초안 승격이 허용된다.
    var draftPreview: Bool?

    init(
        voiceProfileId: String,
        text: String,
        category: String,
        language: String,
        translate: Bool,
        random: Bool,
        randomContext: String? = nil,
        alarmHour: Int? = nil,
        alarmMinute: Int? = nil,
        weatherCountry: String? = nil,
        weatherCity: String? = nil,
        fortuneGender: String? = nil,
        fortuneBirthDate: String? = nil,
        fortuneBirthTime: String? = nil,
        listenerTitle: String? = nil,
        targetUserId: String? = nil,
        draftPreview: Bool? = nil
    ) {
        self.voiceProfileId = voiceProfileId
        self.text = text
        self.category = category
        self.language = language
        self.translate = translate
        self.random = random
        self.randomContext = randomContext
        self.alarmHour = alarmHour
        self.alarmMinute = alarmMinute
        self.weatherCountry = weatherCountry
        self.weatherCity = weatherCity
        self.fortuneGender = fortuneGender
        self.fortuneBirthDate = fortuneBirthDate
        self.fortuneBirthTime = fortuneBirthTime
        self.listenerTitle = listenerTitle
        self.targetUserId = targetUserId
        self.draftPreview = draftPreview
    }
}

struct TtsGenerateResponse: Decodable, Equatable {
    var messageId: String
    var audioBase64: String
    var audioFormat: String
    var audioUrl: String?
    var audioObjectKey: String?
    var text: String
    var voiceProfileId: String
    var cacheKey: String?
    var cacheHit: Bool?
    var provider: String?
    /// 랜덤 프롬프트가 사용된 경우, 백엔드가 선택한 실제 컨텍스트(다양화/감사 용).
    /// Android `TtsApi.kt:39`.
    var randomContext: String?
    /// 초안 미리듣기 합성일 때만 온다. 재생을 **끝까지** 마친 뒤 `preview-played` 로
    /// 돌려주면 서버가 청취를 기록하고 승격이 열린다.
    var previewPlaybackToken: String?
    /// 서버가 이미 청취를 기록해 둔 경우(재합성 등) `true`.
    var previewPlaybackConfirmed: Bool?
}

extension TtsGenerateResponse {
    var remoteAudioURI: String? {
        if let trimmed = audioUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty {
            return trimmed
        }
        guard let key = audioObjectKey?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else {
            return nil
        }
        let lower = key.lowercased()
        if lower.hasPrefix("r2://") || lower.hasPrefix("https://") {
            return key
        }
        return "r2://\(key)"
    }
}

struct TtsMessageAudioResponse: Decodable, Equatable {
    var messageId: String
    var audioBase64: String
    var audioFormat: String
    var audioUrl: String?
    var text: String?
    var category: String?
    var voiceProfileId: String?
}

/// `GET /tts/stock-clips` 응답. 무료 등급이 알람 에디터에서 고르는 기본 제공
/// 음성 카탈로그. 서버는 모든 인증 사용자에게 동일한 전역 카탈로그를 준다
/// (tts.ts:1287-1313). 쿼리 파라미터 없음 — 언어 필터는 클라이언트에서 처리한다.
/// Android `TtsApi.kt:70` `StockClipListResponse` 미러.
struct StockClipListResponse: Decodable {
    var clips: [StockClip]
}

/// 기본 제공(스톡) 알람 클립 한 건. preset 메시지 × 시스템 보이스 조합.
/// 인라인 오디오는 없고, 미리듣기/선택 시 `GET /tts/messages/:id/audio` 로
/// 음원을 받아 캐싱한다. Android `TtsApi.kt:74` `StockClip` 미러(`tags` 는 드롭).
/// camelCase 필드는 convertFromSnakeCase 로 snake_case 에서 자동 디코드.
struct StockClip: Decodable, Identifiable, Equatable {
    var messageId: String
    var voiceProfileId: String
    var voiceName: String?
    /// 예: morning/lunch/evening/night/health/medication/study/cheer/love/exercise/greeting.
    /// greeting 은 "이 목소리 들어보기" 샘플 전용이라 에디터 목록에선 제외한다.
    var category: String?
    /// "ko" | "en" | "ja".
    var language: String?
    var text: String
    var audioUrl: String?

    var id: String { messageId }
}

struct FamilyGroupCurrentResponse: Codable, Equatable {
    var group: FamilyGroup?
    var role: String?
    var members: [FamilyGroupMember]
}

struct FamilyGroup: Codable, Identifiable, Equatable {
    var id: String
    var ownerUserId: String
    var planId: String
    var maxMembers: Int
    var createdAt: String
}

struct FamilyGroupMember: Codable, Identifiable, Equatable {
    var id: String
    var userId: String
    var role: String
    var joinedAt: String
    var email: String?
    var name: String?
    var allowFamilyAlarms: Bool?
    var familyAlarmQuietDays: [Int]?
    var familyAlarmQuietStart: String?
    var familyAlarmQuietEnd: String?
    var familyAlarmQuietWindows: [FamilyAlarmQuietWindow]?
    var dynamicPromptSettings: DynamicPromptSettings?
    var dynamicPromptSettingsState: DynamicPromptSettingsState?
}

struct FamilyVoiceProfileListResponse: Decodable {
    var profiles: [FamilyVoiceProfile]
}

struct FamilyVoiceProfile: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var status: String?
    var createdAt: String?
    var userId: String?
    var ownerName: String?
    var isShared: Bool?
    /// 받은 사람이 음성 주인과의 관계로 등록한 라벨.
    var relationshipLabel: String?
    /// 받은 사람을 음성이 부를 호칭.
    var listenerTitle: String?
    /// Server-side flag for shared voices that still need viewer-specific labels.
    var needsViewerInfo: Bool?
}

extension FamilyVoiceProfile {
    var requiresViewerInfo: Bool {
        needsViewerInfo == true ||
            (relationshipLabel?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) ||
            (listenerTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    }

    var sharedFromLabel: String {
        let owner = ownerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return owner.isEmpty ? "공유받은 목소리" : "\(owner)님에게 공유받은 목소리"
    }
}

struct CodeRegisterRequest: Encodable {
    var code: String
}

struct CodeRegisterResponse: Decodable, Equatable {
    var success: Bool
    var type: String?
}

struct BillingSubscriptionResponse: Codable, Equatable {
    var subscription: BillingSubscription?
    var plan: BillingPlan?
    var nextPlan: BillingPlanSummary?
}

struct BillingSubscription: Codable, Identifiable, Equatable {
    var id: String
    var planId: String
    var planGroupId: String?
    var status: String
    var startsAt: String
    var expiresAt: String
    var cancelAtPeriodEnd: Bool?
    var canceledAt: String?
    var nextPlanId: String?
}

struct BillingPlan: Codable, Identifiable, Equatable {
    var id: String
    var key: String
    var name: String
    var planType: String
    var periodDays: Int
    var maxMembers: Int
    var priceKrw: Int
}

struct BillingPlanSummary: Codable, Identifiable, Equatable {
    var id: String
    var key: String
    var name: String
    var planType: String
}

struct VoucherListResponse: Decodable {
    var vouchers: [VoucherItem]
}

struct VoucherItem: Decodable, Identifiable, Equatable {
    var id: String
    var code: String
    var planKey: String?
    var planName: String
    var planType: String
    var status: String
    var issuedAt: String?
    var expiresAt: String
    var maxUses: Int?
    var useCount: Int?
}

// ⚠ **`/checkout` 요청·응답 모델을 되살리지 말 것**(2026-08-07 삭제).
// iOS 결제는 **StoreKit** 을 거친다 — 서버 `/billing/checkout` 은 안드로이드(구글 결제)
// 전용이고, iOS 에는 그 라우트를 부르는 코드가 없어 모델만 남아 있었다.
// (`CheckoutVoucher` 는 다른 응답이 쓰므로 남긴다.)

struct CheckoutVoucher: Decodable, Identifiable, Equatable {
    var id: String
    var code: String
    var expiresAt: String
    var maxUses: Int?
    var useCount: Int?
}

struct EnsureFamilyShareCodeResponse: Decodable, Equatable {
    var success: Bool
    var voucher: VoucherItem
}

/// Backend/Android billing mode contract: `immediate` or `at_period_end`.
struct CancelSubscriptionRequest: Encodable {
    var mode: String
}

struct CancelSubscriptionResponse: Decodable, Equatable {
    var success: Bool
    var mode: String
    var subscriptionId: String?
}

struct UpdateProfileRequest: Encodable {
    var name: String?
    var allowFamilyAlarms: Bool?
    var familyAlarmQuietDays: [Int]?
    var familyAlarmQuietStart: String?
    var familyAlarmQuietEnd: String?
    var familyAlarmQuietWindows: [FamilyAlarmQuietWindow]?
    var dynamicPromptSettings: DynamicPromptSettings?
}

struct UpdateProfileResponse: Decodable, Equatable {
    var success: Bool
    var name: String?
    var allowFamilyAlarms: Bool?
    var familyAlarmQuietDays: [Int]?
    var familyAlarmQuietStart: String?
    var familyAlarmQuietEnd: String?
    var familyAlarmQuietWindows: [FamilyAlarmQuietWindow]?
    var dynamicPromptSettings: DynamicPromptSettings?
}

struct DeleteAccountResponse: Decodable, Equatable {
    var success: Bool
}

/// 30일 유예 탈퇴 신청 응답. Android `AuthApi.kt:125` `AccountDeletionResponse`.
struct AccountDeletionResponse: Decodable, Equatable {
    var success: Bool = false
    var status: String = "pending_deletion"
}

/// 유예 탈퇴 철회(복구) 응답. Android `AuthApi.kt:132` `CancelDeletionResponse`.
struct CancelDeletionResponse: Decodable, Equatable {
    var success: Bool = false
    var status: String = "active"
}

/// 약관 동의 항목 1건. Android `AuthApi.kt:137` `ConsentItemRequest`.
struct ConsentItemRequest: Encodable, Equatable {
    var type: String
    var agreed: Bool
    var version: String? = nil
}

/// `GET /alarm/declined` 응답.
///
/// 목록(`GET /alarm`)은 그만받기 한 알람을 아예 빼서 내려주므로, 클라는 "목록에서 사라짐" 의
/// 이유를 구분할 수 없다 — **수신자가 그만받기** 했는지, **발신자가 지웠**는지.
/// 그 둘은 결과가 **정반대**여야 하므로 서버가 따로 알려 준다:
///
///  - `alarmIds`(declined): 수신자가 그만받기 → **알람을 지운다**(이 계정의 다른 기기에서도).
///  - `revokedAlarmIds`(revoked): 발신자 탈퇴/철회 → **목소리만 걷어내고 알람은 남긴다.**
///    복제 목소리는 그 사람의 생체정보라 파기 대상이지만, 시각은 수신자가 기대고 자는
///    자기 정보다 — 통째로 지우면 그날 못 일어난다.
///
/// ⚠ 페이지네이션은 두 배열을 **한 페이지에 섞어** 내려준다. 다음 offset 은 **둘의 합**만큼
/// 전진시켜야 한다(한쪽 크기로 전진하면 같은 행을 다시 읽거나 건너뛴다).
struct DeclinedAlarmsResponse: Decodable, Equatable {
    var alarmIds: [String] = []
    var revokedAlarmIds: [String] = []
    var hasMore: Bool = false
}

/// 약관 동의 기록 요청. Android `AuthApi.kt:143` `RecordConsentsRequest`.
///
/// `documentVersion` 은 **이 빌드가 담고 있는 법무 문서의 버전**이다(snake_case 로 나간다).
/// 서버는 이 값이 없으면 400 `DOCUMENT_VERSION_REQUIRED`, 자기가 게시 중인 버전과 다르면
/// 409 `POLICY_VERSION_MISMATCH` 로 거부한다 — "무엇에 동의했는지" 를 증명하지 못하는
/// 기록은 받아 줄 수 없기 때문이다.
struct RecordConsentsRequest: Encodable, Equatable {
    var consents: [ConsentItemRequest]
    /// 기본값은 빌드 시 `docs/legal` 에서 뽑은 값(`scripts/generate-legal-version.sh`).
    var documentVersion: String = LegalPolicy.bundledVersion
}

/// 약관 동의 기록 응답. Android `AuthApi.kt:147` `RecordConsentsResponse`.
struct RecordConsentsResponse: Decodable, Equatable {
    var success: Bool = false
    var recorded: Int = 0
}

/// 약관 동의 상태 응답 (`GET /user/consents/status`).
///
/// ⚠ **`needsConsent` 와 `needsCollection` 은 뜻이 다르다 — 섞어 쓰면 안 된다.**
///  - `needsConsent`: **앱을 못 쓰게 막는 게이트** 신호(필수 유형 기준). 선택 동의 때문에
///    앱이 잠기면 안 되므로 여기에는 marketing 이 절대 들어가지 않는다.
///  - `needsCollection`: **동의 화면을 한 번 띄워 물어봐야 한다**는 신호. 선택 유형만
///    재수집 대상일 때도 true 다. 이걸 안 보면, 개정이 marketing 최소버전만 올렸을 때
///    화면이 영영 안 떠 재수집이 일어나지 않는다.
struct ConsentStatusResponse: Decodable, Equatable {
    var needsConsent: Bool = false
    var needsCollection: Bool = false
    var required: [String] = []
    var missing: [String] = []
    /// **이번 화면에서 받아야 하는 유형.** 이미 유효한 동의는 담기지 않는다 —
    /// 개정 때 필요한 것만 다시 묻고, 묻지 않은 항목의 기존 선택(특히 마케팅 수신)은
    /// 그대로 살아남는다. 화면은 이 목록에 든 것만 그리고, 제출도 이 목록으로만 한다.
    var collect: [String] = []
    /// `collect` 중 **체크 없이 통과**하는 유형(선택 동의). 화면이 목록을 따로 들고 있으면
    /// 서버가 필수/선택을 바꿀 때 조용히 어긋난다.
    var optional: [String] = []
    /// `collect` 중 **이미 동의해 둔** 유형. 화면의 **초기 체크 상태**로 쓴다.
    ///
    /// ⚠ 이걸 안 쓰면 이미 동의한 사용자가 화면을 그냥 지나가는 순간 그 동의가 `false` 로
    /// 뒤집힌다 — 아무것도 바꾼 적이 없는데 목소리 기능이 막히고 마케팅 동의가 사라진다.
    /// **가진 것을 보여주는 것**이지 미리 눌러 주는 게 아니다(필수 유형은 서버가 담지 않는다).
    var prechecked: [String] = []
    /// 음성 라우트가 요구하는 민감 동의 중 아직 없는 것. 가입 때 `voice_biometric` 을
    /// 거절한 사람만 남는다 — 목소리 등록 화면에서 인라인으로 다시 묻는 근거다.
    var sensitiveMissing: [String] = []
    /// 이 계정에 동의 기록이 하나라도 있으면 '개정에 따른 재동의' 다.
    /// 처음 가입한 사람과 문구가 달라야 한다.
    var hasPriorConsent: Bool = false
    var policyVersion: String = "1"
}

/// 앱 최소지원버전 정책 응답. Android `AuthApi.kt:159` `AppVersionResponse`.
struct AppVersionResponse: Decodable, Equatable {
    var platform: String = "ios"
    var minSupportedVersion: Int = 1
    var storeUrl: String = ""
}

// MARK: - 이메일/비밀번호 + 인증코드 + 멤버/Family 액션 + 바우처

struct RequestEmailVerificationRequest: Encodable {
    var email: String
}

struct RequestEmailVerificationResponse: Decodable, Equatable {
    var success: Bool
    /// 디버그(dev) 환경에서 서버가 바로 코드를 돌려보내는 경우가 있어 옵셔널로 둔다.
    /// 백엔드는 `debug_code` 키로 보낸다(auth.ts:190/301). convertFromSnakeCase 로
    /// `debugCode` 에 매핑된다. Android `AuthApi.kt:84`.
    var debugCode: String?
}

struct VerifyEmailCodeRequest: Encodable {
    var email: String
    var code: String
}

struct VerifyEmailCodeResponse: Decodable, Equatable {
    var success: Bool
    var verified: Bool?
}

struct EmailRegisterRequest: Encodable {
    var email: String
    var password: String
    var name: String
    var emailVerificationCode: String
}

struct EmailLoginRequest: Encodable {
    var email: String
    var password: String
}

// MARK: - 비밀번호 재설정 (POST auth/password-reset, auth/password-reset/confirm)
// Android `AuthApi.kt:96-104`, 백엔드 auth.ts:280/359, shared `PasswordReset*Schema`.

/// 재설정 코드 발송 요청. 응답은 이메일 인증과 동일한 `RequestEmailVerificationResponse`.
/// Android `PasswordResetRequest`.
struct PasswordResetRequest: Encodable {
    var email: String
}

/// 재설정 확정 — 코드 검증 후 새 비밀번호로 교체. 비밀번호는 8~128자 + 영문 + 숫자
/// (shared `PasswordSchema`). Android `PasswordResetConfirmRequest`.
struct PasswordResetConfirmRequest: Encodable {
    var email: String
    var code: String
    var password: String
}

/// 재설정 확정 응답. 백엔드는 `{ success }` 만 돌려준다(auth.ts:406).
/// Android `EmailVerificationConfirmResponse`.
struct PasswordResetConfirmResponse: Decodable, Equatable {
    var success: Bool
}

// MARK: - 동의 목록 (GET user/consents)
// Android `AuthApi.kt:166-175`, 백엔드 user.ts:401-431.

/// 동의 기록 1건(유형별 최신값). 백엔드는 snake_case 로 보내며 decoder 의
/// convertFromSnakeCase 로 camelCase 에 매핑된다. Android `ConsentRecord`.
struct ConsentRecord: Decodable, Equatable {
    var consentType: String
    var policyVersion: String
    var agreed: Bool
    /// 동의한 시각(UTC, "2026-07-06 04:12:33"). 동의 내역 화면이 날짜로 보여준다.
    /// 서버 `user.ts:453` 가 항상 실어 보내지만 옛 응답 호환으로 옵셔널.
    var agreedAt: String?
}

/// `GET user/consents` 응답. 유형별 최신 동의값 목록. Android `ConsentListResponse`.
struct ConsentListResponse: Decodable, Equatable {
    var consents: [ConsentRecord]
}

struct FamilyAlarmTalkRequest: Encodable {
    var recipientUserId: String
    var wakeAt: String
    var voiceUploadId: String
    var label: String?
    var dubTargetLanguage: String?
    var repeatDays: [Int]
}

struct FamilyAlarmTalkResponse: Decodable, Equatable {
    var alarm: RemoteAlarm
}


// MARK: - Phase 4-D1: Apple StoreKit2 IAP confirmation

/// Apple StoreKit 영수증 검증을 백엔드에 위임하기 위한 페이로드.
///
/// `POST /api/billing/apple/confirm` 요청.
///
/// **보내는 것은 `transaction_id` 하나뿐이다.** 서버는 그 id 로 App Store Server API 에
/// **직접 물어서** 상품·만료·환불 여부를 확인한다(`routes/billing-apple.ts`).
/// 클라가 주장하는 상품/원본 트랜잭션/JWS 를 믿지 않는 것이 요점이라, 보내 봐야
/// 서버가 읽지 않는다 — 읽지 않는 값을 보내면 "서버가 이걸 본다" 는 오해만 남는다.
struct ConfirmAppleSubscriptionRequest: Encodable {
    var transactionId: String
}

/// `POST /api/billing/apple/confirm` 성공 응답.
/// `{ success: true, plan_key: string, subscription: {...} }` 형태.
/// 서버 구성값(APPLE_*)이 없으면 503 이라 본 디코드에 도달하지 않는다.
struct ConfirmAppleSubscriptionResponse: Decodable, Equatable {
    /// 서버 측 검증 + entitlement upsert 성공 여부.
    var success: Bool
    /// 백엔드 plan key (`personal` / `couple` / `family`).
    var planKey: String?
    /// 백엔드가 upsert 한 subscriptions row. 부분 응답 환경에서는 nil.
    var subscription: BillingSubscription?

    private enum CodingKeys: String, CodingKey {
        case success
        case planKey
        case subscription
    }

    /// 서버 스키마가 확정되기 전이므로 부분 필드 누락/형식 차이에도 디코드가
    /// 통째로 실패하지 않도록 관대하게 읽는다. `success` 만 신뢰 기준으로 사용.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = (try? container.decodeIfPresent(Bool.self, forKey: .success)) ?? false
        planKey = try? container.decodeIfPresent(String.self, forKey: .planKey)
        subscription = try? container.decodeIfPresent(BillingSubscription.self, forKey: .subscription)
    }

    init(success: Bool, planKey: String? = nil, subscription: BillingSubscription? = nil) {
        self.success = success
        self.planKey = planKey
        self.subscription = subscription
    }
}

/// `GET /tts/manual-quota` — 이번 달 직접 입력 문구 생성 여유.
/// 안드로이드 `ManualQuotaResponse` 미러. `limit == 0` 이면 표시하지 않는다.
struct ManualQuotaResponse: Decodable, Equatable {
    var planKey: String?
    var limit: Int
    var used: Int
    var remaining: Int
}
