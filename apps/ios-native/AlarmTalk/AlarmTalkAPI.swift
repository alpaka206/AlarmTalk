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
        session: URLSession = AlarmTalkAPI.makeDefaultSession()
    ) {
        self.baseURL = baseURL
        self.session = session
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    /// 모든 요청에 60초 타임아웃을 건다. Android `AlarmTalkApiClient` 의
    /// connect/read/write 60s 와 동등(`URLSessionConfiguration.timeoutIntervalForRequest`).
    /// `URLSession.shared` 의 기본 resource 타임아웃(~7일)을 짧게 줄여, ~25초밖에 없는
    /// 백그라운드 처리 창에서 끝나지 않은 요청이 무한정 매달리지 않게 한다.
    private static func makeDefaultSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 120
        return URLSession(configuration: configuration)
    }

    func loginWithApple(
        idToken: String,
        name: String?,
        email: String?,
        nonce: String?
    ) async throws -> AuthSession {
        // ⚠ 필드명은 서버 `AppleLoginRequestSchema`(@alarmtalk/shared) 와 정확히 같아야 한다:
        //   identity_token / nonce / full_name.  (`convertToSnakeCase` 로 변환된다.)
        //   예전에는 idToken/name/email 을 보내 **모든 애플 로그인이 400** 이었다.
        //   email 은 서버가 토큰에서 직접 읽으므로 보내지 않는다.
        struct Body: Encodable {
            var identityToken: String
            var nonce: String?
            var fullName: String?
        }
        return try await request(
            "auth/apple",
            method: "POST",
            body: Body(
                identityToken: idToken,
                // **raw nonce** 를 보낸다 — 서버가 SHA-256 해싱해 토큰의 nonce 클레임과 맞춘다
                // (NonceGenerator.swift 가 선언한 계약).
                nonce: nonce?.nilIfBlank,
                fullName: name.nilIfBlank
            )
        )
    }

    /// `GET /auth/me` — 사용자 부트스트랩 + **rolling refresh**.
    ///
    /// 서버는 이 응답에 **새 토큰**을 함께 내려준다(`auth.ts` 의 `rolledToken`). 호출할 때마다
    /// 만료가 밀리므로, 앱을 90일에 한 번이라도 열면 사실상 만료를 만나지 않는다.
    ///
    /// ⚠ **새 토큰을 반드시 갈아 끼워야 한다.** 예전에는 이 함수가 `user` 만 꺼내고 토큰을
    /// 버렸다. 그러면 최초 발급 토큰이 90일 뒤 그대로 죽고, 그 순간 조용히 로그아웃된 상태가
    /// 되어 소유자 게이트에 걸려 **알람이 목록에서 사라지고 울리지도 않는다.**
    ///
    /// `token` 은 옵셔널이다 — 서버가 재발급에 실패하면 키를 통째로 빼고 200 을 준다
    /// (`signAppJwt(...).catch(() => null)`). 그때는 쓰던 토큰을 계속 쓰면 된다.
    func me(token: String) async throws -> (token: String?, user: AuthUser) {
        struct Response: Decodable {
            var token: String?
            var user: AuthUser
        }
        let response: Response = try await request("auth/me", token: token)
        return (response.token, response.user)
    }

    /// W2 백엔드 토큰 폐기. 서버의 `token_epoch` 를 올려 기존에 발급된 모든 토큰을
    /// 즉시 무효화(이후 요청은 401 TOKEN_REVOKED)한다. 로그아웃 시 로컬 세션을 지우기
    /// **전에** best-effort 로 호출한다. 실패해도 로그아웃은 진행하므로 호출자가 무시한다.
    /// `POST /auth/logout`.
    func logout(token: String) async throws {
        let _: EmptyResponse = try await request("auth/logout", method: "POST", token: token)
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

    /// noiseRemoval 파라미터는 호출부 소스 호환을 위해 유지하지만 더 이상 multipart 로
    /// 전송하지 않는다. Android 는 이 필드를 보내지 않고, 백엔드도 읽지 않는다(stale).
    ///
    /// ⚠ `voiceGender`/`speechFormality` 는 **보내지 않는다.** 두 컬럼은 마이그레이션 #83 이
    /// DROP 했고, 대체재인 `speech_style` 은 등록 녹음 전사를 서버가 **자동 분석**해 채운다
    /// (`voice-profile.ts` 의 speech_style_status). 안드로이드도 이 둘을 보내지 않고 UI 도 없다
    /// (`VoiceProfileApi.createVoiceClone` 파라미터 참고). 되살리지 말 것.
    static func voiceCloneMultipartFields(
        name: String,
        isShared: Bool,
        durationMs: Int,
        noiseRemoval: Bool = false,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil,
        isDraft: Bool? = nil
    ) -> [String: String] {
        _ = noiseRemoval // stale: 더 이상 전송하지 않음(backend 무시, Android 미전송).
        let fields: [String: String] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "isShared": isShared ? "true" : "false",
            "durationMs": String(durationMs),
            "relationshipLabel": relationshipLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            "listenerTitle": listenerTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            "isDraft": (isDraft ?? false) ? "true" : "false",
        ]
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

    /// 기본 제공(스톡) 알람 클립 카탈로그 조회. 서버는 모든 인증 사용자에게 동일한
    /// 전역 목록을 주며, 쿼리 파라미터를 받지 않는다(tts.ts:1287-1313). 언어/카테고리
    /// 필터·정렬은 클라이언트(StockClipPicker)가 담당한다. 미리듣기/선택 시 음원은
    /// 기존 `getTTSMessageAudio` 로 받는다(신규 오디오 엔드포인트 없음).
    func getStockClips(token: String) async throws -> [StockClip] {
        let response: StockClipListResponse = try await request("tts/stock-clips", token: token)
        return response.clips
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

    /// 약관 동의 기록. Android `AuthApi.kt:248-252`.
    func recordConsents(_ requestBody: RecordConsentsRequest, token: String) async throws -> RecordConsentsResponse {
        try await request("user/consents", method: "POST", token: token, body: requestBody)
    }

    /// 유형별 최신 동의 기록 목록 조회. 설정 화면의 마케팅(광고성 정보 수신) 토글이
    /// 현재 동의 상태를 읽을 때 사용. Android `AuthApi.kt:245-246`, 백엔드 user.ts:401.
    func listConsents(token: String) async throws -> ConsentListResponse {
        try await request("user/consents", token: token)
    }

    /// 앱 최소지원버전 정책 조회. 인증 불필요. Android `AuthApi.kt:215` (`platform` 만 ios).
    func appVersion(platform: String = "ios") async throws -> AppVersionResponse {
        try await request("app/version?platform=\(platform)")
    }

    /// 다국가 공휴일 조회. 인증 불필요 (no-token GET). Phase 2 — KR 외 국가 전용.
    /// `type == "public"` 항목만 알람 skip 대상 HolidayEntity 로 매핑한다.
    /// epochDay 는 KoreanLunarHolidayEngine 으로 파싱해 HolidayStore.epochDay 와 정합.
    func fetchHolidays(
        country: String,
        from: String,
        to: String,
        lang: String? = nil
    ) async throws -> [HolidayEntity] {
        let cc = country.uppercased()
        var path = "holiday?country=\(cc)&from=\(from)&to=\(to)"
        if let lang, !lang.isEmpty {
            path += "&lang=\(lang)"
        }
        let response: HolidayApiResponse = try await request(path)
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        return response.holidays.compactMap { item -> HolidayEntity? in
            guard item.type == "public" else { return nil }
            guard let epochDay = Self.holidayEpochDay(from: item.date) else { return nil }
            return HolidayEntity(
                countryCode: cc,
                regionCode: "",
                epochDay: epochDay,
                localDate: item.date,
                name: item.name,
                source: "server_sync",
                updatedAtMillis: nowMillis
            )
        }
    }

    /// "yyyy-MM-dd" → epochDay. Asia/Seoul gregorian 으로 파싱해 HolidayStore.epochDay 와 일치.
    private static func holidayEpochDay(from localDate: String) -> Int? {
        let parts = localDate.split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else {
            return nil
        }
        return KoreanLunarHolidayEngine.epochDay(year: y, month: m, day: d)
    }

    func getFamilyGroup(token: String) async throws -> FamilyGroupCurrentResponse {
        try await request("family/groups/current", token: token)
    }

    func registerCode(_ code: String, token: String) async throws -> CodeRegisterResponse {
        try await request("code/register", method: "POST", token: token, body: CodeRegisterRequest(code: code))
    }

    func getSubscription(token: String) async throws -> BillingSubscriptionResponse {
        try await request("billing/subscription", token: token)
    }

    func listVouchers(token: String) async throws -> [VoucherItem] {
        let response: VoucherListResponse = try await request("billing/vouchers", token: token)
        return response.vouchers
    }

    /// 선물용 이용권(voucher) 발급. `POST /billing/checkout` 의 `gift: true` 갈래다.
    ///
    /// **본인 구매가 아니다.** 디지털 구독 본인 구매는 App Store 심사 규정상 Apple
    /// StoreKit2 IAP(`SubscriptionManager.purchase`)가 유일 경로이고, 그 경로는
    /// `confirmAppleSubscription` 으로 서버와 맞춘다. 여기는 선물 코드를 만드는 것뿐이다.
    /// 안드로이드도 같은 라우트를 쓴다(`BillingApi.kt` 의 `@POST("billing/checkout")`).
    ///
    /// ⚠ 서버는 production 에서 이 라우트를 **항상 비활성**한다
    /// (`isBillingStubEnabled` — env 오설정 하나로 무결제 유료지급 디스펜서가 되는 것 차단).
    /// 그때는 409 `CHECKOUT_DISABLED` 가 온다.
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
        token: String
    ) async throws -> ConfirmAppleSubscriptionResponse {
        try await request(
            "billing/apple/confirm",
            method: "POST",
            token: token,
            body: ConfirmAppleSubscriptionRequest(transactionId: transactionID)
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

    /// 기존 공유 코드를 무효화(expired)하고 새 코드를 발급한다(유출 의심 시 재발급).
    /// Android `BillingApi.kt:150-153`, 백엔드 billing-mutation.ts:641.
    func regenerateFamilyShareCode(token: String) async throws -> VoucherItem {
        let response: EnsureFamilyShareCodeResponse = try await request(
            "billing/vouchers/family-share/regenerate",
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

    // MARK: - 비밀번호 재설정

    /// 비밀번호 재설정 코드 발송. 계정 존재 여부를 노출하지 않으므로(비번 계정에만 발송)
    /// 응답은 항상 성공이다. Android `AuthApi.kt:200-201`, 백엔드 auth.ts:280.
    func requestPasswordReset(email: String) async throws -> RequestEmailVerificationResponse {
        try await request(
            "auth/password-reset",
            method: "POST",
            body: PasswordResetRequest(email: email)
        )
    }

    /// 비밀번호 재설정 확정 — 6자리 코드 검증 후 새 비밀번호로 교체. 성공 시 서버가
    /// token_epoch 를 올려 기존 세션을 전부 폐기한다. Android `AuthApi.kt:203-206`,
    /// 백엔드 auth.ts:359.
    func confirmPasswordReset(
        email: String,
        code: String,
        password: String
    ) async throws -> PasswordResetConfirmResponse {
        try await request(
            "auth/password-reset/confirm",
            method: "POST",
            body: PasswordResetConfirmRequest(email: email, code: code, password: password)
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

    /// 내가 가족 그룹에서 나간다.
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

    /// `POST /alarm/:id/decline` — **받은 알람 그만받기.**
    ///
    /// 받은 알람을 지울 때 `DELETE /alarm/:id` 를 쓰면 안 된다 — 서버가 **소유자만**
    /// 허용해서 404 가 나고(`alarm-mutation.ts` 의 `user_id IN (ownerIds)` 게이트),
    /// 그러면 그만받기가 기록되지 않아 **다음 pull 이 그 알람을 다시 임포트한다.**
    /// 사용자는 지웠는데 되살아나는 것으로 겪는다.
    ///
    /// 한 번 declined 되면 API 로 되돌릴 방법이 없다(un-decline 라우트는 삭제됐다).
    func declineAlarm(id: String, token: String) async throws {
        let _: EmptyResponse = try await request("alarm/\(id)/decline", method: "POST", token: token)
    }

    /// `GET /alarm/declined` 한 페이지. 서버가 limit 을 100 으로 클램프한다.
    func declinedAlarms(limit: Int = 100, offset: Int = 0, token: String) async throws -> DeclinedAlarmsResponse {
        try await request("alarm/declined?limit=\(limit)&offset=\(offset)", token: token)
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
        Self.applyAppMetadataHeaders(to: &request)
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
        if http.statusCode == 401 {
            Self.handleUnauthorized()
        }
        let serverError = try? decoder.decode(ServerError.self, from: data)
        if http.statusCode == 403, serverError?.errorCode == Self.consentRequiredErrorCode {
            Self.handleConsentRequired()
        }
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
        Self.applyAppMetadataHeaders(to: &request)
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
        if http.statusCode == 401 {
            Self.handleUnauthorized()
        }
        let serverError = try? decoder.decode(ServerError.self, from: responseData)
        if http.statusCode == 403, serverError?.errorCode == Self.consentRequiredErrorCode {
            Self.handleConsentRequired()
        }
        throw APIError.server(
            status: http.statusCode,
            message: serverError?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
            errorCode: serverError?.errorCode
        )
    }

    // MARK: - 공통 헤더 / 401 중앙 처리

    /// 모든 요청에 플랫폼/버전 메타데이터를 싣는다. Android `AlarmTalkApiClient` 의
    /// `versionHeader` 인터셉터와 동일한 헤더 이름·값 시맨틱.
    /// - `X-App-Platform`: 리터럴 `"ios"` (Android 는 `"android"`).
    /// - `X-App-Version`: 설치 빌드 번호(`CFBundleVersion`) 의 문자열. Android 는
    ///   `appVersionCode.toString()` 을 보내므로, marketing 버전(`CFBundleShortVersionString`)
    ///   이 아니라 정수 빌드 번호를 보내야 값 시맨틱이 일치한다.
    ///   `AppVersionGate.installedVersionCode()` 와 동일한 키(`CFBundleVersion`)·변환을 쓰되,
    ///   그쪽은 `@MainActor` 격리라 여기서 직접 읽어 actor 격리 위반을 피한다.
    private static func applyAppMetadataHeaders(to request: inout URLRequest) {
        request.setValue("ios", forHTTPHeaderField: "X-App-Platform")
        request.setValue(appVersionHeaderValue, forHTTPHeaderField: "X-App-Version")
    }

    private static let appVersionHeaderValue: String = {
        let raw = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return String(Int(raw) ?? 1)
    }()

    /// 401 응답을 받으면 한 번만 세션 만료 알림을 쏜다. Android `UnauthorizedAuthenticator`
    /// 가 응답 체인당 콜백을 한 번만 호출하는 동작과 동등.
    /// 짧은 시간에 401 이 연발(여러 동시 요청)해도 디바운스해 로그아웃을 1회로 묶는다.
    /// 옵저버(`AuthViewModel`)가 main actor 에서 `signOut` 하도록 Notification 으로 전달한다.
    static let unauthorizedNotification = Notification.Name("AlarmTalkAPIUnauthorized")

    /// W2 백엔드 동의 미들웨어가 403 `CONSENT_REQUIRED` 를 돌려줄 때 쏘는 알림.
    /// `AuthViewModel` 이 받아 필수 동의 재기록 플로우(`needsConsent=true`)로 게이팅한다.
    /// 401(세션 만료)과 달리 세션은 유지하고 동의 화면만 띄운다.
    static let consentRequiredNotification = Notification.Name("AlarmTalkAPIConsentRequired")

    /// 401 응답의 `error_code`. TOKEN_REVOKED(로그아웃으로 token_epoch 상향) 도
    /// 일반 401 과 동일하게 강제 로그아웃 경로를 탄다 — 별도 분기 없이 status==401
    /// 로 충분하지만, 호출자 참조용으로 상수를 노출한다.
    static let tokenRevokedErrorCode = "TOKEN_REVOKED"
    static let consentRequiredErrorCode = "CONSENT_REQUIRED"

    /// 디바운스용 상태. 동시 호출이 있을 수 있어 lock 으로 보호한다.
    private static let unauthorizedLock = NSLock()
    private nonisolated(unsafe) static var lastUnauthorizedAt: Date?
    private nonisolated(unsafe) static var lastConsentRequiredAt: Date?

    private static func handleUnauthorized() {
        unauthorizedLock.lock()
        let now = Date()
        if let last = lastUnauthorizedAt, now.timeIntervalSince(last) < 3 {
            unauthorizedLock.unlock()
            return
        }
        lastUnauthorizedAt = now
        unauthorizedLock.unlock()
        NotificationCenter.default.post(name: unauthorizedNotification, object: nil)
    }

    /// 403 + `CONSENT_REQUIRED` 을 받으면 한 번만 동의 필요 알림을 쏜다.
    /// `handleUnauthorized` 와 동일하게 연발(동시 요청)을 디바운스해 1회로 묶는다.
    private static func handleConsentRequired() {
        unauthorizedLock.lock()
        let now = Date()
        if let last = lastConsentRequiredAt, now.timeIntervalSince(last) < 3 {
            unauthorizedLock.unlock()
            return
        }
        lastConsentRequiredAt = now
        unauthorizedLock.unlock()
        NotificationCenter.default.post(name: consentRequiredNotification, object: nil)
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
