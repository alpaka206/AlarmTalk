import Foundation
import XCTest
@testable import AlarmTalk

/// **파기된 계정을 세션 건강검진이 잡는다.**
///
/// `GET /auth/me` 는 사용자 행이 없으면 **404 `AUTH_USER_NOT_FOUND`** 다
/// (`packages/backend/src/routes/auth.ts` 의 `auth.get('/me')`). 다른 라우트는 미들웨어가
/// 401 로 돌려주므로(`middleware/auth.ts`), 이 갈래를 놓치면 검진만 죽은 세션을 남긴다.
@MainActor
final class SessionHealthCheckDestroyedAccountTests: XCTestCase {
    override func setUp() {
        super.setUp()
        SessionExpiryStore.clear()
        PendingSignOutStore.removeAll()
    }

    override func tearDown() {
        SessionExpiryStore.clear()
        PendingSignOutStore.removeAll()
        super.tearDown()
    }

    func test_파기된_계정의_404는_401과_같은_갈래다() async {
        let api = MeFailingAPI(error: .server(status: 404, message: "User not found", errorCode: "AUTH_USER_NOT_FOUND"))
        let vm = AuthViewModel(api: api)
        vm._setSessionForTesting(makeSession())

        await vm.refreshUser()

        XCTAssertNil(vm.session, "계정이 없는데 세션을 들고 있으면 이후 요청이 전부 401 이 된다")
        XCTAssertEqual(vm.statusMessage, "세션이 만료됐어요. 다시 로그인해 주세요.")
    }

    /// ⚠ **404 전부가 아니라 그 코드일 때만이다.** 잘못된 베이스 URL·라우팅 실패도 404 라,
    /// 상태코드만 보고 끊으면 서버 설정 실수 한 번이 전체 로그아웃이 된다.
    func test_코드가_없는_404는_세션을_유지한다() async {
        let api = MeFailingAPI(error: .server(status: 404, message: "Not Found", errorCode: nil))
        let vm = AuthViewModel(api: api)
        vm._setSessionForTesting(makeSession())

        await vm.refreshUser()

        XCTAssertNotNil(vm.session)
        XCTAssertEqual(vm.lastNetworkError, "서버에 일시적으로 연결할 수 없어요.")
    }

    private func makeSession() -> AuthSession {
        AuthSession(token: "token", user: AuthUser(id: "user-1", email: "user@example.test"))
    }
}

// MARK: - Stubs

/// `me(token:)` 만 정해진 오류로 떨어뜨리는 최소 stub. 나머지는 이 테스트가 부르지 않는다.
private final class MeFailingAPI: AuthAPIProviding, @unchecked Sendable {
    private let error: APIError

    init(error: APIError) { self.error = error }

    func me(token: String) async throws -> (token: String?, user: AuthUser) { throw error }
    func updateProfile(_ requestBody: UpdateProfileRequest, token: String) async throws -> UpdateProfileResponse {
        throw APIError.invalidResponse
    }
    func requestAccountDeletion(token: String) async throws -> AccountDeletionResponse { throw APIError.invalidResponse }
    func consentStatus(token: String) async throws -> ConsentStatusResponse { throw APIError.invalidResponse }
    func recordConsents(_ requestBody: RecordConsentsRequest, token: String) async throws -> RecordConsentsResponse {
        throw APIError.invalidResponse
    }
    func listConsents(token: String) async throws -> ConsentListResponse { throw APIError.invalidResponse }
    func logout(token: String) async throws { throw APIError.invalidResponse }
}
