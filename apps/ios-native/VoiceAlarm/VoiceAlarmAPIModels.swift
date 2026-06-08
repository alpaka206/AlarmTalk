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
        if lower.hasPrefix("r2://") || lower.hasPrefix("https://") {
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

/// 30일 유예 탈퇴 신청 응답. Android `AuthApi.kt:125` `AccountDeletionResponse`.
struct AccountDeletionResponse: Decodable, Equatable {
    var success: Bool = false
    var status: String = "pending_deletion"
    var purgeAt: String? = nil
    var graceDays: Int = 30
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

/// 약관 동의 기록 요청. Android `AuthApi.kt:143` `RecordConsentsRequest`.
struct RecordConsentsRequest: Encodable, Equatable {
    var consents: [ConsentItemRequest]
}

/// 약관 동의 기록 응답. Android `AuthApi.kt:147` `RecordConsentsResponse`.
struct RecordConsentsResponse: Decodable, Equatable {
    var success: Bool = false
    var recorded: Int = 0
}

/// 약관 동의 필요 여부 응답. Android `AuthApi.kt:152` `ConsentStatusResponse`.
struct ConsentStatusResponse: Decodable, Equatable {
    var needsConsent: Bool = false
    var required: [String] = []
    var missing: [String] = []
    var policyVersion: String = "1"
}

/// 앱 최소지원버전 정책 응답. Android `AuthApi.kt:159` `AppVersionResponse`.
struct AppVersionResponse: Decodable, Equatable {
    var platform: String = "ios"
    var minSupportedVersion: Int = 1
    var latestVersion: Int = 1
    var storeUrl: String = ""
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
