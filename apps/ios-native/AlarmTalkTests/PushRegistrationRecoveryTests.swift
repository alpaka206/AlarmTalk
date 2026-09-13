import Foundation
import XCTest
@testable import AlarmTalk

@MainActor
final class PushRegistrationRecoveryTests: XCTestCase {
    private let deviceToken = Data([0x01, 0xab])

    private func session(_ userID: String) -> AuthSession {
        AuthSession(token: "token-\(userID)", user: AuthUser(
            id: userID, email: "\(userID)@example.test", name: "Test", plan: "free"
        ))
    }

    private func withDefaults(_ body: (UserDefaults) async -> Void) async {
        let suite = "push-recovery-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        await body(defaults)
    }

    func test_lostUnregisterResponseStillForcesSameTokenUploadAfterRecovery() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            var apnsRequests = 0
            let push = PushNotificationCoordinator(api: api, defaults: defaults,
                requestAPNsToken: { apnsRequests += 1 })
            await push.registerToken(deviceToken, session: session("A"))
            await api.loseNextUnregisterResponse()
            let unregistered = await push.unregisterCurrentToken(authToken: "token-A", expectedOwnerUserID: "A")
            XCTAssertFalse(unregistered)
            let lost = await api.snapshot()
            XCTAssertNil(lost.binding, "서버는 지웠지만 클라는 응답을 못 받은 경우")

            await push.prepareAccountRecovery(userID: "A")
            push.start()
            await push.registerToken(deviceToken, session: session("A"))
            // 재등록 성공 뒤에는 다시 정상 중복 억제를 사용한다.
            await push.registerToken(deviceToken, session: session("A"))

