import AuthenticationServices
import Foundation

/// `AuthViewModel` 이 의존하는 API 시그니처. 단위 테스트에서 mock 으로 주입하기 위해
/// protocol 로 분리한다. `VoiceAlarmAPI` 가 conform.
/// MainActor 제약을 두지 않아 `VoiceAlarmAPI` (non-isolated) 가 그대로 만족.
protocol AuthAPIProviding: AnyObject {
    func me(token: String) async throws -> AuthUser
    func updateProfile(_ requestBody: UpdateProfileRequest, token: String) async throws -> UpdateProfileResponse
    func deleteAccount(token: String) async throws -> DeleteAccountResponse
}

extension VoiceAlarmAPI: AuthAPIProviding {}

/// Apple 자격 증명 상태를 조회하는 의존성. 단위 테스트에서 mock 가능.
/// 실제 구현은 `ASAuthorizationAppleIDProvider.getCredentialState(forUserID:)` 를 호출.
protocol AppleCredentialStateProviding {
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

    private let api: AuthAPIProviding
    private let appleCredentialProvider: AppleCredentialStateProviding
    private let accessSnapshotStore: AccessSnapshotStore
    /// `addObserver(forName:object:queue:using:)` 가 반환한 토큰. deinit 시
    /// 명시 해제해야 NotificationCenter 내부 strong reference 가 풀린다.
    /// `nonisolated(unsafe)` — deinit 은 nonisolated 컨텍스트인데 본 프로퍼티는
    /// init/deinit 외에서 건드리지 않으므로 동시성 race 없음.
    private nonisolated(unsafe) var appleRevokeObserver: NSObjectProtocol?
    /// `verifyAppleCredentialStateIfNeeded` 가 같은 사용자에 대해 중복 동시 호출되는
    /// 일을 막는다. SwiftUI scenePhase 가 짧은 시간 안에 두 번 .active 가 되는
    /// 경우(예: 시스템 알림창 → 복귀) 가 있어 직렬화.
    private var isVerifyingAppleCredential = false

    init(
        api: AuthAPIProviding = VoiceAlarmAPI.shared,
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
    }

    deinit {
        // nonisolated deinit — main-actor isolated property 에는 접근하지 않는다.
        // appleRevokeObserver 는 nonisolated(unsafe) 이라 안전하게 읽을 수 있다.
        if let token = appleRevokeObserver {
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
        statusMessage = "Apple 로그인에 실패했어요: \(error.localizedDescription)"
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
            var nextSession = try await VoiceAlarmAPI.shared.loginWithApple(
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
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    // MARK: - Phase 3-C3: 이메일/비밀번호 + 인증코드

    /// 이메일 인증 코드를 발송한다. UI 는 statusMessage 를 받아 상태 메시지로 노출.
    func requestEmailVerification(email: String) async {
        guard !isBusy, !email.isEmpty else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await VoiceAlarmAPI.shared.requestEmailVerification(email: email)
            statusMessage = "인증 코드를 보냈어요. 메일을 확인해 주세요."
        } catch {
            statusMessage = error.localizedDescription
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
            let response = try await VoiceAlarmAPI.shared.verifyEmailCode(email: email, code: code)
            if response.verified == false {
                statusMessage = "인증 코드가 일치하지 않아요."
                return false
            }
            statusMessage = "이메일 인증이 완료됐어요."
            return true
        } catch {
            statusMessage = error.localizedDescription
            return false
        }
    }

    /// 이메일/비밀번호 로그인.
    func loginWithEmail(email: String, password: String) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let nextSession = try await VoiceAlarmAPI.shared.loginWithEmail(email: email, password: password)
            try KeychainStore.saveSession(nextSession)
            session = nextSession
            statusMessage = "로그인됐어요."
            lastNetworkError = nil
        } catch {
            statusMessage = error.localizedDescription
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
            let nextSession = try await VoiceAlarmAPI.shared.register(
                email: email,
                password: password,
                name: name,
                verificationCode: verificationCode
            )
            try KeychainStore.saveSession(nextSession)
            session = nextSession
            statusMessage = "환영해요! 계정이 만들어졌어요."
            lastNetworkError = nil
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    /// 401 만 세션 만료로 처리하고, 그 외는 lastNetworkError 만 갱신 + 세션 유지.
    /// `URLError`(네트워크 단절/타임아웃), 5xx, 4xx 기타 모두 세션 보존.
    func refreshUser() async {
        guard let token else { return }
        do {
            let user = try await api.me(token: token)
            // Apple 로그인 사용자라면 기존에 보관 중이던 appleUserId 가 유실되지 않도록
            // merge 한다. (백엔드가 `apple_user_id` 를 빈 채로 반환하는 경우 대비.)
            var merged = user
            if merged.appleUserId.nilIfBlank == nil,
               let prev = session?.user.appleUserId, !prev.isEmpty {
                merged.appleUserId = prev
            }
            let nextSession = AuthSession(token: token, user: merged)
            try KeychainStore.saveSession(nextSession)
            session = nextSession
            lastNetworkError = nil
        } catch let apiError as APIError {
            switch apiError {
            case .server(let status, let message, _):
                if status == 401 {
                    signOut(message: "세션이 만료됐어요. 다시 로그인해 주세요.")
                } else if status == 403 {
                    // 권한 박탈 — 세션은 유지하되 사용자에게 알림
                    lastNetworkError = "이 계정으로는 접근할 수 없는 기능이 있어요."
                } else {
                    // 5xx, 4xx 기타 — 세션 보존, 일시 오류 표시
                    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
                    lastNetworkError = trimmed.isEmpty
                        ? "서버에 일시적으로 연결할 수 없어요."
                        : trimmed
                }
            case .invalidResponse:
                lastNetworkError = "서버 응답을 해석하지 못했어요."
            }
        } catch let urlError as URLError {
            // 네트워크 끊김, 타임아웃 등 — 세션 보존
            _ = urlError // 추후 카테고리별 메시지 분기를 위해 keep
            lastNetworkError = "네트워크 연결을 확인해 주세요."
        } catch {
            // 알 수 없는 에러 — 보수적으로 세션 보존
            lastNetworkError = "잠시 후 다시 시도해 주세요."
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
            statusMessage = error.localizedDescription
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
            }
            signOut(message: "회원 탈퇴가 완료됐어요.")
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func signOut(message: String? = nil) {
        KeychainStore.deleteSession()
        session = nil
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
    // 운영 코드(production)는 이 메서드를 호출하지 않는다. `@testable import VoiceAlarm`
    // 에서만 접근 가능하도록 internal 가시성을 유지.
    func _setSessionForTesting(_ value: AuthSession?) {
        session = value
    }
}

// MARK: - Helper for blank-check on Optional<String>
//
// `VoiceAlarmAPI.swift` 의 fileprivate `nilIfBlank` 와 동일 시맨틱을 내부 노출로
// 재선언한다. 모듈 내 다른 파일이 import 없이 쓸 수 있도록 internal 가시성.
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
