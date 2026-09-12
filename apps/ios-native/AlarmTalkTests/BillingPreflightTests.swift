import Foundation
import XCTest
@testable import AlarmTalk

/// 스토어를 여는 전제인 서버 응답·세션 소유권·영속 스냅샷을 함께 검증한다.
@MainActor
final class BillingPreflightTests: XCTestCase {
    private func session(token: String, userID: String) -> AuthSession {
        AuthSession(token: token, user: AuthUser(
            id: userID, email: "preflight@example.test", name: "Test", plan: "family",
            allowFamilyAlarms: false, familyAlarmQuietDays: nil, familyAlarmQuietStart: nil,
            familyAlarmQuietEnd: nil, familyAlarmQuietWindows: nil, appleUserId: nil
        ))
    }

    private func check(
        body: String, status: Int = 200, replaceToken: Bool = false,
        cancel: Bool = false, expected: Bool
    ) async throws {
        let userID = UUID().uuidString
        let current = session(token: UUID().uuidString, userID: userID)
        let replacement = session(token: UUID().uuidString, userID: userID)
        let host = "\(UUID().uuidString.lowercased()).billing.example.test"
        let previous = KeychainStore.readSession()
        try KeychainStore.saveSession(current)
        let writer = EntitlementWriter()
        XCTAssertEqual(writer.write(try XCTUnwrap(writer.ticket()), "test seed") { $0.userPlan = "family" }, .applied)
        defer {
            AccessSnapshotStore().clear(userID: userID)
            if let previous { try? KeychainStore.saveSession(previous) }
            else { KeychainStore.deleteSession() }
            PreflightURLProtocol.configure(host: host, handler: nil)
        }
        PreflightURLProtocol.configure(host: host) { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(current.token)")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
                .first(where: { $0.name == "refresh_store" })?.value, "1")
            if replaceToken { try? KeychainStore.saveSession(replacement) }
            return (status, Data(body.utf8))
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PreflightURLProtocol.self]
        let urlSession = URLSession(configuration: config)
        defer { urlSession.invalidateAndCancel() }
        let vm = SocialFeatureViewModel(api: AlarmTalkAPI(
            baseURL: URL(string: "https://\(host)/api/")!, session: urlSession
        ))
        let request = Task { await vm.refreshSubscriptionForPurchase(session: current) }
        if cancel { request.cancel() }
        let response = await request.value
        let applied = response != nil
        XCTAssertEqual(applied, expected)
        // 새로운 저장소 인스턴스로 읽어 재시작 뒤 남는 값까지 확인한다.
        let snapshot = AccessSnapshotStore().read(userID: userID)
        XCTAssertEqual(snapshot.userPlan, expected ? "free" : "family")
        if expected {
            XCTAssertEqual(response?.storeRenewalProviders, [])
            XCTAssertNotNil(snapshot.subscriptionResponse)
            XCTAssertNil(snapshot.subscriptionResponse?.subscription)
            XCTAssertEqual(snapshot.subscriptionResponse?.storeRenewalProviders, [])
        }
    }

    func test_completeResponsePersistsFreePlanAndNullSubscriptionTogether() async throws {
        try await check(body: #"{"subscription":null,"plan":null,"next_plan":null,"user_plan":"free","store_renewal_providers":[]}"#, expected: true)
    }

    func test_legacyResponseCannotAuthorizePurchaseOrOverwritePlan() async throws {
        try await check(body: #"{"subscription":null,"plan":null,"next_plan":null,"store_renewal_providers":[]}"#, expected: false)
    }

    func test_missingRenewalOwnersCannotAuthorizePurchase() async throws {
        try await check(body: #"{"subscription":null,"plan":null,"next_plan":null,"user_plan":"free"}"#, expected: false)
    }

    func test_serverFailureKeepsPreviousSnapshot() async throws {
        try await check(body: #"{"error":"unavailable"}"#, status: 503, expected: false)
    }

    func test_sameAccountReloginRejectsOldResponse() async throws {
        try await check(body: #"{"subscription":null,"plan":null,"next_plan":null,"user_plan":"free","store_renewal_providers":[]}"#, replaceToken: true, expected: false)
    }

    func test_cancelledPreflightCannotAuthorizePurchase() async throws {
        try await check(body: #"{"subscription":null,"plan":null,"next_plan":null,"user_plan":"free","store_renewal_providers":[]}"#, cancel: true, expected: false)
    }

    private func checkOverlappingRefresh(silent: Bool = false, preflightFails: Bool = false) async throws {
        let userID = UUID().uuidString
        let current = session(token: UUID().uuidString, userID: userID)
        let host = "\(UUID().uuidString.lowercased()).billing.example.test"
        let previous = KeychainStore.readSession()
        try KeychainStore.saveSession(current)
        let oldReadStarted = expectation(description: "이전 조회가 응답 반영 직전에 대기")
        let gate = PreflightResponseGate()
        let stale = Data(#"{"subscription":null,"plan":null,"next_plan":null,"store_renewal_providers":[]}"#.utf8)
        let authoritative = Data(#"{"subscription":null,"plan":null,"next_plan":null,"user_plan":"family","store_renewal_providers":["google"]}"#.utf8)
        let staleMe = try JSONSerialization.data(withJSONObject: [
            "user": ["id": userID, "email": "preflight@example.test", "name": "Test", "plan": "free"]
        ])
        PreflightURLProtocol.configureDeferred(host: host) { request, complete in
            let url = request.url!
            if url.query == "refresh_store=1" {
                complete(preflightFails ? 503 : 200, authoritative)
            } else if url.path.hasSuffix("billing/subscription") {
                if silent { gate.hold { complete(200, stale) }; oldReadStarted.fulfill() }
                else { complete(200, stale) }
            } else if url.path.hasSuffix("auth/me") {
                gate.hold { complete(200, staleMe) }
                oldReadStarted.fulfill()
            } else if url.path.hasSuffix("billing/vouchers") {
                complete(200, Data(#"{"vouchers":[]}"#.utf8))
            } else {
                complete(200, Data(#"{"group":null,"role":null,"members":[]}"#.utf8))
            }
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PreflightURLProtocol.self]
        let urlSession = URLSession(configuration: config)
        let vm = SocialFeatureViewModel(api: AlarmTalkAPI(
            baseURL: URL(string: "https://\(host)/api/")!, session: urlSession
        ))
        defer {
            gate.release()
            urlSession.invalidateAndCancel()
            PreflightURLProtocol.configure(host: host, handler: nil)
            AccessSnapshotStore().clear(userID: userID)
            if let previous { try? KeychainStore.saveSession(previous) }
            else { KeychainStore.deleteSession() }
        }
        let older = Task {
            if silent { _ = await vm.refreshSubscriptionSilently(session: current) }
            else { await vm.refreshAll(session: current) }
        }
        await fulfillment(of: [oldReadStarted], timeout: 2)
        let preflight = await vm.refreshSubscriptionForPurchase(session: current)
        gate.release()
        await older.value
        XCTAssertFalse(vm.isRefreshing)
        if preflightFails {
            XCTAssertNil(preflight)
            XCTAssertEqual(vm.subscription?.storeRenewalProviders, [])
            XCTAssertTrue(vm.entitlementSnapshotComplete)
            XCTAssertEqual(AccessSnapshotStore().read(userID: userID).userPlan, "free")
        } else {
            XCTAssertEqual(preflight?.storeRenewalProviders, ["google"])
            XCTAssertEqual(vm.subscription?.storeRenewalProviders, ["google"])
            XCTAssertEqual(AccessSnapshotStore().read(userID: userID).userPlan, "family")
            XCTAssertEqual(AccessSnapshotStore().read(userID: userID).subscriptionResponse?.storeRenewalProviders, ["google"])
            // 공용 화면 값이 이후 바뀌더라도 구매 판단은 반환된 응답만 사용한다.
            vm.subscription = nil
            XCTAssertEqual(BillingPanel.purchaseBlockReason(currentTier: .free, response: preflight), .playOwnsRenewal)
            XCTAssertFalse(vm.entitlementSnapshotComplete)
        }
        // 이전 전체 갱신을 버려도 다음 전체 갱신의 admission이 잠기면 안 된다.
        if !silent {
            PreflightURLProtocol.configure(host: host) { request in
                if request.url!.path.hasSuffix("auth/me") { return (200, staleMe) }
                if request.url!.path.hasSuffix("billing/subscription") { return (200, stale) }
                if request.url!.path.hasSuffix("billing/vouchers") { return (200, Data(#"{"vouchers":[]}"#.utf8)) }
                return (200, Data(#"{"group":null,"role":null,"members":[]}"#.utf8))
            }
            await vm.refreshAll(session: current)
            XCTAssertTrue(vm.entitlementSnapshotComplete)
        }
    }

    func test_olderFullRefreshCannotErasePreflightDecisionOrPersistedPlan() async throws {
        try await checkOverlappingRefresh()
    }

    func test_olderSilentRefreshCannotEraseSuccessfulPreflight() async throws {
        try await checkOverlappingRefresh(silent: true)
    }

    func test_failedPreflightDoesNotInvalidatePendingFullRefresh() async throws {
        try await checkOverlappingRefresh(preflightFails: true)
    }
}

private final class PreflightResponseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var completion: (@Sendable () -> Void)?
    private var released = false

    func hold(_ completion: @escaping @Sendable () -> Void) {
        lock.lock()
        if released { lock.unlock(); completion(); return }
        self.completion = completion
        lock.unlock()
    }

    func release() {
        lock.lock()
        released = true
        let completion = self.completion
        self.completion = nil
        lock.unlock()
        completion?()
    }
}

private final class PreflightURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Reply = @Sendable (Int, Data) -> Void
    typealias Handler = @Sendable (URLRequest, @escaping Reply) -> Void
    private static let lock = NSLock()
    // 취소된 요청이 늦게 startLoading에 도착해도 다음 테스트의 핸들러를 쓰지 않는다.
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]

    static func configure(host: String, handler: (@Sendable (URLRequest) -> (Int, Data))?) {
        lock.lock()
        defer { lock.unlock() }
        if let handler {
            handlers[host] = { request, complete in
                let (status, data) = handler(request)
                complete(status, data)
            }
        } else { handlers[host] = nil }
    }

    static func configureDeferred(host: String, handler: @escaping Handler) {
        lock.lock()
        defer { lock.unlock() }
        handlers[host] = handler
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasSuffix(".billing.example.test") == true
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let handler = request.url?.host.flatMap { Self.handlers[$0] }
        Self.lock.unlock()
        guard let handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
            return
        }
        handler(request) { [self] status, data in
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
                httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}
