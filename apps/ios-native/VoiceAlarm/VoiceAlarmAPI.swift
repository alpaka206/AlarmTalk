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

struct AuthUser: Codable, Equatable, Identifiable {
    var id: String
    var email: String
    var name: String
    var plan: String
    var allowFamilyAlarms: Bool?
    var familyAlarmQuietDays: [Int]?
    var familyAlarmQuietStart: String?
    var familyAlarmQuietEnd: String?
    var familyAlarmQuietWindows: [FamilyAlarmQuietWindow]?
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
}

struct VoiceProfileUpdateRequest: Encodable {
    var name: String?
    var isShared: Bool?
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
}

struct TtsGenerateRequest: Encodable {
    var voiceProfileId: String
    var text: String
    var category: String
    var language: String
    var translate: Bool
    var random: Bool
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

struct FamilyGroupCurrentResponse: Decodable, Equatable {
    var group: FamilyGroup?
    var role: String?
    var members: [FamilyGroupMember]
}

struct FamilyGroup: Decodable, Identifiable, Equatable {
    var id: String
    var ownerUserId: String
    var planId: String
    var maxMembers: Int
    var createdAt: String
}

struct FamilyGroupMember: Decodable, Identifiable, Equatable {
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

struct BillingSubscriptionResponse: Decodable, Equatable {
    var subscription: BillingSubscription?
    var plan: BillingPlan?
    var nextPlan: BillingPlanSummary?
}

struct BillingSubscription: Decodable, Identifiable, Equatable {
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

struct BillingPlan: Decodable, Identifiable, Equatable {
    var id: String
    var key: String
    var name: String
    var planType: String
    var periodDays: Int
    var maxMembers: Int
    var priceKrw: Int
}

struct BillingPlanSummary: Decodable, Identifiable, Equatable {
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
    var familyAlarmQuietWindows: [FamilyAlarmQuietWindow]?
}

struct UpdateProfileResponse: Decodable, Equatable {
    var success: Bool
    var name: String?
    var allowFamilyAlarms: Bool?
    var familyAlarmQuietDays: [Int]?
    var familyAlarmQuietStart: String?
    var familyAlarmQuietEnd: String?
    var familyAlarmQuietWindows: [FamilyAlarmQuietWindow]?
}

struct DeleteAccountResponse: Decodable, Equatable {
    var success: Bool
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

    func loginWithApple(idToken: String, name: String?, email: String?) async throws -> AuthSession {
        struct Body: Encodable {
            var idToken: String
            var name: String?
            var email: String?
        }
        return try await request(
            "auth/apple",
            method: "POST",
            body: Body(idToken: idToken, name: name.nilIfBlank, email: email.nilIfBlank)
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

    func cloneVoice(
        audioFileURL: URL,
        name: String,
        isShared: Bool,
        durationMs: Int,
        token: String
    ) async throws -> VoiceProfile {
        let response: VoiceProfileResponse = try await multipartRequest(
            "voice/clone",
            token: token,
            fields: [
                "name": name,
                "isShared": isShared ? "true" : "false",
                "durationMs": String(durationMs),
            ],
            files: [try multipartFile(fieldName: "audio", fileURL: audioFileURL)]
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

    func updateVoiceProfile(
        id: String,
        name: String? = nil,
        isShared: Bool? = nil,
        token: String
    ) async throws -> VoiceProfile {
        let response: VoiceProfileResponse = try await request(
            "voice/\(id)",
            method: "PATCH",
            token: token,
            body: VoiceProfileUpdateRequest(name: name.nilIfBlank, isShared: isShared)
        )
        return response.profile
    }

    func deleteVoiceProfile(id: String, token: String) async throws {
        let _: EmptyResponse = try await request("voice/\(id)", method: "DELETE", token: token)
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
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return try await request(
            "characters/xp",
            method: "POST",
            token: token,
            body: CharacterXpRequest(
                event: event,
                clientNonce: UUID().uuidString,
                localDate: formatter.string(from: Date())
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

    func checkoutPlan(planKey: String, gift: Bool, token: String) async throws -> CheckoutResponse {
        try await request(
            "billing/checkout",
            method: "POST",
            token: token,
            body: CheckoutRequest(planKey: planKey, gift: gift)
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
        throw APIError.server(status: http.statusCode, message: serverError?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode))
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
        throw APIError.server(status: http.statusCode, message: serverError?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode))
    }

    private static func defaultBaseURL() -> URL {
        if let value = Bundle.main.object(forInfoDictionaryKey: "VOICE_ALARM_API_BASE_URL") as? String,
           let url = URL(string: value) {
            return url
        }
        return URL(string: "https://voice-alarm-api.voicealarm.workers.dev/api")!
    }

    private func endpoint(_ path: String) -> URL {
        path.split(separator: "/").reduce(baseURL) { url, component in
            url.appendingPathComponent(String(component))
        }
    }

    private func multipartFile(fieldName: String, fileURL: URL) throws -> MultipartFile {
        MultipartFile(
            fieldName: fieldName,
            fileName: fileURL.lastPathComponent,
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
    case server(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid server response."
        case .server(let status, let message):
            return "Server error \(status): \(message)"
        }
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
