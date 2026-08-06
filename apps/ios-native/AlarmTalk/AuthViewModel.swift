import AuthenticationServices
import Foundation

/// `AuthViewModel` 이 의존하는 API 시그니처. 단위 테스트에서 mock 으로 주입하기 위해
/// protocol 로 분리한다. `AlarmTalkAPI` 가 conform.
/// MainActor 제약을 두지 않아 `AlarmTalkAPI` (non-isolated) 가 그대로 만족.
/// `Sendable` — MainActor 격리된 호출자가 async 컨텍스트로 self 인스턴스를 캡처할 때
/// race 경고를 피하기 위해. 실제 conformer 인 `AlarmTalkAPI` 는 `@unchecked Sendable`.
protocol AuthAPIProviding: AnyObject, Sendable {
    /// rolling refresh — 새 토큰을 함께 돌려준다(서버 재발급 실패 시 nil).
    func me(token: String) async throws -> (token: String?, user: AuthUser)
    func updateProfile(_ requestBody: UpdateProfileRequest, token: String) async throws -> UpdateProfileResponse
    func deleteAccount(token: String) async throws -> DeleteAccountResponse
    func requestAccountDeletion(token: String) async throws -> AccountDeletionResponse
    func cancelAccountDeletion(token: String) async throws -> CancelDeletionResponse
    func consentStatus(token: String) async throws -> ConsentStatusResponse
    func recordConsents(_ requestBody: RecordConsentsRequest, token: String) async throws -> RecordConsentsResponse
    func logout(token: String) async throws
}

extension AlarmTalkAPI: AuthAPIProviding {}

/// Apple 자격 증명 상태를 조회하는 의존성. 단위 테스트에서 mock 가능.
/// 실제 구현은 `ASAuthorizationAppleIDProvider.getCredentialState(forUserID:)` 를 호출.
protocol AppleCredentialStateProviding: Sendable {
    func credentialState(forUserID userID: String) async throws -> ASAuthorizationAppleIDProvider.CredentialState
}

struct LiveAppleCredentialStateProvider: AppleCredentialStateProviding {
    func credentialState(forUserID userID: String) async throws -> ASAuthorizationAppleIDProvider.CredentialState {
        let provider = ASAuthorizationAppleIDProvider()
        return try await withCheckedThrowingContinuation { continuation in
            provider.getCredentialState(forUserID: userID) { state, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: state)
                }
            }
        }
    }
}

