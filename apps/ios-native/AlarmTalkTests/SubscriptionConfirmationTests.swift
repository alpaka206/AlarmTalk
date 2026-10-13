import Foundation
import XCTest
@testable import AlarmTalk

/// StoreKit을 호출하지 않고 실제 API의 409 디코딩부터 구매 경로가 받는 결과까지 연결한다.
@MainActor
final class SubscriptionConfirmationTests: XCTestCase {
    func test_ownershipRejectionIsReturnedToThePurchaseCaller() async throws {
        try await withManager(responses: [
            (409, #"{"error":"owned","error_code":"TRANSACTION_OWNED_BY_OTHER_USER"}"#),
        ]) { manager in
            var refreshes = 0
            manager.onServerEntitlementUpdated = { refreshes += 1 }
            let outcome = await manager.syncWithBackend(transactionID: "ownership-test")
            let message = String(localized: "이 결제는 다른 계정에 이미 연결돼 있어요. 그 계정으로 로그인해 주세요")

            XCTAssertFalse(outcome.confirmed)
            XCTAssertEqual(outcome.rejection, message, "purchase는 이 값이 없으면 구독 성공으로 처리한다")
            XCTAssertEqual(manager.lastError, message)
            XCTAssertEqual(refreshes, 0)
            // ⚠ 확정 전에는 끝내지 않는 갈래(`mayFinish`)는 소모성 선물 하나를 위한 것이었고, 선물과 함께
            // 2026-10-14 에 없앴다(App Store 지침 3.1.1 두 번째 반려 — 되살리지 말 것, 할인·무료 이용은 스토어
            // 오퍼 코드). 남은 상품은 전부 구독이라 확정 여부와 무관하게 끝낸다(`SubscriptionManagerTests`).
        }
    }

    func test_eachConfirmationKeepsItsOwnRejectionWhenSharedErrorChanges() async throws {
        try await withManager(responses: [
            (409, #"{"error":"owned","error_code":"TRANSACTION_OWNED_BY_OTHER_USER"}"#),
            (409, #"{"error":"other store","error_code":"CROSS_STORE_RENEWAL_ACTIVE"}"#),
            (200, #"{"success":true}"#),
        ]) { manager in
            let ownership = await manager.syncWithBackend(transactionID: "ownership-test")
            let expected = try XCTUnwrap(ownership.rejection)
            let crossStore = await manager.syncWithBackend(transactionID: "cross-store-test")
            XCTAssertNotNil(crossStore.rejection)
            XCTAssertNotEqual(crossStore.rejection, expected)
            XCTAssertEqual(manager.lastError, crossStore.rejection)

            let success = await manager.syncWithBackend(transactionID: "success-test")
            XCTAssertTrue(success.confirmed)
            XCTAssertNil(manager.lastError)
            XCTAssertEqual(ownership.rejection, expected, "다른 요청이 lastError를 지워도 이 구매의 거절은 남는다")
        }
    }

    func test_temporaryUnavailabilityAndConfirmedPurchaseKeepTheirExistingResults() async throws {
        try await withManager(responses: [
            (503, #"{"error":"unavailable"}"#),
            (200, #"{"success":true}"#),
        ]) { manager in
            var refreshes = 0
            manager.onServerEntitlementUpdated = { refreshes += 1 }
            let retry = await manager.syncWithBackend(transactionID: "retry-test")
            XCTAssertFalse(retry.confirmed)
            XCTAssertNil(retry.rejection)
            XCTAssertEqual(refreshes, 0)
            let confirmed = await manager.syncWithBackend(transactionID: "confirmed-test")
            XCTAssertTrue(confirmed.confirmed)
            XCTAssertNil(confirmed.rejection)
            XCTAssertEqual(refreshes, 1)
        }
    }

    private func withManager(
        responses: [(Int, String)],
        _ body: (SubscriptionManager) async throws -> Void
    ) async throws {
        let host = "\(UUID().uuidString.lowercased()).subscription-confirmation.example.test"
        let fixture = SubscriptionConfirmationFixture(responses: responses)
        SubscriptionConfirmationURLProtocol.configure(host: host, fixture: fixture)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SubscriptionConfirmationURLProtocol.self]
        let session = URLSession(configuration: config)
        defer {
            session.invalidateAndCancel()
            SubscriptionConfirmationURLProtocol.configure(host: host, fixture: nil)
        }
        let api = AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: session)
        let auth = AuthSession(token: "test-token", user: AuthUser(id: UUID().uuidString, email: "test@example.test"))
        let manager = SubscriptionManager(api: api, authProvider: { auth }, listenForTransactions: false)
        try await body(manager)
        XCTAssertEqual(fixture.requests.count, responses.count)
        for request in fixture.requests {
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/billing/apple/confirm")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        }
    }
}

private final class SubscriptionConfirmationFixture: @unchecked Sendable {
    private let lock = NSLock()
    private let responses: [(Int, String)]
    private var recorded: [URLRequest] = []

    init(responses: [(Int, String)]) { self.responses = responses }
    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }
    func respond(to request: URLRequest) -> (Int, Data) {
        lock.lock()
        defer { lock.unlock() }
        let index = recorded.count
        recorded.append(request)
        guard responses.indices.contains(index) else {
            return (500, Data(#"{"error":"unexpected request"}"#.utf8))
        }
        return (responses[index].0, Data(responses[index].1.utf8))
    }
}

private final class SubscriptionConfirmationURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var fixtures: [String: SubscriptionConfirmationFixture] = [:]

    static func configure(host: String, fixture: SubscriptionConfirmationFixture?) {
        lock.lock()
        defer { lock.unlock() }
        fixtures[host] = fixture
    }
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasSuffix(".subscription-confirmation.example.test") == true
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let fixture = request.url?.host.flatMap { Self.fixtures[$0] }
        Self.lock.unlock()
        guard let fixture else {
            client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
            return
        }
        let (status, data) = fixture.respond(to: request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
