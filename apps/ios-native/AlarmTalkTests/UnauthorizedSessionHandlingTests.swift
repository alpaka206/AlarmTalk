import Foundation
import XCTest
@testable import AlarmTalk

/// **죽은 토큰으로 회차를 끝까지 밀지 않는다** (2026-09-21 Sentry ALARMTALK-IOS-2, 700건).
///
/// 이벤트 수를 실제로 만든 자리는 여기다 — 401 은 후보마다 똑같이 떨어지는데 루프가
/// 끊기지 않아, 미동기 알람이 N개면 한 회차가 같은 보고를 N건 쏟았다. 중앙 401 처리기가
/// 세션을 끊는 것은 알림 디바운스 뒤라 그 사이 루프는 이미 다 돈다.
@MainActor
final class PushSyncUnauthorizedCycleTests: XCTestCase {
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

    /// 401 이면 그 건만 실패로 남기고 회차를 끊는다. 계정 변경 `break` 와 같은 뜻 —
    /// **지금 이 회차로는 못 올린다.** 남은 건은 syncState 가 그대로라 다음 회차에 다시 걸린다.
    func test_토큰이_죽으면_남은_후보를_계속_밀지_않는다() async throws {
        let store = makeStore(ids: ["a", "b", "c"])
        let writer = FailingAlarmWriter(
            error: APIError.server(status: 401, message: "unauthorized", errorCode: "AUTH_USER_NOT_FOUND")
        )
        let push = RemoteAlarmPushSync(api: writer, store: store, auth: makeAuth())

        let result = try await push.runOnce()

        XCTAssertEqual(writer.writes, 1, "401 을 받고도 남은 후보를 밀면 같은 보고가 후보 수만큼 쌓인다")
        XCTAssertEqual(result, .init(attempted: 1, created: 0, updated: 0, failed: 1))
        // 시도하지도 않은 행을 '동기화 실패' 로 낙인찍지 않는다.
        XCTAssertEqual(store.alarms.filter { $0.syncStateEnum == .syncFailed }.count, 1)
        XCTAssertEqual(store.alarms.filter { $0.syncStateEnum == .localOnly }.count, 2)
    }

    /// ⚠ **끊는 것은 401 뿐이다.** 한 건이 5xx 로 실패했다고 나머지를 접으면, 서버가 잠깐
    /// 흔들릴 때마다 뒤쪽 알람이 통째로 다음 회차로 밀린다 — 회차마다 첫 건만 시도하는
    /// 앱이 된다.
    func test_다른_실패는_회차를_끊지_않는다() async throws {
        let store = makeStore(ids: ["a", "b", "c"])
        let writer = FailingAlarmWriter(error: APIError.server(status: 500, message: "boom"))
        let push = RemoteAlarmPushSync(api: writer, store: store, auth: makeAuth())

        let result = try await push.runOnce()

        XCTAssertEqual(writer.writes, 3)
        XCTAssertEqual(result, .init(attempted: 3, created: 0, updated: 0, failed: 3))
    }

    // MARK: - Helpers

    private func makeStore(ids: [String]) -> LocalAlarmStore {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("push-401-\(UUID()).json")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        for (offset, id) in ids.enumerated() {
            var row = LocalAlarmRecord(id: id, label: id, hour: 8 + offset, minute: 0, fireAtMillis: 1)
            row.ownerUserId = "owner"
            row.syncState = AlarmSyncState.localOnly.rawValue
            store.upsert(row)
        }
        return store
    }

    private func makeAuth() -> AuthViewModel {
        let auth = AuthViewModel()
        auth._setSessionForTesting(
            AuthSession(token: "token", user: AuthUser(id: "owner", email: "owner@example.test"))
        )
        return auth
    }
}

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

/// 어떤 쓰기든 같은 오류로 떨어지는 writer. 죽은 토큰이 만드는 상황 그대로다.
@MainActor
private final class FailingAlarmWriter: RemoteAlarmWriting {
    private let error: Error
    private(set) var writes = 0

    init(error: Error) { self.error = error }

    func createAlarm(_ body: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm {
        writes += 1
        throw error
    }

    func updateAlarm(id: String, requestBody: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm {
        writes += 1
        throw error
    }
}

/// `me(token:)` 만 정해진 오류로 떨어뜨리는 최소 stub. 나머지는 이 테스트가 부르지 않는다.
private final class MeFailingAPI: AuthAPIProviding, @unchecked Sendable {
    private let error: APIError

    init(error: APIError) { self.error = error }

    func me(token: String) async throws -> (token: String?, user: AuthUser) { throw error }
    func updateProfile(_ requestBody: UpdateProfileRequest, token: String) async throws -> UpdateProfileResponse {
        throw APIError.invalidResponse
    }
    func deleteAccount(token: String) async throws -> DeleteAccountResponse { throw APIError.invalidResponse }
    func requestAccountDeletion(token: String) async throws -> AccountDeletionResponse { throw APIError.invalidResponse }
    func cancelAccountDeletion(token: String) async throws -> CancelDeletionResponse { throw APIError.invalidResponse }
    func consentStatus(token: String) async throws -> ConsentStatusResponse { throw APIError.invalidResponse }
    func recordConsents(_ requestBody: RecordConsentsRequest, token: String) async throws -> RecordConsentsResponse {
        throw APIError.invalidResponse
    }
    func logout(token: String) async throws { throw APIError.invalidResponse }
}