@MainActor
final class AuthViewModel: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published var statusMessage: String?
    @Published var isBusy = false
    /// 401 외의 일시 오류(5xx, 4xx 기타, 네트워크 단절 등) 를 사용자에게 보여주되
    /// 세션은 유지한다. UI 가 빨간 띠/스낵바 등으로 노출하면 된다.
    /// nil 이면 마지막 호출이 정상이었음을 의미.
    @Published private(set) var lastNetworkError: String?
    /// 30일 유예 탈퇴 진행 중 여부. true 면 RootView 가 복구 화면으로 게이팅한다.
    /// `/auth/me` 응답의 `deletion_status == "pending_deletion"` 에서 설정된다.
    /// Android `MainViewModel.pendingDeletion`.
    @Published private(set) var pendingDeletion = false
    /// **필수** 약관 동의가 없어 앱을 못 쓰는 상태인지.
    /// `/user/consents/status` 의 `needs_consent`. Android `MainViewModel.needsConsent`.
    ///
    /// ⚠ 화면을 띄울지는 이 값이 아니라 `showConsentScreen` 으로 판단한다.
    @Published private(set) var needsConsent = false
    /// 서버가 계산해 준 '받을 게 있는가'(선택 유형만 재수집일 때도 true).
    @Published private(set) var consentNeedsCollection = false
    /// 이번 화면에서 받아야 하는 동의 유형. **화면은 이것만 그리고 제출도 이것만 한다.**
    @Published private(set) var consentCollect: [String] = []
    /// `consentCollect` 중 체크 없이 통과하는 유형(선택 동의).
    @Published private(set) var consentOptional: [String] = []
    /// 목소리 등록 화면에서 인라인으로 다시 물어야 하는 민감 동의.
    @Published private(set) var consentSensitiveMissing: [String] = []
    /// 개정에 따른 재동의인지(이미 동의한 적 있는 계정). 문구가 달라야 한다.
    @Published private(set) var consentIsReconsent = false

    /// 동의 화면을 띄워야 하는가.
    ///
    /// ⚠ **`needsConsent` 만 보면 안 된다.** 선택 유형만 재수집하는 경우
    /// (`collect == ["marketing"]`) `needsConsent` 는 false 라 화면이 영영 안 뜬다.
    /// 반대로 이 값을 보지 않고 크롬(하단바·FAB)을 그리면 동의 화면 **아래에** 탭이 남아
    /// 수집이 끝나기 전에 다른 화면으로 샐 수 있다(Android Codex #660 과 같은 판단).
    var showConsentScreen: Bool {
        needsConsent || consentNeedsCollection || !consentCollect.isEmpty
    }

    /// **이 앱 버전이 화면에 그릴 수 있는** 동의 유형 전부.
    ///
    /// 서버가 새 유형을 먼저 추가하고 구버전 앱이 살아 있는 구간이 있다. 그때 화면이 그리지
    /// 못한 유형을 '체크됨' 으로 취급하면 **사용자가 본 적 없는 동의가 기록된다** — 동의
    /// 기록의 신뢰성이 통째로 무너지는 종류의 버그다. 모르는 유형은 제출에서 빼고,
    /// 그게 필수면 화면이 CTA 를 막는다.
    static let knownConsentTypes: Set<String> = [
        "terms", "privacy", "age14", "marketing", "voice_biometric", "overseas_transfer",
    ]

    /// status 응답을 못 받았을 때의 폴백(가입 필수 4종).
    static let signupRequiredConsentTypes = ["age14", "terms", "privacy", "overseas_transfer"]

    /// 목소리/TTS 라우트가 그 자리에서 요구하는 민감 동의. 가입 게이트와 별개다.
    static let sensitiveConsentTypes: Set<String> = ["voice_biometric", "overseas_transfer"]

    /// 목소리를 만들려는 순간에 받아야 하는 민감 동의 요청.
    struct SensitiveConsentRequest: Identifiable, Equatable {
        let id = UUID()
        /// 이번에 받을 유형. 서버가 지목한 것만 담는다 — 이미 유효한 동의를 다시 묻지 않는다.
        var types: [String]
        /// 동의 직후 목소리 등록이 이어지는가. **문맥은 '무엇을 묻는가' 가 아니라 '동의 직후
        /// 무엇을 하는가' 로 정한다** — 묻는 항목으로 문맥을 파생하면, 국외 이전만 빠진
        /// 상태에서 TTS 문구가 떠서 사용자는 '문구 생성 동의' 인 줄 알고 눌렀는데 실제로는
        /// 녹음이 올라가고 클론이 만들어진다.
        var registeringVoice: Bool = false
    }

    /// 떠 있어야 하는 민감 동의 시트. nil 이면 없음.
    @Published var pendingSensitiveConsent: SensitiveConsentRequest?
    /// 비밀번호 재설정 코드를 발송한 이메일. 비어 있지 않으면 UI(PasswordResetView)가
    /// "코드 + 새 비밀번호" 입력 단계를 노출한다. Android `MainViewModel.passwordResetCodeSentTo`.
    @Published var passwordResetCodeSentTo: String?
    /// 설정 화면의 마케팅(광고성 정보 수신) 동의 토글 상태. `loadMarketingConsent` 로 채운다.
    /// Android `MainViewModel.marketingConsentAgreed`.
    @Published var marketingConsentAgreed = false
    /// 마케팅 동의 상태 로드가 실패했는지. true 면 UI 가 재시도 안내를 노출할 수 있다.
    /// Android `MainViewModel.marketingConsentLoadFailed`.
    @Published private(set) var marketingConsentLoadFailed = false
    /// 서버가 이 빌드보다 새 법무 문서를 게시 중이라 동의를 기록할 수 없는 상태.
    /// true 면 UI 가 업데이트 안내로 게이팅한다. Android `MainViewModel.consentUnsupported`.
    @Published private(set) var consentUnsupported = false

    private let api: AuthAPIProviding
    private let appleCredentialProvider: AppleCredentialStateProviding
    private let accessSnapshotStore: AccessSnapshotStore
    /// `addObserver(forName:object:queue:using:)` 가 반환한 토큰. deinit 시
    /// 명시 해제해야 NotificationCenter 내부 strong reference 가 풀린다.
    /// `nonisolated(unsafe)` — deinit 은 nonisolated 컨텍스트인데 본 프로퍼티는
    /// init/deinit 외에서 건드리지 않으므로 동시성 race 없음.
    private nonisolated(unsafe) var appleRevokeObserver: NSObjectProtocol?
    /// 모든 API 요청이 401 을 받으면 `AlarmTalkAPI` 가 쏘는 세션 만료 알림의 옵저버 토큰.
    /// Android `UnauthorizedAuthenticator` → `handleUnauthorized` 강제 로그아웃과 동등.
    /// `appleRevokeObserver` 와 동일한 수명 관리(deinit 에서 removeObserver).
    private nonisolated(unsafe) var unauthorizedObserver: NSObjectProtocol?
    /// 데이터 라우트가 403 CONSENT_REQUIRED 를 받으면 `AlarmTalkAPI` 가 쏘는 알림의 옵저버.
    /// 세션은 유지하되 동의 화면으로 게이팅하기 위해 `needsConsent=true` 로 둔다.
    private nonisolated(unsafe) var consentRequiredObserver: NSObjectProtocol?
    /// `verifyAppleCredentialStateIfNeeded` 가 같은 사용자에 대해 중복 동시 호출되는
    /// 일을 막는다. SwiftUI scenePhase 가 짧은 시간 안에 두 번 .active 가 되는
    /// 경우(예: 시스템 알림창 → 복귀) 가 있어 직렬화.
    private var isVerifyingAppleCredential = false

    init(
        api: AuthAPIProviding = AlarmTalkAPI.shared,
        appleCredentialProvider: AppleCredentialStateProviding = LiveAppleCredentialStateProvider(),
        accessSnapshotStore: AccessSnapshotStore = AccessSnapshotStore()
    ) {
        self.api = api
        self.appleCredentialProvider = appleCredentialProvider
        self.accessSnapshotStore = accessSnapshotStore
        session = KeychainStore.readSession()

        // Apple 자격 증명이 다른 디바이스에서 revoke 되면 시스템이 이 알림을 쏜다.
        // block-based observer 는 deinit 에서 명시 removeObserver 가 필요하므로
        // 토큰을 보관한다. [weak self] 로 self 가 strong 으로 capture 되지 않게.
        appleRevokeObserver = NotificationCenter.default.addObserver(
            forName: ASAuthorizationAppleIDProvider.credentialRevokedNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // userInfo 가 없으므로 단순히 trigger 로만 사용.
            Task { @MainActor [weak self] in
                self?.handleAppleCredentialRevoked()
            }
        }

        // 모든 API 요청 레이어가 401 을 받으면 강제 로그아웃. `AlarmTalkAPI` 가
        // 디바운스(연발 401 → 1회) 후 알림을 쏘고, 여기서 main actor 로 받아 signOut.
        unauthorizedObserver = NotificationCenter.default.addObserver(
            forName: AlarmTalkAPI.unauthorizedNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handleUnauthorized()
            }
        }

        // 데이터 라우트가 403 CONSENT_REQUIRED 를 받으면 동의 화면으로 게이팅한다.
        // 세션은 유지하므로 signOut 이 아니라 needsConsent 만 올린다(재기록 후 재시도).
        consentRequiredObserver = NotificationCenter.default.addObserver(
            forName: AlarmTalkAPI.consentRequiredNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            let consent = note.userInfo?[AlarmTalkAPI.consentRequiredTypeKey] as? String
            Task { @MainActor [weak self] in
                self?.handleConsentRequired(consent: consent)
            }
        }
    }

    deinit {
        // nonisolated deinit — main-actor isolated property 에는 접근하지 않는다.
        // appleRevokeObserver 는 nonisolated(unsafe) 이라 안전하게 읽을 수 있다.
        if let token = appleRevokeObserver {
            NotificationCenter.default.removeObserver(token)
        }
        if let token = unauthorizedObserver {
            NotificationCenter.default.removeObserver(token)
        }
        if let token = consentRequiredObserver {
            NotificationCenter.default.removeObserver(token)
        }
    }

    var token: String? {
        session?.token
    }

    var isAuthenticated: Bool {
        session != nil
    }

    func restoreSession() async {
        guard let saved = KeychainStore.readSession() else { return }
        session = saved
        await refreshUser()
        await checkConsentStatus()
    }

    func handleAppleAuthorization(_ authorization: ASAuthorization, rawNonce: String?) async {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            statusMessage = "Apple 로그인 정보를 확인하지 못했어요."
            return
        }
        guard
            let tokenData = credential.identityToken,
            let idToken = String(data: tokenData, encoding: .utf8)
        else {
            statusMessage = "Apple identity token을 받지 못했어요."
            return
        }

        let displayName = credential.fullName.flatMap(Self.displayName)
        await loginWithApple(
            idToken: idToken,
            name: displayName,
            email: credential.email,
            rawNonce: rawNonce,
            // Apple 의 stable user identifier. 백엔드 응답이 비어 있어도
            // 이 값을 세션에 보존해 credentialState 조회에 사용한다.
            appleUserIdHint: credential.user
        )
    }

    func handleAppleAuthorizationFailure(_ error: Error) {
        statusMessage = userFacingErrorMessage(error, fallback: "Apple 로그인에 실패했어요. 다시 시도해 주세요.")
    }

    func loginWithApple(
        idToken: String,
        name: String?,
        email: String?,
        rawNonce: String?,
        appleUserIdHint: String? = nil
    ) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            var nextSession = try await AlarmTalkAPI.shared.loginWithApple(
                idToken: idToken,
                name: name,
                email: email,
                nonce: rawNonce
            )
            // 백엔드가 `apple_user_id` 를 비워서 돌려주는 경우에도 클라이언트가
            // 갖고 있던 credential.user 를 보존. 백엔드 변경 전/후 모두 호환.
            if nextSession.user.appleUserId.nilIfBlank == nil,
               let hint = appleUserIdHint, !hint.isEmpty {
                nextSession.user.appleUserId = hint
            }
            try KeychainStore.saveSession(nextSession)
            session = nextSession
            statusMessage = "로그인됐어요."
            lastNetworkError = nil
            // 탈퇴 유예 상태 점검 — 유예 중인 계정이 다시 로그인하면 복구 화면을 띄운다.
            await refreshUser()
            // 필수 약관 미동의면 동의 화면으로 게이팅.
            await checkConsentStatus()
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "Apple 로그인에 실패했어요. 다시 시도해 주세요.")
        }
    }

    // MARK: - Phase 3-C3: 이메일/비밀번호 + 인증코드

    /// 이메일 인증 코드를 발송한다. UI 는 statusMessage 를 받아 상태 메시지로 노출.
    func requestEmailVerification(email: String) async {
        guard !isBusy, !email.isEmpty else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await AlarmTalkAPI.shared.requestEmailVerification(email: email)
            statusMessage = "인증 코드를 보냈어요. 메일을 확인해 주세요."
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "인증 코드를 보내지 못했어요")
        }
    }

    /// 이메일 인증 코드를 검증한다. 성공하면 true, 실패하면 false.
    /// UI 는 반환값으로 다음 단계(비밀번호 입력 활성화)를 결정.
    @discardableResult
    func verifyEmailCode(email: String, code: String) async -> Bool {
        guard !isBusy else { return false }
        isBusy = true
        defer { isBusy = false }

        do {
            let response = try await AlarmTalkAPI.shared.verifyEmailCode(email: email, code: code)
            if response.verified == false {
                statusMessage = "인증 코드가 일치하지 않아요."
                return false
            }
            statusMessage = "이메일 인증이 완료됐어요."
            return true
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "인증 코드가 맞지 않아요")
            return false
        }
    }

    /// 이메일/비밀번호 로그인.
    func loginWithEmail(email: String, password: String) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let nextSession = try await AlarmTalkAPI.shared.loginWithEmail(email: email, password: password)
            try KeychainStore.saveSession(nextSession)
            session = nextSession
            statusMessage = "로그인됐어요."
            lastNetworkError = nil
            // 탈퇴 유예 상태 점검 — 유예 중인 계정이 다시 로그인하면 복구 화면을 띄운다.
            await refreshUser()
            // 필수 약관 미동의면 동의 화면으로 게이팅.
            await checkConsentStatus()
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "로그인에 실패했어요")
        }
    }

    /// 이메일/비밀번호 회원가입. 인증코드 검증 직후 호출.
    func registerWithEmail(
        email: String,
        password: String,
        name: String,
        verificationCode: String
    ) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let nextSession = try await AlarmTalkAPI.shared.register(
                email: email,
                password: password,
                name: name,
                verificationCode: verificationCode
            )
            try KeychainStore.saveSession(nextSession)
            session = nextSession
            statusMessage = "환영해요! 계정이 만들어졌어요."
            lastNetworkError = nil
            // 신규 가입자는 필수 약관 동의가 필요 — 동의 화면으로 게이팅.
            await checkConsentStatus()
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "회원가입에 실패했어요")
        }
    }

    // MARK: - 비밀번호 재설정

    /// 비밀번호 재설정 코드를 발송한다. 백엔드는 계정 존재 여부를 노출하지 않으므로(비번
    /// 계정에만 발송) 응답은 항상 성공이다. 성공 시 `passwordResetCodeSentTo` 를 채워 UI 가
    /// 다음 단계(코드 + 새 비밀번호)를 노출한다. Android `MainViewModel.requestPasswordReset`.
    func requestPasswordReset(email: String) async {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !isBusy, !normalized.isEmpty else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await AlarmTalkAPI.shared.requestPasswordReset(email: normalized)
            passwordResetCodeSentTo = normalized
            statusMessage = "재설정 코드를 보냈어요. 메일을 확인해 주세요."
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "인증 코드를 보내지 못했어요")
        }
    }

    /// 비밀번호 재설정 확정. 6자리 코드 검증 후 새 비밀번호로 교체한다. 성공하면 true 를
    /// 돌려주고 `passwordResetCodeSentTo` 를 비워 UI 가 로그인 화면으로 돌아가게 한다.
    /// 비밀번호 정책은 서버(8~128자 + 영문 + 숫자)와 동일하게 호출 측에서 1차 검증한다.
    /// Android `MainViewModel.confirmPasswordReset`.
    @discardableResult
    func confirmPasswordReset(email: String, code: String, newPassword: String) async -> Bool {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isBusy else { return false }
        guard !normalized.isEmpty, trimmedCode.count == 6, !newPassword.isEmpty else {
            statusMessage = "모든 항목을 입력해 주세요."
            return false
        }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await AlarmTalkAPI.shared.confirmPasswordReset(
                email: normalized,
                code: trimmedCode,
                password: newPassword
            )
            passwordResetCodeSentTo = nil
            statusMessage = "비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요."
            return true
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "비밀번호 재설정에 실패했어요")
            return false
        }
    }

    /// 401 만 세션 만료로 처리하고, 그 외는 lastNetworkError 만 갱신 + 세션 유지.
    /// `URLError`(네트워크 단절/타임아웃), 5xx, 4xx 기타 모두 세션 보존.
    func refreshUser() async {
        guard let token else { return }
        do {
            let (rolledToken, user) = try await api.me(token: token)
            // Apple 로그인 사용자라면 기존에 보관 중이던 appleUserId 가 유실되지 않도록
            // merge 한다. (백엔드가 `apple_user_id` 를 빈 채로 반환하는 경우 대비.)
            var merged = user
            if merged.appleUserId.nilIfBlank == nil,
               let prev = session?.user.appleUserId, !prev.isEmpty {
                merged.appleUserId = prev
            }
            // **rolling refresh** — 서버가 준 새 토큰으로 갈아 끼운다. 이걸 빠뜨리면 최초
            // 발급 토큰이 90일 뒤 죽고, 조용히 로그아웃된 상태로 소유자 게이트에 걸려
            // 알람이 사라진다. 서버가 재발급에 실패하면 token 키가 빠져 오므로 그때는 유지.
            let nextToken = rolledToken?.nilIfBlank ?? token
            let nextSession = AuthSession(token: nextToken, user: merged)
            try KeychainStore.saveSession(nextSession)
            session = nextSession
            // 탈퇴 유예 상태 반영 — pending_deletion 이면 RootView 가 복구 화면으로 게이팅.
            // Android `MainViewModel.checkAccountStatus()` 와 동등.
            pendingDeletion = merged.isPendingDeletion
            lastNetworkError = nil
        } catch let apiError as APIError {
            switch apiError {
            case .server(let status, _, _):
                if status == 401 {
                    signOut(message: "세션이 만료됐어요. 다시 로그인해 주세요.")
                } else if status == 403 {
                    // 권한 박탈 — 세션은 유지하되 사용자에게 알림
                    lastNetworkError = "이 계정으로는 접근할 수 없는 기능이 있어요."
                } else {
                    // 5xx, 4xx 기타 오류는 세션을 유지하되 영어 서버 메시지를 그대로 노출하지 않는다.
                    lastNetworkError = userFacingErrorMessage(
                        apiError,
                        fallback: "서버에 일시적으로 연결할 수 없어요."
                    )
                }
            case .invalidResponse:
                lastNetworkError = "서버 응답을 해석하지 못했어요."
            }
        } catch is URLError {
            // 네트워크 끊김, 타임아웃 등 — 세션 보존
            lastNetworkError = "네트워크 연결을 확인해 주세요."
        } catch {
            // 알 수 없는 에러 — 보수적으로 세션 보존
            lastNetworkError = "잠시 후 다시 시도해 주세요."
        }
    }

    /// 어떤 API 요청이든 401 을 받으면 호출 — 세션 만료로 보고 강제 로그아웃.
    /// `AlarmTalkAPI` 의 401 알림 핸들러가 호출한다. 이미 로그아웃된 상태면 no-op 으로
    /// 두어 연발 401 이 단 한 번의 signOut 으로 수렴하게 한다.
    /// Android `MainViewModel.handleUnauthorized()` 의 `if (authSession == null) return` 과 동등.
    private func handleUnauthorized() {
        guard session != nil else { return }
        signOut(message: "세션이 만료됐어요. 다시 로그인해 주세요.")
    }

    /// 데이터 라우트가 403 CONSENT_REQUIRED 를 받았을 때. 세션은 유지한다(로그아웃하지 않음).
    ///
    /// 서버가 **민감 동의를 지목했으면**(`consent`) 가입 게이트가 아니라 그 동의만 받는
    /// 시트를 연다. 여기서 안내만 하고 끝내면, 가입 때 그 동의를 거절한 사람은 동의할
    /// 방법이 없어 같은 403 을 무한 반복한다 — `collect` 에도 안 담긴다(이미 '거절'로
    /// 답했으므로 서버는 다시 묻지 않는다).
    private func handleConsentRequired(consent: String?) {
        guard session != nil else { return }
        if let consent, Self.sensitiveConsentTypes.contains(consent) {
            if !consentSensitiveMissing.contains(consent) {
                consentSensitiveMissing.append(consent)
            }
            if pendingSensitiveConsent == nil {
                pendingSensitiveConsent = SensitiveConsentRequest(types: [consent])
            }
            return
        }
        needsConsent = true
        // ⚠ **무엇을 받아야 하는지 모르는 채로 게이트를 열지 않는다.** 상태 조회가 늦거나
        // 실패한 상태에서 이 403(일반 게이트, consent 필드 없음)이 먼저 오면 collect 가 비어
        // 화면에 항목이 하나도 안 그려지는데, 그 화면은 '필수 다 체크됨' 으로 판정돼 버튼이
        // 켜진다 → 사용자가 보지도 않은 동의가 기록된다. 채울 목록은 **가입 게이트가 요구하는
        // 전부**여야 한다(이 403 을 낸 미들웨어는 일반 3종만 보지만, 3종만 받고 닫으면
        // 국외 이전이 안 기록된 채 통과된다).
        if consentCollect.isEmpty {
            consentCollect = Self.signupRequiredConsentTypes
        }
    }

    /// Apple 자격 증명이 외부에서 revoke 되었을 때 — 강제 로그아웃.
    /// `credentialRevokedNotification` 핸들러가 호출한다.
    private func handleAppleCredentialRevoked() {
        // Apple 로그인 사용자가 아니라면 무시. (이메일/Google 사용자는 영향 없음.)
        guard session?.user.appleUserId.nilIfBlank != nil else { return }
        signOut(message: "Apple ID 로그인이 해제되었어요.")
    }

    /// 앱 foreground 진입 시 호출 — Apple credentialState 점검. Apple 로그인 사용자만.
    /// 이메일/Google 사용자는 즉시 return (no-op).
    func verifyAppleCredentialStateIfNeeded() async {
        guard let appleUserId = session?.user.appleUserId.nilIfBlank else { return }
        guard !isVerifyingAppleCredential else { return }
        isVerifyingAppleCredential = true
        defer { isVerifyingAppleCredential = false }

        do {
            let state = try await appleCredentialProvider.credentialState(forUserID: appleUserId)
            switch state {
            case .authorized:
                // OK — 정상 세션
                return
            case .revoked, .notFound:
                signOut(message: "Apple ID 로그인이 더 이상 유효하지 않아요. 다시 로그인해 주세요.")
            case .transferred:
                // iCloud 가족 공유로 디바이스가 다른 사용자에게 이전 — 안내만, 세션 유지
                lastNetworkError = "다른 기기로 이전된 Apple ID 입니다. 다시 로그인해 주세요."
            @unknown default:
                return
            }
        } catch {
            // credentialState 조회 실패(드물게 시스템 오류) — 세션 보존
            lastNetworkError = "Apple 로그인 상태를 확인하지 못했어요."
        }
    }

    func updateProfile(
        name: String? = nil,
        allowFamilyAlarms: Bool? = nil,
        quietWindows: [FamilyAlarmQuietWindow]? = nil,
        dynamicPromptSettings: DynamicPromptSettings? = nil
    ) async {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        let normalizedQuietWindows = quietWindows.map(Self.normalizedQuietWindows)
        if let normalizedQuietWindows,
           normalizedQuietWindows.contains(where: { !Self.isValidTimeText($0.start) || !Self.isValidTimeText($0.end) }) {
            statusMessage = "시간은 HH:mm 형식으로 입력해 주세요."
            return
        }
        let firstQuietWindow = normalizedQuietWindows?.first
            ?? (quietWindows == nil ? nil : Self.defaultFamilyAlarmQuietWindow)
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.updateProfile(
                UpdateProfileRequest(
                    name: name,
                    allowFamilyAlarms: allowFamilyAlarms,
                    familyAlarmQuietDays: firstQuietWindow?.days,
                    familyAlarmQuietStart: firstQuietWindow?.start,
                    familyAlarmQuietEnd: firstQuietWindow?.end,
                    familyAlarmQuietWindows: normalizedQuietWindows,
                    dynamicPromptSettings: dynamicPromptSettings
                ),
                token: token
            )
            await refreshUser()
            statusMessage = "프로필을 저장했어요."
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "프로필을 저장하지 못했어요")
        }
    }

    private static let defaultFamilyAlarmQuietWindow = FamilyAlarmQuietWindow(
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "18:30"
    )

    private static func normalizedQuietWindows(_ windows: [FamilyAlarmQuietWindow]) -> [FamilyAlarmQuietWindow] {
        Array(
            windows
                .map { window in
                    FamilyAlarmQuietWindow(
                        days: Array(Set(window.days.filter { (0...6).contains($0) })).sorted(),
                        start: window.start,
                        end: window.end
                    )
                }
                .filter { !$0.days.isEmpty }
                .prefix(8)
        )
    }

    private static func isValidTimeText(_ value: String) -> Bool {
        value.range(
            of: #"^([01]\d|2[0-3]):[0-5]\d$"#,
            options: .regularExpression
        ) != nil
    }

    func deleteAccount() async {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        let currentUserID = session?.user.id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.deleteAccount(token: token)
            if let currentUserID, !currentUserID.isEmpty {
                accessSnapshotStore.clear(userID: currentUserID)
                DefaultVoicePreferenceStore().clear(userID: currentUserID)
                DynamicPromptPreferenceStore().clear(userID: currentUserID)
            }
            signOut(message: "회원 탈퇴가 완료됐어요.")
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "회원 탈퇴에 실패했어요")
        }
    }

    /// 30일 유예 탈퇴 신청. 즉시 삭제(`deleteAccount`) 대신 유예 상태로 전환하고
    /// 로그아웃 처리한다. 유예 기간 내 다시 로그인해 `cancelAccountDeletion` 으로 복구 가능.
    /// Android `MainViewModel.requestAccountDeletion()`.
    func requestAccountDeletion() async {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        let currentUserID = session?.user.id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.requestAccountDeletion(token: token)
            if let currentUserID, !currentUserID.isEmpty {
                accessSnapshotStore.clear(userID: currentUserID)
                DefaultVoicePreferenceStore().clear(userID: currentUserID)
                DynamicPromptPreferenceStore().clear(userID: currentUserID)
            }
            signOut(message: "회원 탈퇴가 접수됐어요. 30일 안에 다시 로그인하면 취소할 수 있어요.")
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "회원 탈퇴 신청에 실패했어요")
        }
    }

    /// 유예 기간 내 탈퇴 철회 → 계정 복구. 성공 시 `pendingDeletion` 을 내려 정상 진입.
    /// Android `MainViewModel.cancelAccountDeletion()`.
    func cancelAccountDeletion() async {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.cancelAccountDeletion(token: token)
            pendingDeletion = false
            statusMessage = "회원 탈퇴를 취소했어요. 계정이 복구됐어요."
        } catch {
            statusMessage = userFacingErrorMessage(error, fallback: "탈퇴 취소에 실패했어요. 다시 시도해 주세요")
        }
    }

    /// 로그인 후 필수 약관 동의 여부를 서버에 확인한다. 미동의면 `needsConsent=true` 로
    /// 두어 RootView 가 동의 화면을 띄운다. 네트워크 실패 시 앱 진입을 막지 않는다.
    /// Android `MainViewModel.checkConsentStatus()`.
    func checkConsentStatus() async {
        guard let token else { return }
        do {
            let status = try await api.consentStatus(token: token)
            needsConsent = status.needsConsent
            consentNeedsCollection = status.needsCollection
            // 이 앱 버전이 그릴 수 있는 유형만 남긴다. 서버가 새 유형을 먼저 추가한 구간에서
            // **보여주지 않은 동의를 기록하는 것**을 막는다(그 유형이 필수면 화면이 CTA 를 막는다).
            consentCollect = status.collect.filter { Self.knownConsentTypes.contains($0) }
            consentOptional = status.optional
            consentSensitiveMissing = status.sensitiveMissing
            consentIsReconsent = status.hasPriorConsent
            // 서버가 게시 중인 문서 버전. 409 를 만났을 때 "업데이트하면 풀리는가" 판단에 쓴다.
            serverPolicyVersionHint = status.policyVersion
        } catch {
            // 동의 상태 확인 실패 시 앱 진입을 막지 않는다(보수적으로 false).
            needsConsent = false
            consentNeedsCollection = false
            consentCollect = []
        }
    }

    /// 동의 항목마다 동봉하는 정책 버전. **손으로 관리하지 않는다** —
    /// 빌드 시 `docs/legal` 에서 뽑은 값(`scripts/generate-legal-version.sh`)을 그대로 쓴다.
    ///
    /// 예전에는 "3" 이 리터럴로 박혀 있어 문서가 4·5 로 올라가는 동안 그대로 남아 있었다.
    /// (서버는 항목별 version 을 받기만 하고 무시하므로 기록이 깨지진 않았지만, 기록에
    ///  남는 값이 사실과 달랐다. 요청 단위 `document_version` 은 서버가 실제로 검증한다.)
    static var currentPolicyVersion: String { LegalPolicy.bundledVersion }

    /// 동의 기록 요청을 만든다.
    ///
    /// ⚠ **`collect` 에 든 유형만 담는다.** 예전에는 6종을 항상 보냈는데, 그러면 재동의
    /// 화면에서 묻지도 않은 marketing 이 화면 초기값(false)으로 제출돼 **기존 마케팅 동의가
    /// 조용히 철회된다.**
    ///
    /// - 필수 유형은 화면을 통과한 시점에 이미 체크됐으므로 `true`.
    /// - 선택 유형은 사용자가 실제로 체크한 것만 `true`.
    /// - 구버전 서버(`optional` 없음) 폴백은 **화면과 같은 기준**이어야 한다 — 여기만 다르면
    ///   화면에서 선택으로 그린 항목이 제출에서 필수로 둔갑해 동의로 기록된다.
    static func makeConsentsRequest(
        collect: [String],
        optional: [String],
        agreedOptional: Set<String>,
        version: String = currentPolicyVersion
    ) -> RecordConsentsRequest {
        let optionalTypes = Set(optional.isEmpty ? ["marketing"] : optional)
        let types = collect.filter { knownConsentTypes.contains($0) }
        return RecordConsentsRequest(consents: types.map { type in
            ConsentItemRequest(
                type: type,
                agreed: !optionalTypes.contains(type) || agreedOptional.contains(type),
                version: version
            )
        })
    }

    /// 동의 기록이 '문서 버전 불일치' 로 거부됐을 때의 처리. 처리했으면 true.
    ///
    /// Android `handleConsentVersionMismatch` 와 같은 판단이다:
    ///  - **서버가 앞서면**(문서가 개정됐는데 이 빌드가 옛 본문을 싣고 있으면) 사용자가 할 수
    ///    있는 일은 업데이트뿐이다 → 업데이트 게이트로 보낸다.
    ///  - **이 빌드가 앞서면**(백엔드 배포가 아직 안 끝난 구간) 업데이트해도 안 풀린다.
    ///    그때 "업데이트하세요" 라고 하면 거짓말이므로 일반 실패 메시지만 낸다.
    private func handleConsentVersionMismatch(_ error: Error) -> Bool {
        guard case let APIError.server(status, _, errorCode) = error else { return false }
        let isVersionError =
            errorCode == "POLICY_VERSION_MISMATCH"
            || errorCode == "DOCUMENT_VERSION_REQUIRED"
            || status == 409
        guard isVersionError else { return false }

        // 서버가 게시 중인 버전을 알 수 없으면(구 응답 등) 보수적으로 업데이트 게이트.
        let bundled = Int(LegalPolicy.bundledVersion)
        let server = serverPolicyVersionHint.flatMap(Int.init)
        if let server, let bundled, server <= bundled {
            statusMessage = "동의 기록에 실패했어요. 잠시 후 다시 시도해 주세요"
            return true
        }
        consentUnsupported = true
        return true
    }

    /// 마지막 `GET /user/consents/status` 가 알려 준 서버의 게시 버전. 위 판별에만 쓴다.
    private var serverPolicyVersionHint: String?

    /// 동의 화면 제출. 성공 시 `needsConsent` 를 내려 정상 진입. Android `MainViewModel.submitConsents()`.
    func submitConsents(agreedOptional: Set<String>) async {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        // 이 요청을 시작한 계정. 응답이 오는 사이 401 로 세션이 끊기고 다른 계정이 로그인해도
        // 이 continuation 은 살아 있다 — 앞 계정의 성공으로 뒤 계정의 동의 상태를 비우면
        // 뒤 계정이 받아야 할 재수집·민감 동의를 건너뛴다.
        let ownerUserID = session?.user.id
        // collect 가 비어 있는 건 status 응답을 못 받은 경우다 — 그때만 가입 필수로 폴백한다.
        let collect = consentCollect.isEmpty ? Self.signupRequiredConsentTypes : consentCollect
        let request = Self.makeConsentsRequest(
            collect: collect,
            optional: consentOptional,
            agreedOptional: agreedOptional
        )
        guard !request.consents.isEmpty else {
            // 이 앱이 그릴 수 있는 유형이 하나도 없다 = 서버가 앞서 있다. 업데이트가 답이다.
            statusMessage = "앱을 업데이트해야 동의를 진행할 수 있어요."
            return
        }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.recordConsents(request, token: token)
            // 화면 상태는 **현재 세션이 그대로일 때만** 건드린다(위 ownerUserID 주석).
            guard session?.user.id == ownerUserID else { return }
            needsConsent = false
            // 방금 받은 유형은 더 받을 게 없다. 비우지 않으면 showConsentScreen 이 계속 true 라
            // 화면이 닫히지 않는다.
            consentCollect = []
            consentOptional = []
            consentNeedsCollection = false
            // 방금 **동의로** 기록한 민감 유형은 서버 상태와 맞춘다 — 안 지우면 목소리 등록
            // 화면이 이미 받은 동의를 또 묻는다. 거절한 유형은 그대로 남아 그때 다시 묻는다.
            consentSensitiveMissing = consentSensitiveMissing.filter { !agreedOptional.contains($0) }
            statusMessage = "동의가 완료됐어요"
        } catch {
            if handleConsentVersionMismatch(error) { return }
            statusMessage = userFacingErrorMessage(error, fallback: "동의 기록에 실패했어요. 다시 시도해 주세요")
        }
    }

    /// 민감 동의 시트 제출. 시트가 물어본 유형만 `agreed: true` 로 기록한다.
    ///
    /// 성공하면 `consentSensitiveMissing` 에서 그 유형을 지운다 — 안 지우면 목소리 등록
    /// 화면이 이미 받은 동의를 또 묻는다.
    @discardableResult
    func submitSensitiveConsents(types: [String]) async -> Bool {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return false
        }
        let ownerUserID = session?.user.id
        let recordable = types.filter { Self.knownConsentTypes.contains($0) }
        guard !recordable.isEmpty else {
            statusMessage = "앱을 업데이트해야 동의를 진행할 수 있어요."
            return false
        }
        guard !isBusy else { return false }
        isBusy = true
        defer { isBusy = false }

        let version = Self.currentPolicyVersion
        let request = RecordConsentsRequest(
            consents: recordable.map { ConsentItemRequest(type: $0, agreed: true, version: version) }
        )
        do {
            _ = try await api.recordConsents(request, token: token)
            guard session?.user.id == ownerUserID else { return false }
            consentSensitiveMissing.removeAll { recordable.contains($0) }
            pendingSensitiveConsent = nil
            return true
        } catch {
            if handleConsentVersionMismatch(error) { return false }
            statusMessage = userFacingErrorMessage(error, fallback: "동의 기록에 실패했어요. 다시 시도해 주세요")
            return false
        }
    }

    // MARK: - 마케팅(광고성 정보 수신) 동의

    /// 설정 화면 진입 시 현재 마케팅 동의 상태를 서버에서 읽어 토글에 반영한다.
    /// `GET /user/consents` 는 유형별 최신값을 돌려주므로 marketing 의 agreed 를 그대로 쓴다.
    /// 실패해도 앱을 막지 않고 `marketingConsentLoadFailed` 로만 표시한다.
    /// Android `MainViewModel.loadMarketingConsent`.
    func loadMarketingConsent() async {
        guard let token else { return }
        marketingConsentLoadFailed = false
        do {
            // listConsents 는 AuthAPIProviding 프로토콜 밖이므로(테스트 mock 불필요)
            // requestEmailVerification 과 동일하게 공유 인스턴스로 직접 호출한다.
            let response = try await AlarmTalkAPI.shared.listConsents(token: token)
            marketingConsentAgreed = response.consents.first { $0.consentType == "marketing" }?.agreed ?? false
        } catch {
            marketingConsentLoadFailed = true
        }
    }

    /// 설정의 '광고성 정보 수신' 토글 변경. marketing 동의를 현재 정책 버전으로 재기록한다
    /// (누적 저장, 최신값이 현재 상태). 낙관적으로 즉시 반영하고, 실패하면 직전 값으로
    /// 되돌린다. Android `MainViewModel.updateMarketingConsent`.
    func updateMarketingConsent(_ agreed: Bool) async {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        let previous = marketingConsentAgreed
        marketingConsentAgreed = agreed
        do {
            _ = try await api.recordConsents(
                RecordConsentsRequest(consents: [
                    ConsentItemRequest(type: "marketing", agreed: agreed, version: Self.currentPolicyVersion),
                ]),
                token: token
            )
            statusMessage = agreed ? "마케팅 정보 수신에 동의했어요." : "마케팅 정보 수신 동의를 해제했어요."
        } catch {
            marketingConsentAgreed = previous
            if handleConsentVersionMismatch(error) { return }
            statusMessage = userFacingErrorMessage(error, fallback: "마케팅 수신 설정을 변경하지 못했어요")
        }
    }

    func signOut(message: String? = nil) {
        // W2: 로컬 세션을 지우기 전에 서버 토큰을 폐기(token_epoch 상향)한다.
        // best-effort — 네트워크 실패/만료 토큰이어도 로그아웃은 그대로 진행한다.
        // 이미 폐기/만료된 토큰으로 호출되는 경로(401 핸들러 등)에서도 안전하다.
        if let revokeToken = session?.token.nilIfBlank {
            let api = self.api
            Task.detached {
                try? await api.logout(token: revokeToken)
            }
        }
        KeychainStore.deleteSession()
        session = nil
        pendingDeletion = false
        needsConsent = false
        // 동의 수집 상태도 계정별이다 — 앞 계정의 '받을 게 없음' 이 새 계정에 새면
        // 새 계정이 받아야 할 재수집·민감 동의를 건너뛴다.
        consentNeedsCollection = false
        consentCollect = []
        consentOptional = []
        consentSensitiveMissing = []
        consentIsReconsent = false
        // 사용자 범위 상태 초기화 — 계정 전환 시 옛 사용자 값이 새지 않게 한다.
        // Android `clearUserScopedRemoteState` 와 동등.
        passwordResetCodeSentTo = nil
        marketingConsentAgreed = false
        marketingConsentLoadFailed = false
        statusMessage = message
        lastNetworkError = nil
    }

    private static func displayName(from components: PersonNameComponents) -> String? {
        let value = PersonNameComponentsFormatter().string(from: components)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }


    // MARK: - Testing support
    //
    // 단위 테스트가 Keychain 을 거치지 않고 session 을 직접 채우기 위한 internal 진입점.
    // 운영 코드(production)는 이 메서드를 호출하지 않는다. `@testable import AlarmTalk`
    // 에서만 접근 가능하도록 internal 가시성을 유지.
    func _setSessionForTesting(_ value: AuthSession?) {
        session = value
    }
}

// MARK: - Helper for blank-check on Optional<String>
//
// `AlarmTalkAPI.swift` 의 fileprivate `nilIfBlank` 와 동일 시맨틱을 내부 노출로
// 재선언한다. 모듈 내 다른 파일이 import 없이 쓸 수 있도록 internal 가시성.

