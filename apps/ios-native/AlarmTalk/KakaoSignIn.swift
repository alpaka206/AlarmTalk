import Foundation
@preconcurrency import KakaoSDKAuth
@preconcurrency import KakaoSDKCommon
@preconcurrency import KakaoSDKUser

/// 카카오 로그인(2026-11-14) — 안드로이드 `ui/auth/KakaoLogin.kt` 의 짝. 서버 규칙은
/// `docs/spec/session-and-auth.md` 「카카오 로그인」: 앱은 카카오 SDK 가 준 **액세스 토큰**을 `POST /auth/kakao` 에 넘길
/// 뿐이고, 계정을 찾고 붙이는 판정은 전부 서버가 한다.
///
/// 순서는 카카오톡 → 실패하면 카카오계정(웹)이다. ⚠ **설치 여부를 먼저 묻지 않는다** — 그 함수
/// (`UserApi.isKakaoTalkLoginAvailable`)는 SDK 2.30 에서 폐기 예정이고, 카카오는 카카오톡 로그인을 바로 부르고 실패를
/// 받으라고 한다(카카오톡이 없으면 SDK 가 `NotSupported` 로 돌려준다). ⚠ **사용자가 취소했으면 계정 로그인을 다시
/// 띄우지 않는다**(카카오 가이드 — 의도적인 취소).
enum KakaoSignIn {
    enum Outcome: Sendable, Equatable {
        case token(String)
        case cancelled
    }

    enum Failure: Error {
        /// 앱 키가 없어 SDK 를 켜지 못했다(빌드 설정 `KAKAO_NATIVE_APP_KEY`).
        case notConfigured
        /// SDK 가 성공이라면서 토큰을 주지 않았다.
        case noAccessToken
    }

    /// Info.plist 의 `KAKAO_NATIVE_APP_KEY`(값은 `project.yml`). 네이티브 앱 키는 앱에 실리는 공개 식별자다 — 카카오
    /// 콘솔에 등록된 번들 ID 로 지킨다.
    nonisolated static var nativeAppKey: String? {
        let raw = Bundle.main.object(forInfoDictionaryKey: "KAKAO_NATIVE_APP_KEY") as? String
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    @MainActor private static var isConfigured = false

    /// 앱 시작 때 한 번(`PushAppDelegate` 의 `didFinishLaunchingWithOptions`). 네트워크를 쓰지 않는 설정 저장뿐이다.
    @MainActor
    static func configure() {
        guard !isConfigured, let appKey = nativeAppKey else { return }
        KakaoSDK.initSDK(appKey: appKey)
        isConfigured = true
    }

    /// 카카오톡이 로그인 뒤 우리 앱으로 돌려보낸 주소(`kakao<앱 키>://oauth…`)면 SDK 에 넘긴다. 처리했으면 true.
    @MainActor
    @discardableResult
    static func handleOpenURL(_ url: URL) -> Bool {
        guard isConfigured, AuthApi.isKakaoTalkLoginUrl(url) else { return false }
        return AuthController.handleOpenUrl(url: url)
    }

    @MainActor
    static func signIn() async throws -> Outcome {
        guard isConfigured else { throw Failure.notConfigured }
        do {
            return try await awaitLogin { completion in
                UserApi.shared.loginWithKakaoTalk(completion: completion)
            }
        } catch {
            // 카카오톡이 없거나 거기서 실패했다(연결된 카카오계정이 없음 등) — 카카오계정으로 넘어간다. 취소는 여기 오지
            // 않는다(`awaitLogin` 이 `.cancelled` 로 돌려준다).
        }
        return try await awaitLogin { completion in
            // ⚠ `loginHint:` 를 일부러 적는다 — 이름표 없이 부르면 카카오싱크 전용 같은 이름의 함수와 겹쳐 모호해진다.
            UserApi.shared.loginWithKakaoAccount(loginHint: nil, completion: completion)
        }
    }

    /// 우리 로그아웃·탈퇴 신청·자동 만료로 세션이 끝날 때 이 기기의 카카오 토큰도 버린다. 카카오 서버 호출이 실패해도
    /// SDK 는 기기의 토큰을 지운다 — 결과를 보지 않는다.
    @MainActor
    static func discardDeviceToken() {
        guard isConfigured, AuthApi.hasToken() else { return }
        UserApi.shared.logout { @Sendable _ in }
    }

    /// ⚠ **콜백을 `@Sendable` 로 못 박는다**(CLAUDE.md 「시스템이 큐를 정하는 콜백에 메인 액터 클로저를 넘기지 않는다」).
    /// SDK 는 Swift 6 표기가 없어, 표기 없는 클로저는 이 메인 액터 함수의 격리를 물려받고 다른 큐에서 불리는 순간
    /// 트랩한다. 안에서는 continuation 만 깨운다.
    @MainActor
    private static func awaitLogin(
        _ start: (@escaping @Sendable (OAuthToken?, Error?) -> Void) -> Void
    ) async throws -> Outcome {
        try await withCheckedThrowingContinuation { continuation in
            start { @Sendable token, error in
                if let error {
                    if isCancel(error) {
                        continuation.resume(returning: .cancelled)
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }
                guard let accessToken = token?.accessToken, !accessToken.isEmpty else {
                    continuation.resume(throwing: Failure.noAccessToken)
                    return
                }
                continuation.resume(returning: .token(accessToken))
            }
        }
    }

    nonisolated static func isCancel(_ error: Error) -> Bool {
        guard let sdkError = error as? SdkError, case .ClientFailed(let reason, _) = sdkError else { return false }
        return reason == .Cancelled
    }
}
