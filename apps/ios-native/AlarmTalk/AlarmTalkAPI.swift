import Foundation

// 모든 stored property 가 `let` 이고 URLSession / JSONDecoder / JSONEncoder 는
// 사실상 thread-safe 이므로 `@unchecked Sendable` 로 노출해 async 컨텍스트에서
// main actor 격리된 RemoteAlarmSyncViewModel.api 를 캡처할 수 있게 한다.
final class AlarmTalkAPI: @unchecked Sendable {
    static let shared = AlarmTalkAPI()

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        baseURL: URL = AlarmTalkAPI.defaultBaseURL(),
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
                relationshipLabel: relationshipLabel.nilIfBlank,
                listenerTitle: listenerTitle.nilIfBlank
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

    /// 30일 유예 탈퇴 신청. 즉시 삭제 대신 유예 상태로 전환. Android `AuthApi.kt:197`.
    func requestAccountDeletion(token: String) async throws -> AccountDeletionResponse {
        try await request("user/me/deletion", method: "POST", token: token)
    }

    /// 유예 기간 내 탈퇴 철회 → 계정 복구. Android `AuthApi.kt:202`.
    func cancelAccountDeletion(token: String) async throws -> CancelDeletionResponse {
        try await request("user/me/deletion", method: "DELETE", token: token)
    }

    /// 필수 약관 동의 필요 여부 조회. Android `AuthApi.kt:206`.
    func consentStatus(token: String) async throws -> ConsentStatusResponse {
        try await request("user/consents/status", token: token)
    }

    /// 약관 동의 기록. Android `AuthApi.kt:209`.
    func recordConsents(_ requestBody: RecordConsentsRequest, token: String) async throws -> RecordConsentsResponse {
        try await request("user/consents", method: "POST", token: token, body: requestBody)
    }

    /// 앱 최소지원버전 정책 조회. 인증 불필요. Android `AuthApi.kt:215` (`platform` 만 ios).
    func appVersion(platform: String = "ios") async throws -> AppVersionResponse {
        try await request("app/version?platform=\(platform)")
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
    /// `createFamilyAlarmTalk`. targetUserId 가 수신자.
    func createFamilyAlarmTalk(_ requestBody: FamilyAlarmTalkRequest, token: String) async throws -> FamilyAlarmTalkResponse {
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

    /// 사용자 검색. Android 및 backend contract 의 `GET /user/search` 와 동일.
    /// 호출 사이트가 없으면 dead code 가 아닌 "공개된 미사용 API" 로 남는다.
    func searchUsers(query: String, token: String) async throws -> [UserSearchResult] {
        let escaped = Self.percentEncodedQueryValue(query)
        let response: UserSearchResponse = try await request("user/search?q=\(escaped)", token: token)
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
           let url = URL(string: value),
           url.scheme == "https" {
            return url
        }
        return URL(string: "https://api.alarm-talk.com/api")!
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

    private static func percentEncodedQueryValue(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
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
extension AlarmTalkAPI: CharacterXPGranting {}

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


private extension Data {
    mutating func appendMultipartLine(_ value: String) {
        append(Data("\(value)\r\n".utf8))
    }
}
