import Foundation

struct AuthSession: Codable, Equatable {
    var token: String
    var user: AuthUser
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
            country: Self.clean(weather.country),
            city: Self.clean(weather.city)
        )
        self.fortune = DynamicPromptFortuneSettings(
            gender: Self.clean(fortune.gender),
            birthDate: Self.clean(fortune.birthDate),
            birthTime: Self.clean(fortune.birthTime)
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

    private static func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
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

    private static let defaultsKey = "dynamic_prompt_preferences"

    static func from(settings: DynamicPromptSettings?) -> DynamicPromptPreferences {
        DynamicPromptPreferences(
            weatherCountry: settings?.weather.country?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            weatherCity: settings?.weather.city?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            fortuneGender: settings?.fortune.gender?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            fortuneBirthDate: settings?.fortune.birthDate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            fortuneBirthTime: settings?.fortune.birthTime?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        )
    }

    static func loadFromDefaults() -> DynamicPromptPreferences {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let decoded = try? JSONDecoder().decode(DynamicPromptPreferences.self, from: data) else {
            return DynamicPromptPreferences()
        }
        return decoded.normalized()
    }

    func saveToDefaults() {
        guard let data = try? JSONEncoder().encode(normalized()) else { return }
        UserDefaults.standard.set(data, forKey: Self.defaultsKey)
    }

    func toSettings() -> DynamicPromptSettings {
        DynamicPromptSettings(
            weather: DynamicPromptWeatherSettings(
                country: clean(weatherCountry),
                city: clean(weatherCity)
            ),
            fortune: DynamicPromptFortuneSettings(
                gender: clean(fortuneGender),
                birthDate: clean(fortuneBirthDate),
                birthTime: clean(fortuneBirthTime)
            )
        )
    }

    var weatherReady: Bool {
        clean(weatherCountry) != nil && clean(weatherCity) != nil
    }

    var fortuneReady: Bool {
        clean(fortuneGender) != nil &&
            clean(fortuneBirthDate) != nil &&
            clean(fortuneBirthTime) != nil
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

    private func clean(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
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
        dynamicPromptSettings: DynamicPromptSettings? = nil
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
        self.appleUserId = Self.clean(appleUserId)
        self.dynamicPromptSettings = dynamicPromptSettings ?? .empty
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
            dynamicPromptSettings: try container.decodeIfPresent(DynamicPromptSettings.self, forKey: .dynamicPromptSettings)
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

    private static func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
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
    var speakerId: String?
    var messageId: String?
    var messageText: String?
    var category: String?
    var rawAudioUrl: String?
    var messageAudioUrl: String?
    var rawAudioDurationMs: Int?
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
    var rawAudioUrl: String?
    var rawAudioDurationMs: Int?
    var targetUserId: String?
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
    /// 작성 중 임시 프로필 여부. promote 하기 전엔 알람 선택에 노출하지 않는다.
    /// Android `VoiceProfileApi.kt:72`.
    var isDraft: Bool? = nil
    /// 공유 음성을 받은 사람이 음성 주인과의 관계를 기록한 라벨.
    /// (예: "엄마", "할머니"). Android `VoiceProfileApi.kt:73`.
    var relationshipLabel: String? = nil
    /// 공유 음성이 viewer 를 부를 때 쓰는 호칭(예: "지호야").
    /// Android `VoiceProfileApi.kt:74`.
    var listenerTitle: String? = nil
}

struct VoiceProfileUpdateRequest: Encodable {
    var name: String?
    var isShared: Bool?
    /// promote 시 false 로 명시 전송.
    var isDraft: Bool?
    var relationshipLabel: String?
    var listenerTitle: String?

    init(
        name: String? = nil,
        isShared: Bool? = nil,
        isDraft: Bool? = nil,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil
    ) {
        self.name = name
        self.isShared = isShared
        self.isDraft = isDraft
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

struct VoiceUploadResponse: Decodable {
    var upload: VoiceUpload
}

struct VoiceUpload: Decodable, Identifiable, Equatable {
    var id: String
    var objectKey: String?
    var mimeType: String?
    var sizeBytes: Int?
    var durationMs: Int?
    var originalName: String?
    var createdAt: String?
}

struct VoiceSpeakerListResponse: Decodable {
    var speakers: [VoiceSpeakerSegment]
    var provider: String?
}

struct VoiceSpeakerSegment: Decodable, Identifiable, Equatable {
    var id: String
    var uploadId: String?
    var label: String
    var startMs: Int
    var endMs: Int
    var confidence: Double?

    /// 화자 구간 길이(ms). 음수 방지.
    var durationMs: Int { max(0, endMs - startMs) }

    /// 사람이 읽을 시간 라벨. (`mm:ss`)
    var durationLabel: String {
        let totalSeconds = max(0, durationMs / 1000)
        return String(format: "%d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

/// 업로드된 raw 음원 + 분리된 화자 list 한 묶음. SpeakerSeparationFlow 가 사용.
struct VoiceUploadSpeakersResponse: Decodable, Equatable {
    var uploadId: String
    var speakers: [VoiceSpeakerSegment]
    var provider: String?
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
        targetUserId: String? = nil
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
        if lower.hasPrefix("r2://") || lower.hasPrefix("https://") || lower.hasPrefix("http://") {
            return key
        }
        return "r2://\(key)"
    }
}

struct TtsMessageListResponse: Decodable {
    var messages: [TtsMessage]
    var total: Int?
    var limit: Int?
    var offset: Int?
}

struct TtsMessage: Decodable, Identifiable, Equatable {
    var id: String
    var text: String
    var category: String?
    var audioUrl: String?
    var voiceProfileId: String?
    var voiceName: String?
    var createdAt: String?
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

struct NoteListResponse: Decodable {
    var notes: [ReceivedNote]
    var total: Int?
    var limit: Int?
    var offset: Int?
}

struct ReceivedNote: Decodable, Identifiable, Equatable {
    var id: String
    var senderId: String
    var senderName: String?
    var senderEmail: String?
    var senderPicture: String?
    var text: String
    var audioUrl: String?
    var audioAvailable: Bool?
    var readAt: String?
    var createdAt: String?
}

struct SendNoteRequest: Encodable {
    var receiverId: String
    var text: String
    var audioUrl: String?
}

struct SendNoteResponse: Decodable, Equatable {
    var success: Bool
    var note: ReceivedNote
}

struct MarkNoteReadResponse: Decodable, Equatable {
    var success: Bool
    var alreadyRead: Bool?
    var readAt: String?
}

struct NoteAudioResponse: Decodable, Equatable {
    var noteId: String
    var audioBase64: String
    var audioFormat: String
    var audioUrl: String?
    var text: String
}

struct CharacterResponse: Decodable, Equatable {
    var character: CharacterPayload
    var progress: CharacterProgress
    var streak: CharacterStreak
    var stats: CharacterStats
    var achievements: [StreakAchievement]?
}

struct CharacterPayload: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var level: Int
    var xp: Int
    var affection: Int
    var stage: String
    var dailyXp: Int?
}

struct CharacterProgress: Decodable, Equatable {
    var xpIntoLevel: Int
    var xpToNextLevel: Int
    var levelSpan: Int
    var progressRatio: Double
}

struct CharacterStreak: Decodable, Equatable {
    var current: Int
    var longest: Int
    var lastWakeupDate: String?
}

struct CharacterStats: Decodable, Equatable {
    var diligence: Int
    var health: Int
    var consistency: Int
}

struct StreakAchievement: Decodable, Equatable {
    var milestone: Int
    var bonusXp: Int
    var achievedAt: String
}

struct CharacterXpRequest: Encodable {
    var event: String
    var clientNonce: String
    var localDate: String
}

struct CharacterGrantResponse: Decodable, Equatable {
    var character: CharacterPayload
    var progress: CharacterProgress
    var streak: CharacterStreak
    var stats: CharacterStats
    var achievements: [StreakAchievement]?
    var grant: CharacterGrant
}

struct CharacterGrant: Decodable, Equatable {
    var event: String
    var grantedXp: Int
    var affection: Int
    var capped: Bool
    var remainingCap: Int
    var duplicated: Bool
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

struct CheckoutRequest: Encodable {
    var planKey: String
    var gift: Bool
}

struct CheckoutResponse: Decodable, Equatable {
    var success: Bool
    var checkoutStub: Bool?
    var subscription: BillingSubscription?
    var plan: BillingPlan
    var voucher: CheckoutVoucher?
}

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

struct ChangePlanRequest: Encodable {
    var planKey: String
    var mode: String
}

struct ChangePlanResponse: Decodable, Equatable {
    var success: Bool
    var mode: String
    var subscriptionId: String?
    var requiresCheckout: Bool?
    var planKey: String?
    var nextPlanKey: String?
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

// MARK: - Phase 3-C3: 이메일/비밀번호 + 인증코드 + 멤버/Family 액션 + 바우처 + 검색

struct RequestEmailVerificationRequest: Encodable {
    var email: String
}

struct RequestEmailVerificationResponse: Decodable, Equatable {
    var success: Bool
    /// 디버그 환경에서 서버가 바로 코드를 돌려보내는 경우가 있어 옵셔널로 둔다.
    var devCode: String?
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

struct FamilyVoiceAlarmRequest: Encodable {
    var recipientUserId: String
    var wakeAt: String
    var voiceUploadId: String
    var label: String?
    var dubTargetLanguage: String?
    var repeatDays: [Int]
}

struct FamilyVoiceAlarmResponse: Decodable, Equatable {
    var alarm: RemoteAlarm
}

struct VoucherRedemptionResponse: Decodable, Equatable {
    var success: Bool
    var voucher: VoucherItem?
    var planKey: String?
}

struct UserSearchResult: Decodable, Identifiable, Equatable {
    var id: String
    var email: String?
    var name: String?
    var picture: String?
}

struct UserSearchResponse: Decodable {
    var users: [UserSearchResult]
}

// MARK: - Phase 4-D1: Apple StoreKit2 IAP confirmation

/// Apple StoreKit 영수증 검증을 백엔드에 위임하기 위한 페이로드.
///
/// 백엔드는 Apple 의 verifyReceipt / App Store Server API 를 사용해 transaction
/// 의 진위와 만료일을 확인한 뒤, 자체 `subscriptions` 테이블에 plan key 매핑을
/// 기록한다. 라우트: `POST /api/billing/apple/confirm`.
///
/// 라우트가 미구현이거나 일시적으로 다운된 경우 클라이언트는 graceful
/// degradation — StoreKit 영수증 자체가 권위이므로 currentTier 는 이미 정확.
struct ConfirmAppleSubscriptionRequest: Encodable {
    var transactionId: String
    var originalTransactionId: String
    var productId: String
}

struct ConfirmAppleSubscriptionResponse: Decodable, Equatable {
    /// 백엔드가 발급한 subscriptions row id. 미구현 환경에서는 nil.
    var subscriptionId: String?
    /// 백엔드 plan key (`personal` / `couple` / `family`).
    var plan: String
    /// ISO8601 만료 시각. 백엔드가 Apple 의 expiresDate 를 그대로 echo.
    var expiresAt: String?
}

final class VoiceAlarmAPI {
    static let shared = VoiceAlarmAPI()

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        baseURL: URL = VoiceAlarmAPI.defaultBaseURL(),
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.session = session
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    func loginWithApple(
        idToken: String,
        name: String?,
        email: String?,
        nonce: String?
    ) async throws -> AuthSession {
        struct Body: Encodable {
            var idToken: String
            var name: String?
            var email: String?
            var nonce: String?
        }
        return try await request(
            "auth/apple",
            method: "POST",
            body: Body(
                idToken: idToken,
                name: name.nilIfBlank,
                email: email.nilIfBlank,
                nonce: nonce?.isEmpty == true ? nil : nonce
            )
        )
    }

    func me(token: String) async throws -> AuthUser {
        struct Response: Decodable { var user: AuthUser }
        let response: Response = try await request("auth/me", token: token)
        return response.user
    }

    func listAlarms(token: String) async throws -> [RemoteAlarm] {
        let response: RemoteAlarmListResponse = try await request("alarm", token: token)
        return response.alarms
    }

    func createAlarm(_ requestBody: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm {
        let response: RemoteAlarmResponse = try await request(
            "alarm",
            method: "POST",
            token: token,
            body: requestBody
        )
        return response.alarm
    }

    func updateAlarm(id: String, requestBody: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm {
        let response: RemoteAlarmResponse = try await request(
            "alarm/\(id)",
            method: "PATCH",
            token: token,
            body: requestBody
        )
        return response.alarm
    }

    func deleteAlarm(id: String, token: String) async throws {
        let _: EmptyResponse = try await request("alarm/\(id)", method: "DELETE", token: token)
    }

    func listVoiceProfiles(token: String) async throws -> [VoiceProfile] {
        let response: VoiceProfileListResponse = try await request("voice", token: token)
        return response.profiles
    }

    static func voiceCloneMultipartFields(
        name: String,
        isShared: Bool,
        durationMs: Int,
        noiseRemoval: Bool = false,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil,
        isDraft: Bool? = nil
    ) -> [String: String] {
        var fields: [String: String] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "isShared": isShared ? "true" : "false",
            "durationMs": String(durationMs),
            "relationshipLabel": relationshipLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            "listenerTitle": listenerTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            "isDraft": (isDraft ?? false) ? "true" : "false",
        ]
        if noiseRemoval {
            fields["noiseRemoval"] = "true"
            fields["noise_removal"] = "true"
        }
        return fields
    }

    func cloneVoice(
        audioFileURL: URL,
        name: String,
        isShared: Bool,
        durationMs: Int,
        token: String,
        noiseRemoval: Bool = false,
        uploadFileName: String? = nil,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil,
        isDraft: Bool? = nil
    ) async throws -> VoiceProfile {
        let fields = Self.voiceCloneMultipartFields(
            name: name,
            isShared: isShared,
            durationMs: durationMs,
            noiseRemoval: noiseRemoval,
            relationshipLabel: relationshipLabel,
            listenerTitle: listenerTitle,
            isDraft: isDraft
        )
        // noise_removal 플래그 — `feat/voice-clone-noise-removal` 머지 이후 backend 가
        // 인식하지만, 미인식 환경(이전 deploy)에서도 무시되도록 옵션으로 추가.
        // Android `VoiceProfileApi.kt:97-108` 와 동일하게 multipart 필드로 전송.
        // 관계/호칭이 비어 있어도 필드를 포함해 Android 와 같은 서버 검증 경로를 탄다.
        let response: VoiceProfileResponse = try await multipartRequest(
            "voice/clone",
            token: token,
            fields: fields,
            files: [try multipartFile(fieldName: "audio", fileURL: audioFileURL, fileName: uploadFileName)]
        )
        return response.profile
    }

    func uploadVoiceAudio(
        audioFileURL: URL,
        durationMs: Int,
        originalName: String? = nil,
        token: String
    ) async throws -> VoiceUpload {
        let response: VoiceUploadResponse = try await multipartRequest(
            "voice/upload",
            token: token,
            fields: [
                "durationMs": String(durationMs),
                "originalName": originalName.nilIfBlank ?? audioFileURL.lastPathComponent,
            ],
            files: [try multipartFile(fieldName: "audio", fileURL: audioFileURL)]
        )
        return response.upload
    }

    func separateVoiceUpload(uploadId: String, token: String) async throws -> [VoiceSpeakerSegment] {
        let response: VoiceSpeakerListResponse = try await request(
            "voice/uploads/\(uploadId)/separate",
            method: "POST",
            token: token
        )
        return response.speakers
    }

    /// 업로드된 raw 음원의 화자 분리 결과를 다시 불러온다.
    /// `separate` 가 한 번 실행된 뒤 클라이언트가 재진입했을 때 호출.
    /// `GET /api/voice/uploads/:uploadId/speakers`.
    func getVoiceUploadSpeakers(uploadId: String, token: String) async throws -> VoiceUploadSpeakersResponse {
        let response: VoiceSpeakerListResponse = try await request(
            "voice/uploads/\(uploadId)/speakers",
            token: token
        )
        return VoiceUploadSpeakersResponse(
            uploadId: uploadId,
            speakers: response.speakers,
            provider: response.provider
        )
    }

    /// 화자 라벨 변경 — Android `MainViewModelVoiceActions` 의 rename speaker 와 동일.
    /// `PATCH /api/voice/uploads/:uploadId/speakers/:speakerId`.
    func updateVoiceUploadSpeaker(
        uploadId: String,
        speakerId: String,
        label: String,
        token: String
    ) async throws -> VoiceSpeakerSegment {
        struct Body: Encodable { var label: String }
        struct Response: Decodable { var speaker: VoiceSpeakerSegment }
        let response: Response = try await request(
            "voice/uploads/\(uploadId)/speakers/\(speakerId)",
            method: "PATCH",
            token: token,
            body: Body(label: label)
        )
        return response.speaker
    }

    /// 업로드와 화자 분리를 한 번에 — 라이트한 단발 사용용. `POST /api/voice/diarize`.
    func diarizeVoice(
        audioFileURL: URL,
        durationMs: Int,
        token: String
    ) async throws -> VoiceUploadSpeakersResponse {
        struct Response: Decodable {
            var uploadId: String?
            var speakers: [VoiceSpeakerSegment]
            var provider: String?
        }
        let response: Response = try await multipartRequest(
            "voice/diarize",
            token: token,
            fields: [
                "durationMs": String(durationMs),
            ],
            files: [try multipartFile(fieldName: "audio", fileURL: audioFileURL)]
        )
        return VoiceUploadSpeakersResponse(
            uploadId: response.uploadId ?? "",
            speakers: response.speakers,
            provider: response.provider
        )
    }

    func updateVoiceProfile(
        id: String,
        name: String? = nil,
        isShared: Bool? = nil,
        isDraft: Bool? = nil,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil,
        token: String
    ) async throws -> VoiceProfile {
        let response: VoiceProfileResponse = try await request(
            "voice/\(id)",
            method: "PATCH",
            token: token,
            body: VoiceProfileUpdateRequest(
                name: name.nilIfBlank,
                isShared: isShared,
                isDraft: isDraft,
                relationshipLabel: relationshipLabel?.nilIfBlank,
                listenerTitle: listenerTitle?.nilIfBlank
            )
        )
        return response.profile
    }

    func deleteVoiceProfile(id: String, token: String, force: Bool = false) async throws {
        // 백엔드는 항상 cascade(알람을 sound-only 로 강등) 하지만, force 옵션을 명시적으로
        // 보내 향후 백엔드가 "사용 중일 때 거부" 모드를 도입해도 호환되도록 한다.
        let path = force ? "voice/\(id)?force=true" : "voice/\(id)"
        let _: EmptyResponse = try await request(path, method: "DELETE", token: token)
    }

    /// 임시(draft) 음성을 정식 프로필로 승격. `PATCH /voice/:id` body 에
    /// `is_draft: false` 만 보내는 변형. Android `MainViewModelVoiceActions` 의 promote 흐름.
    func promoteDraftVoice(profileId: String, token: String) async throws -> VoiceProfile {
        let response: VoiceProfileResponse = try await request(
            "voice/\(profileId)",
            method: "PATCH",
            token: token,
            body: VoiceProfileUpdateRequest(isDraft: false)
        )
        return response.profile
    }

    /// 임시(draft) 음성을 영구 삭제. `DELETE /voice/:id?force=true`.
    /// promote 하지 않고 시트를 닫은 경우 호출.
    func deleteDraftVoice(profileId: String, token: String) async throws {
        try await deleteVoiceProfile(id: profileId, token: token, force: true)
    }

    /// 공유받은 음성에 대한 viewer 의 관계/호칭 갱신.
    /// `PATCH /voice/:id/relationship`. body 의 두 필드는 모두 필수.
    /// Android `VoiceProfileApi.kt:132-137`.
    func updateVoiceProfileRelationship(
        profileId: String,
        relationshipLabel: String,
        listenerTitle: String,
        token: String
    ) async throws -> VoiceProfile {
        let response: VoiceProfileResponse = try await request(
            "voice/\(profileId)/relationship",
            method: "PATCH",
            token: token,
            body: VoiceProfileRelationshipUpdateRequest(
                relationshipLabel: relationshipLabel.trimmingCharacters(in: .whitespacesAndNewlines),
                listenerTitle: listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        )
        return response.profile
    }

    func listFamilyVoiceProfiles(token: String) async throws -> [FamilyVoiceProfile] {
        let response: FamilyVoiceProfileListResponse = try await request("voice/family", token: token)
        return response.profiles
    }

    func generateTTS(_ requestBody: TtsGenerateRequest, token: String) async throws -> TtsGenerateResponse {
        try await request("tts/generate", method: "POST", token: token, body: requestBody)
    }

    func listTTSMessages(token: String) async throws -> [TtsMessage] {
        let response: TtsMessageListResponse = try await request("tts/messages", token: token)
        return response.messages
    }

    func getTTSMessageAudio(id: String, token: String) async throws -> TtsMessageAudioResponse {
        try await request("tts/messages/\(id)/audio", token: token)
    }

    // MARK: - Sync convenience
    // RemoteAlarmPullSync / RemoteAlarmPushSync 가 사용하는 헬퍼.
    // base64 payload 를 디코드해 `(bytes, mimeType, durationMs)` 로 노출한다.
    //
    // 서버 응답의 `audioFormat` ("mp3" / "m4a" / "wav" 등) 을 audio/<format>
    // 또는 표준 MIME 으로 변환한 뒤 `AudioCacheStore.cacheBytes(_:cacheKey:...)`
    // 가 그대로 받아 쓸 수 있는 형태로 정규화한다.

    struct DecodedTtsAudio: Equatable {
        var bytes: Data
        var mimeType: String
        var durationMs: Int64?
        var rawAudioUri: String?
        var messageId: String
    }

    /// `tts/messages/{id}/audio` 응답을 디코드해 raw bytes 로 노출.
    /// `RemoteAlarmPullSync` 가 신규 수신 알람의 음원을 캐싱할 때 호출.
    func getTtsAudio(messageId: String, token: String) async throws -> DecodedTtsAudio {
        let response = try await getTTSMessageAudio(id: messageId, token: token)
        guard let data = Data(base64Encoded: response.audioBase64) else {
            throw APIError.invalidResponse
        }
        let format = AudioCacheStore.normalizedFormat(response.audioFormat)
        let mime = AudioCacheStore.mimeType(forFormat: format)
        return DecodedTtsAudio(
            bytes: data,
            mimeType: mime,
            durationMs: nil,
            rawAudioUri: response.audioUrl,
            messageId: messageId
        )
    }

    func updateProfile(_ requestBody: UpdateProfileRequest, token: String) async throws -> UpdateProfileResponse {
        try await request("user/me", method: "PATCH", token: token, body: requestBody)
    }

    func deleteAccount(token: String) async throws -> DeleteAccountResponse {
        try await request("user/me", method: "DELETE", token: token)
    }

    func getFamilyGroup(token: String) async throws -> FamilyGroupCurrentResponse {
        try await request("family/groups/current", token: token)
    }

    func leaveFamilyGroup(id: String, token: String) async throws {
        let _: EmptyResponse = try await request("family/groups/\(id)/leave", method: "POST", token: token)
    }

    func registerCode(_ code: String, token: String) async throws -> CodeRegisterResponse {
        try await request("code/register", method: "POST", token: token, body: CodeRegisterRequest(code: code))
    }

    func listReceivedNotes(token: String) async throws -> [ReceivedNote] {
        let response: NoteListResponse = try await request("notes/received", token: token)
        return response.notes
    }

    func sendNote(receiverId: String, text: String, audioUrl: String? = nil, token: String) async throws -> ReceivedNote {
        let response: SendNoteResponse = try await request(
            "notes",
            method: "POST",
            token: token,
            body: SendNoteRequest(receiverId: receiverId, text: text, audioUrl: audioUrl)
        )
        return response.note
    }

    func getNoteAudio(id: String, token: String) async throws -> NoteAudioResponse {
        try await request("notes/\(id)/audio", token: token)
    }

    func markNoteRead(id: String, token: String) async throws -> MarkNoteReadResponse {
        try await request("notes/\(id)/read", method: "PATCH", token: token)
    }

    func getCharacter(token: String) async throws -> CharacterResponse {
        try await request("characters/me", token: token)
    }

    func grantCharacterXP(event: String, token: String) async throws -> CharacterGrantResponse {
        // 레거시 진입점. nonce 를 매번 새 UUID 로 만들어 서버 멱등성을 활용하지 못한다.
        // 새 코드는 `CharacterEventStore` 가 nonce 를 만들고 아래
        // `grantCharacterXP(event:clientNonce:localDate:token:)` 를 호출하도록 한다.
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return try await grantCharacterXP(
            event: event,
            clientNonce: UUID().uuidString,
            localDate: formatter.string(from: Date()),
            token: token
        )
    }

    /// 멱등 grant — `CharacterEventStore.flushPending` 가 사용한다. 서버는 같은
    /// (user, event, client_nonce, local_date) 조합을 받으면 200 + `duplicated=true`
    /// 를 반환해 안전하게 재시도 가능. Android `CharacterXpRequest` 와 동일한 body
    /// 형태 (`context` 없음).
    func grantCharacterXP(
        event: String,
        clientNonce: String,
        localDate: String,
        token: String
    ) async throws -> CharacterGrantResponse {
        try await request(
            "characters/xp",
            method: "POST",
            token: token,
            body: CharacterXpRequest(
                event: event,
                clientNonce: clientNonce,
                localDate: localDate
            )
        )
    }

    func getSubscription(token: String) async throws -> BillingSubscriptionResponse {
        try await request("billing/subscription", token: token)
    }

    func listVouchers(token: String) async throws -> [VoucherItem] {
        let response: VoucherListResponse = try await request("billing/vouchers", token: token)
        return response.vouchers
    }

    /// 백엔드 stub-friendly 체크아웃. **Phase 4-D1 이후 deprecated** — App Store
    /// 심사 통과를 위해 디지털 구독은 Apple StoreKit2 IAP (`SubscriptionManager`)
    /// 가 권위 경로다. 본 메서드는 비-IAP 흐름 (gift 발급용 voucher / 내부 테스트)
    /// 에만 남겨두며, 일반 사용자 구매에는 사용하지 않는다.
    @available(*, deprecated, message: "Apple IAP 로 통합. SubscriptionManager.purchase(_:) 사용. gift voucher 발급만 남는 경우 유지.")
    func checkoutPlan(planKey: String, gift: Bool, token: String) async throws -> CheckoutResponse {
        try await request(
            "billing/checkout",
            method: "POST",
            token: token,
            body: CheckoutRequest(planKey: planKey, gift: gift)
        )
    }

    func createGiftVoucher(planKey: String, token: String) async throws -> CheckoutResponse {
        try await request(
            "billing/checkout",
            method: "POST",
            token: token,
            body: CheckoutRequest(planKey: planKey, gift: true)
        )
    }

    /// Phase 4-D1: Apple StoreKit2 영수증을 백엔드로 보내 entitlement 동기화.
    ///
    /// 백엔드는 transactionId/originalTransactionId 를 Apple App Store Server API
    /// 로 검증하고, 매칭되는 plan key (`personal` / `couple` / `family`) 와 만료
    /// 시각을 `subscriptions` 테이블에 upsert 한다.
    ///
    /// 본 호출이 실패해도 클라이언트는 StoreKit currentEntitlements 를 권위로 사용
    /// 하므로 currentTier 는 정확. 다음 foreground 사이클이나 명시적 재시도에서
    /// 자동 catch-up 된다.
    func confirmAppleSubscription(
        transactionID: String,
        originalTransactionID: String,
        productID: String,
        token: String
    ) async throws -> ConfirmAppleSubscriptionResponse {
        try await request(
            "billing/apple/confirm",
            method: "POST",
            token: token,
            body: ConfirmAppleSubscriptionRequest(
                transactionId: transactionID,
                originalTransactionId: originalTransactionID,
                productId: productID
            )
        )
    }

    func ensureFamilyShareCode(token: String) async throws -> VoucherItem {
        let response: EnsureFamilyShareCodeResponse = try await request(
            "billing/vouchers/family-share",
            method: "POST",
            token: token
        )
        return response.voucher
    }

    func cancelSubscription(mode: String, token: String) async throws -> CancelSubscriptionResponse {
        try await request(
            "billing/cancel",
            method: "POST",
            token: token,
            body: CancelSubscriptionRequest(mode: mode)
        )
    }

    func changePlan(planKey: String, mode: String, token: String) async throws -> ChangePlanResponse {
        try await request(
            "billing/change-plan",
            method: "POST",
            token: token,
            body: ChangePlanRequest(planKey: planKey, mode: mode)
        )
    }

    // MARK: - Phase 3-C3: 이메일 인증 / 이메일 로그인·회원가입

    /// 이메일 인증 코드 발송 요청. Android `AuthApi.requestEmailVerification` 와 동일.
    func requestEmailVerification(email: String) async throws -> RequestEmailVerificationResponse {
        try await request(
            "auth/email-code",
            method: "POST",
            body: RequestEmailVerificationRequest(email: email)
        )
    }

    /// 이메일 인증 코드 검증.
    func verifyEmailCode(email: String, code: String) async throws -> VerifyEmailCodeResponse {
        try await request(
            "auth/email-code/verify",
            method: "POST",
            body: VerifyEmailCodeRequest(email: email, code: code)
        )
    }

    /// 이메일/비밀번호 회원가입. 인증코드 검증 이후 호출되어야 한다.
    func register(email: String, password: String, name: String, verificationCode: String) async throws -> AuthSession {
        try await request(
            "auth/register",
            method: "POST",
            body: EmailRegisterRequest(
                email: email,
                password: password,
                name: name,
                emailVerificationCode: verificationCode
            )
        )
    }

    /// 이메일/비밀번호 로그인.
    func loginWithEmail(email: String, password: String) async throws -> AuthSession {
        try await request(
            "auth/login",
            method: "POST",
            body: EmailLoginRequest(email: email, password: password)
        )
    }

    // MARK: - Phase 3-C3: Family/Couple 그룹 멤버 액션

    /// 가족 그룹에서 다른 멤버를 내보낸다. 소유자 전용. Android `FamilyApi.removeMember`.
    func removeFamilyMember(groupId: String, userId: String, token: String) async throws -> EmptyResponse {
        return try await request(
            "family/groups/\(groupId)/members/\(userId)",
            method: "DELETE",
            token: token
        )
    }

    /// 소유권 이양. 새 소유자는 동일 그룹 멤버여야 한다.
    func transferFamilyOwnership(groupId: String, newOwnerId: String, token: String) async throws -> EmptyResponse {
        struct Body: Encodable { var targetUserId: String }
        return try await request(
            "family/groups/\(groupId)/transfer-ownership",
            method: "POST",
            token: token,
            body: Body(targetUserId: newOwnerId)
        )
    }

    /// 내가 가족 그룹에서 나간다. 본 메서드는 명시적 alias 로,
    /// 기존 `leaveFamilyGroup(id:token:)` 와 동일한 endpoint 를 호출한다.
    func leaveFamilyGroup(groupId: String, token: String) async throws -> EmptyResponse {
        try await request(
            "family/groups/\(groupId)/leave",
            method: "POST",
            token: token
        )
    }

    // MARK: - Phase 3-C3: Family voice alarm + 바우처 redeem + user 검색

    /// 가족 멤버에게 보내는 voice alarm 생성. Android `FamilyApi.kt:87` 의
    /// `createFamilyVoiceAlarm`. targetUserId 가 수신자.
    func createFamilyVoiceAlarm(_ requestBody: FamilyVoiceAlarmRequest, token: String) async throws -> FamilyVoiceAlarmResponse {
        try await request(
            "family/alarms/voice",
            method: "POST",
            token: token,
            body: requestBody
        )
    }

    /// 코드 redeem — 자기 자신의 바우처를 사용해 플랜을 적용. Android
    /// `BillingApi.redeem` 과 동등. 일반 INV 코드는 `registerCode` 로 처리.
    func redeemVoucher(code: String, token: String) async throws -> VoucherRedemptionResponse {
        struct Body: Encodable { var code: String }
        return try await request(
            "billing/redeem",
            method: "POST",
            token: token,
            body: Body(code: code)
        )
    }

    /// 사용자 검색. 백엔드가 도입되기 전이라도 SocialFeatureViewModel 의 send-note
    /// 흐름이 컴파일되도록 미리 정의해 둔다. 호출 사이트가 없으면 dead code 가 아닌
    /// "공개된 미사용 API" 로 남는다.
    func searchUsers(query: String, token: String) async throws -> [UserSearchResult] {
        let escaped = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let response: UserSearchResponse = try await request("users/search?q=\(escaped)", token: token)
        return response.users
    }

    private func request<Response: Decodable, Body: Encodable>(
        _ path: String,
        method: String = "GET",
        token: String? = nil,
        body: Body? = nil
    ) async throws -> Response {
        var request = URLRequest(url: endpoint(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if (200..<300).contains(http.statusCode) {
            if Response.self == EmptyResponse.self {
                return EmptyResponse() as! Response
            }
            return try decoder.decode(Response.self, from: data)
        }
        let serverError = try? decoder.decode(ServerError.self, from: data)
        throw APIError.server(
            status: http.statusCode,
            message: serverError?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
            errorCode: serverError?.errorCode
        )
    }

    private func request<Response: Decodable>(
        _ path: String,
        method: String = "GET",
        token: String? = nil
    ) async throws -> Response {
        let body: EmptyBody? = nil
        return try await request(path, method: method, token: token, body: body)
    }

    private func multipartRequest<Response: Decodable>(
        _ path: String,
        token: String,
        fields: [String: String],
        files: [MultipartFile]
    ) async throws -> Response {
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: endpoint(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var data = Data()
        for (name, value) in fields {
            data.appendMultipartLine("--\(boundary)")
            data.appendMultipartLine("Content-Disposition: form-data; name=\"\(name)\"")
            data.appendMultipartLine("")
            data.appendMultipartLine(value)
        }
        for file in files {
            data.appendMultipartLine("--\(boundary)")
            data.appendMultipartLine("Content-Disposition: form-data; name=\"\(file.fieldName)\"; filename=\"\(file.fileName)\"")
            data.appendMultipartLine("Content-Type: \(file.mimeType)")
            data.appendMultipartLine("")
            data.append(file.data)
            data.appendMultipartLine("")
        }
        data.appendMultipartLine("--\(boundary)--")
        request.httpBody = data

        let (responseData, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if (200..<300).contains(http.statusCode) {
            return try decoder.decode(Response.self, from: responseData)
        }
        let serverError = try? decoder.decode(ServerError.self, from: responseData)
        throw APIError.server(
            status: http.statusCode,
            message: serverError?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
            errorCode: serverError?.errorCode
        )
    }

    private static func defaultBaseURL() -> URL {
        if let value = Bundle.main.object(forInfoDictionaryKey: "VOICE_ALARM_API_BASE_URL") as? String,
           let url = URL(string: value) {
            return url
        }
        return URL(string: "https://voice-alarm-api.voicealarm.workers.dev/api")!
    }

    private func endpoint(_ path: String) -> URL {
        // path 가 query("?xxx=yyy") 를 포함할 수 있으므로 둘로 쪼개 처리한다.
        let (rawPath, query) = splitPathAndQuery(path)
        let base = rawPath.split(separator: "/").reduce(baseURL) { url, component in
            url.appendingPathComponent(String(component))
        }
        guard let query, !query.isEmpty,
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            return base
        }
        components.percentEncodedQuery = query
        return components.url ?? base
    }

    private func splitPathAndQuery(_ path: String) -> (path: String, query: String?) {
        guard let qIndex = path.firstIndex(of: "?") else { return (path, nil) }
        return (String(path[path.startIndex..<qIndex]), String(path[path.index(after: qIndex)...]))
    }

    static func multipartUploadFileName(fileURL: URL, originalName: String?) -> String {
        originalName.nilIfBlank ?? fileURL.lastPathComponent
    }

    private func multipartFile(fieldName: String, fileURL: URL, fileName: String? = nil) throws -> MultipartFile {
        MultipartFile(
            fieldName: fieldName,
            fileName: Self.multipartUploadFileName(fileURL: fileURL, originalName: fileName),
            mimeType: mimeType(for: fileURL),
            data: try Data(contentsOf: fileURL)
        )
    }

    private func mimeType(for fileURL: URL) -> String {
        switch fileURL.pathExtension.lowercased() {
        case "m4a": return "audio/mp4"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "caf": return "audio/x-caf"
        case "aac": return "audio/aac"
        case "webm": return "audio/webm"
        default: return "application/octet-stream"
        }
    }
}

// MARK: - CharacterXPGranting conformance
//
// `CharacterEventStore` 는 protocol 의존성으로 grant API 를 호출한다. 이미 동일한
// 시그니처 메서드 (`grantCharacterXP(event:clientNonce:localDate:token:)`) 가 위에
// 정의되어 있으므로 declarative 한 conformance 선언만 추가.
extension VoiceAlarmAPI: CharacterXPGranting {}

struct EmptyBody: Encodable {}
struct EmptyResponse: Decodable {}
struct MultipartFile {
    var fieldName: String
    var fileName: String
    var mimeType: String
    var data: Data
}

struct ServerError: Decodable {
    var error: String?
    var errorCode: String?
}

enum APIError: LocalizedError {
    case invalidResponse
    case server(status: Int, message: String, errorCode: String? = nil)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid server response."
        case .server(let status, let message, _):
            return "Server error \(status): \(message)"
        }
    }

    /// 매핑된 백엔드 error_code 가 있으면 노출. VoiceStudioViewModel.mapVoiceError 가 사용.
    var serverErrorCode: String? {
        if case .server(_, _, let code) = self { return code }
        return nil
    }
}

private extension Optional where Wrapped == String {
    var nilIfBlank: String? {
        switch self {
        case .some(let value):
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        case .none:
            return nil
        }
    }
}

private extension Data {
    mutating func appendMultipartLine(_ value: String) {
        append(Data("\(value)\r\n".utf8))
    }
}