            let result = await api.snapshot()
            XCTAssertEqual(apnsRequests, 1)
            XCTAssertEqual(result.events, ["register:token-A", "unregister:token-A", "register:token-A"])
            XCTAssertEqual(result.binding, "token-A")
        }
    }

    func test_failedRecoveryUploadRemainsRequiredAcrossCoordinatorRestart() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            let push = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            await push.registerToken(deviceToken, session: session("A"))
            await api.loseNextUnregisterResponse()
            _ = await push.unregisterCurrentToken(authToken: "token-A", expectedOwnerUserID: "A")
            await push.prepareAccountRecovery(userID: "A")
            push.start()
            await api.failNextRegistration()
            await push.registerToken(deviceToken, session: session("A"))

            let restarted = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            await restarted.registerToken(deviceToken, session: session("A"))
            let result = await api.snapshot()
            XCTAssertEqual(result.events.filter { $0 == "register:token-A" }.count, 3)
            XCTAssertEqual(result.binding, "token-A")
        }
    }

    func test_preparationSurvivesRestartBeforeAPNsIsRequested() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            var apnsRequests = 0
            let push = PushNotificationCoordinator(api: api, defaults: defaults,
                requestAPNsToken: { apnsRequests += 1 })
            await push.registerToken(deviceToken, session: session("A"))
            await api.loseNextUnregisterResponse()
            let started = expectation(description: "해제는 서버에서 처리됐고 응답은 대기 중")
            let gate = PushRegistrationGate(started: started)
            await api.holdNextUnregistration(gate)
            let unregister = Task {
                await push.unregisterCurrentToken(authToken: "token-A", expectedOwnerUserID: "A")
            }
            await fulfillment(of: [started], timeout: 2)
            let queued = expectation(description: "복구 준비도 같은 큐에 진입")
            let preparation = Task {
                queued.fulfill()
                await push.prepareAccountRecovery(userID: "A")
            }
            await fulfillment(of: [queued], timeout: 2)
            await gate.release()
            let unregistered = await unregister.value
            XCTAssertFalse(unregistered)
            await preparation.value

            XCTAssertEqual(apnsRequests, 0, "준비는 영속화까지만 한다. APNs는 로컬 복구 확정 뒤 요청한다")
            // start를 부르기 전에 종료돼도 새 인스턴스의 일반 콜백이 재전송해야 한다.
            let restarted = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            await restarted.registerToken(deviceToken, session: session("A"))
            let result = await api.snapshot()
            XCTAssertEqual(result.events, ["register:token-A", "unregister:token-A", "register:token-A"])
            XCTAssertEqual(result.binding, "token-A")
        }
    }

    func test_recoveryDoesNotInvalidateAnotherAccountsConfirmedRegistration() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            let push = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            await push.registerToken(deviceToken, session: session("B"))
            await push.prepareAccountRecovery(userID: "A")
            push.start()
            await push.registerToken(deviceToken, session: session("B"))
            let result = await api.snapshot()
            XCTAssertEqual(result.events, ["register:token-B"])
            XCTAssertEqual(result.binding, "token-B")
        }
    }

    func test_invalidationPreservesTokenAndOwnerForLaterSignOut() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            let push = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            await push.registerToken(deviceToken, session: session("A"))
            await push.prepareAccountRecovery(userID: "A")
            push.start()
            // 복구 표시 때문에 소유자를 지우면 옛 B의 뒷정리가 A의 토큰을 지워 버린다.
            _ = await push.unregisterCurrentToken(authToken: "token-B", expectedOwnerUserID: "B")
            let afterOtherCleanup = await api.snapshot()
            XCTAssertEqual(afterOtherCleanup.events, ["register:token-A"])
            let unregistered = await push.unregisterCurrentToken(authToken: "token-A", expectedOwnerUserID: "A")
            XCTAssertTrue(unregistered)
            let result = await api.snapshot()
            XCTAssertEqual(result.events, ["register:token-A", "unregister:token-A"])
            XCTAssertNil(result.binding)
        }
    }

    func test_recoveryInvalidationRunsAfterInFlightRegistrationCommitsItsCache() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            let started = expectation(description: "옛 등록 요청이 응답을 기다림")
            let gate = PushRegistrationGate(started: started)
            await api.holdNextRegistration(gate)
            var apnsRequests = 0
            let push = PushNotificationCoordinator(api: api, defaults: defaults,
                requestAPNsToken: { apnsRequests += 1 })
            let registration = Task { await push.registerToken(deviceToken, session: session("A")) }
            await fulfillment(of: [started], timeout: 2)
            let queued = expectation(description: "복구도 같은 등록 큐에 들어감")
            let recovery = Task {
                queued.fulfill()
                await push.prepareAccountRecovery(userID: "A")
                push.start()
            }
            await fulfillment(of: [queued], timeout: 2)
            XCTAssertEqual(apnsRequests, 0)
            await gate.release()
            await registration.value
            await recovery.value
            await push.registerToken(deviceToken, session: session("A"))
            let result = await api.snapshot()
            XCTAssertEqual(apnsRequests, 1)
            XCTAssertEqual(result.events, ["register:token-A", "register:token-A"])
        }
    }
}

private actor PushTokenAPIFixture: PushTokenAPIProviding {
    private var events: [String] = []
    private var binding: String?
    private var loseResponse = false
    private var failRegistration = false
    private var registrationGate: PushRegistrationGate?
    private var unregistrationGate: PushRegistrationGate?

    func loseNextUnregisterResponse() { loseResponse = true }
    func failNextRegistration() { failRegistration = true }
    func holdNextRegistration(_ gate: PushRegistrationGate) { registrationGate = gate }
    func holdNextUnregistration(_ gate: PushRegistrationGate) { unregistrationGate = gate }
    func snapshot() -> (events: [String], binding: String?) { (events, binding) }

    func registerPushToken(token: String, platform: String, authToken: String) async throws {
        events.append("register:\(authToken)")
        if let gate = registrationGate {
            registrationGate = nil
            await gate.wait()
        }
        if failRegistration {
            failRegistration = false
            throw URLError(.notConnectedToInternet)
        }
        binding = authToken
    }

    func unregisterPushToken(token: String, authToken: String) async throws {
        events.append("unregister:\(authToken)")
        binding = nil
        if let gate = unregistrationGate {
            unregistrationGate = nil
            await gate.wait()
        }
        if loseResponse {
            loseResponse = false
            throw URLError(.networkConnectionLost)
        }
    }
}

private actor PushRegistrationGate {
    private let started: XCTestExpectation
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false
    init(started: XCTestExpectation) { self.started = started }
    func wait() async {
        if released { return }
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            started.fulfill()
        }
    }
    func release() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}
