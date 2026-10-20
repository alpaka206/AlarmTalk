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

    // MARK: - 등록은 스스로 낫는다(스펙 session-and-auth 「푸시 등록은 스스로 낫는다」)

    /// 서버의 등록은 앱 모르게 사라질 수 있다 — 영속 캐시만 보고 건너뛰면 그 기기는 토큰이나 계정이 바뀔 때까지 푸시를
    /// 못 받는다. **실행마다 첫 토큰 콜백은 캐시와 같아도 올린다**(안드로이드는 프로세스가 뜰 때마다 등록한다). 같은 실행
    /// 안에서는 다시 올리지 않는다.
    func test_실행마다_첫_등록은_캐시와_같아도_서버에_다시_올린다() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            let first = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            await first.registerToken(deviceToken, session: session("A"))
            await api.dropBinding()
            // 같은 실행 — 전경 복귀마다 토큰이 다시 와도 올리지 않는다.
            await first.registerToken(deviceToken, session: session("A"))
            let sameProcess = await api.snapshot()
            XCTAssertEqual(sameProcess.events, ["register:token-A"])

            // 다음 실행 — 영속 캐시는 같은 토큰·같은 계정이지만 올린다. 서버가 잃은 등록이 되살아난다.
            let next = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            await next.registerToken(deviceToken, session: session("A"))
            await next.registerToken(deviceToken, session: session("A"))
            let result = await api.snapshot()
            XCTAssertEqual(result.events, ["register:token-A", "register:token-A"], "다음 실행이 같은 값이라며 건너뛴다")
            XCTAssertEqual(result.binding, "token-A", "서버가 잃은 등록이 되살아나지 않는다")
        }
    }

    /// 실행 첫 등록이 실패하면(게이트웨이 5xx·오프라인) **같은 실행의 전경 복귀**가 토큰을 다시 받아 올린다 — iOS 앱은
    /// 멈춘 채 며칠씩 살아 있어 '다음 실행' 을 기다리면 그동안 이용권·목소리 푸시가 끊긴다. 앞 실행에서 확인된 등록이 있어도
    /// 같다(영속 캐시는 그 실패를 모른다). 확인된 뒤의 전경 복귀는 아무것도 요청하지 않는다.
    func test_실패한_등록은_같은_실행의_전경_복귀가_다시_올린다() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            let earlier = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            await earlier.registerToken(deviceToken, session: session("A"))
            await api.dropBinding()

            var apnsRequests = 0
            let push = PushNotificationCoordinator(api: api, defaults: defaults,
                requestAPNsToken: { apnsRequests += 1 })
            await api.failNextRegistration()
            await push.registerToken(deviceToken, session: session("A"))
            XCTAssertFalse(push.registrationConfirmedInThisProcess(userID: "A"), "실패한 등록을 확인된 것으로 적는다")

            push.resumeRegistrationIfNeeded(session: session("A"))
            XCTAssertEqual(apnsRequests, 1, "실패한 등록을 전경 복귀가 다시 올리지 않는다 — 다음 실행까지 푸시가 끊긴다")
            // APNs 가 토큰을 다시 준다(`didRegisterForRemoteNotificationsWithDeviceToken`).
            await push.registerToken(deviceToken, session: session("A"))
            XCTAssertTrue(push.registrationConfirmedInThisProcess(userID: "A"))

            push.resumeRegistrationIfNeeded(session: session("A"))
            XCTAssertEqual(apnsRequests, 1, "확인된 등록을 전경마다 다시 요청한다")
            let result = await api.snapshot()
            XCTAssertEqual(result.events, ["register:token-A", "register:token-A", "register:token-A"])
            XCTAssertEqual(result.binding, "token-A")
        }
    }

    /// 확인되지 않은 때는 실패만이 아니다 — 토큰이 세션 없이 왔으면(올리지 못했다) 다음 전경 복귀가 다시 받아 올린다.
    /// 세션이 없거나 탈퇴 대기 중이면 요청하지 않는다 — 탈퇴 대기는 서버가 등록을 403 으로 막고, 복구가 스스로 다시 건다.
    func test_전경_복귀는_세션이_있고_탈퇴_대기가_아닐_때만_확인되지_않은_등록을_다시_요청한다() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            var apnsRequests = 0
            let push = PushNotificationCoordinator(api: api, defaults: defaults,
                requestAPNsToken: { apnsRequests += 1 })
            await push.registerToken(deviceToken, session: nil)

            push.resumeRegistrationIfNeeded(session: nil)
            var pending = session("A")
            pending.user.deletionStatus = "pending_deletion"
            push.resumeRegistrationIfNeeded(session: pending)
            XCTAssertEqual(apnsRequests, 0, "세션이 없거나 탈퇴 대기인데 토큰을 다시 요청한다")

            push.resumeRegistrationIfNeeded(session: session("A"))
            XCTAssertEqual(apnsRequests, 1, "세션 없이 온 토큰을 다음 전경 복귀가 다시 올리지 않는다")
            await push.registerToken(deviceToken, session: session("A"))
            let result = await api.snapshot()
            XCTAssertEqual(result.events, ["register:token-A"])
            XCTAssertEqual(result.binding, "token-A")
        }
    }

    /// 해제를 보낸 순간부터 서버의 등록은 '없거나 모른다' 다 — 응답만 잃었을 수 있다. 같은 실행에서 같은 계정이 다시
    /// 들어오면 다음 토큰 콜백이 다시 올려야 한다(영속 캐시는 실패한 해제 뒤에도 그 계정을 가리킨다).
    func test_해제를_보낸_뒤에는_같은_계정이어도_다시_올린다() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            var apnsRequests = 0
            let push = PushNotificationCoordinator(api: api, defaults: defaults,
                requestAPNsToken: { apnsRequests += 1 })
            await push.registerToken(deviceToken, session: session("A"))
            await api.loseNextUnregisterResponse()
            let unregistered = await push.unregisterCurrentToken(authToken: "token-A", expectedOwnerUserID: "A")
            XCTAssertFalse(unregistered)
            XCTAssertFalse(push.registrationConfirmedInThisProcess(userID: "A"), "해제를 보낸 뒤에도 등록이 확인된 것으로 남는다")

            push.resumeRegistrationIfNeeded(session: session("A"))
            XCTAssertEqual(apnsRequests, 1)
            await push.registerToken(deviceToken, session: session("A"))
            let result = await api.snapshot()
            XCTAssertEqual(result.events, ["register:token-A", "unregister:token-A", "register:token-A"])
            XCTAssertEqual(result.binding, "token-A", "응답을 잃은 해제 뒤 같은 계정의 등록이 되살아나지 않는다")
        }
    }

    /// 화면 배선 — 전경 복귀(`scenePhase == .active`)가 지금 세션으로 다시 올릴지 묻는다. `App` 의 `onChange` 라
    /// 유닛 테스트가 부를 수 없어 소스를 읽는다(`AppSourceText`).
    func test_전경_복귀가_확인되지_않은_푸시_등록을_다시_올린다() throws {
        let app = try AppSourceText.read("AlarmTalkApp.swift")
        let active = try AppSourceText.region(of: app, from: "case .active:", to: "case .background:")
        XCTAssertTrue(
            active.contains("push.resumeRegistrationIfNeeded(session: auth.session)"),
            "전경 복귀가 확인되지 않은 푸시 등록을 다시 올리지 않는다"
        )
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

    /// **서버가 지운 등록의 확인 내리기도 등록과 같은 줄에 선다**(코덱스 #904). 응답을 기다리던 앞선 등록이 그 뒤에 끝나며
    /// 확인을 도로 적으면, 같은 실행에서 같은 계정으로 다시 로그인해도 등록을 건너뛴다.
    func test_invalidationQueuesBehindAnInFlightRegistration() async {
        await withDefaults { defaults in
            let api = PushTokenAPIFixture()
            let started = expectation(description: "앞선 등록이 응답을 기다림")
            let gate = PushRegistrationGate(started: started)
            await api.holdNextRegistration(gate)
            let push = PushNotificationCoordinator(api: api, defaults: defaults, requestAPNsToken: {})
            let registration = Task { await push.registerToken(deviceToken, session: session("A")) }
            await fulfillment(of: [started], timeout: 2)
            let invalidation = Task { await push.invalidateRegistration() }
            await gate.release()
            await registration.value
            await invalidation.value
            // 탈퇴 신청이 서버 행을 지웠다.
            await api.dropBinding()

            await push.registerToken(deviceToken, session: session("A"))

            let result = await api.snapshot()
            XCTAssertEqual(result.events, ["register:token-A", "register:token-A"], "앞선 등록이 확인을 도로 적어 다시 올리지 않았다")
            XCTAssertEqual(result.binding, "token-A")
        }
    }

    /// `account_deletion_requested` 는 계정을 다시 묻는 훅을 부른다 — 신호만 믿고 떠나지 않는다.
    func test_accountDeletionRequestedSignalAsksTheServerAgain() async {
        await withDefaults { defaults in
            let push = PushNotificationCoordinator(api: PushTokenAPIFixture(), defaults: defaults, requestAPNsToken: {})
            var asked = 0
            push.onAccountDeletionRequested = { asked += 1 }
            let handled = await push.handle(userInfo: ["type": "account_deletion_requested"])
            XCTAssertTrue(handled)
            XCTAssertEqual(asked, 1)
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
    /// 서버가 앱 모르게 등록을 지운 경우(`Unregistered` 정리, 응답을 잃은 실패 등).
    func dropBinding() { binding = nil }
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
