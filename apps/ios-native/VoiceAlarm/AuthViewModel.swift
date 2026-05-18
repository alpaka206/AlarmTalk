import AuthenticationServices
import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published var statusMessage: String?
    @Published var isBusy = false

    private let api: VoiceAlarmAPI

    init(api: VoiceAlarmAPI = .shared) {
        self.api = api
        session = KeychainStore.readSession()
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

    func handleAppleAuthorization(_ authorization: ASAuthorization) async {
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
            email: credential.email
        )
    }

    func handleAppleAuthorizationFailure(_ error: Error) {
        statusMessage = "Apple 로그인에 실패했어요: \(error.localizedDescription)"
    }

    func loginWithApple(idToken: String, name: String?, email: String?) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let nextSession = try await api.loginWithApple(idToken: idToken, name: name, email: email)
            try KeychainStore.saveSession(nextSession)
            session = nextSession
            statusMessage = "로그인됐어요."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func refreshUser() async {
        guard let token else { return }
        do {
            let user = try await api.me(token: token)
            let nextSession = AuthSession(token: token, user: user)
            try KeychainStore.saveSession(nextSession)
            session = nextSession
        } catch {
            signOut(message: "세션이 만료됐어요. 다시 로그인해 주세요.")
        }
    }

    func updateProfile(
        name: String? = nil,
        allowFamilyAlarms: Bool? = nil,
        quietWindows: [FamilyAlarmQuietWindow]? = nil
    ) async {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.updateProfile(
                UpdateProfileRequest(
                    name: name,
                    allowFamilyAlarms: allowFamilyAlarms,
                    familyAlarmQuietWindows: quietWindows
                ),
                token: token
            )
            await refreshUser()
            statusMessage = "프로필을 저장했어요."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func deleteAccount() async {
        guard let token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.deleteAccount(token: token)
            signOut(message: "회원 탈퇴가 완료됐어요.")
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func signOut(message: String? = nil) {
        KeychainStore.deleteSession()
        session = nil
        statusMessage = message
    }

    private static func displayName(from components: PersonNameComponents) -> String? {
        let value = PersonNameComponentsFormatter().string(from: components)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
