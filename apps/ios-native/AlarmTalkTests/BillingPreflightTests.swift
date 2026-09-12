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
        let previous = KeychainStore.readSession()
        try KeychainStore.saveSession(current)
        let writer = EntitlementWriter()
        XCTAssertEqual(writer.write(try XCTUnwrap(writer.ticket()), "test seed") { $0.userPlan = "family" }, .applied)
        defer {
            AccessSnapshotStore().clear(userID: userID)
            if let previous { try? KeychainStore.saveSession(previous) }
            else { KeychainStore.deleteSession() }
            PreflightURLProtocol.configure(nil)
        }
        PreflightURLProtocol.configure { request in
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
            baseURL: URL(string: "https://billing.example.test/api/")!, session: urlSession
        ))
        let request = Task { await vm.refreshSubscriptionSilently(session: current, refreshStoreState: true) }
        if cancel { request.cancel() }
        let applied = await request.value
        XCTAssertEqual(applied, expected)
        // 새로운 저장소 인스턴스로 읽어 재시작 뒤 남는 값까지 확인한다.
        let snapshot = AccessSnapshotStore().read(userID: userID)
        XCTAssertEqual(snapshot.userPlan, expected ? "free" : "family")
        if expected {
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
}

private final class PreflightURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: (@Sendable (URLRequest) -> (Int, Data))?

    static func configure(_ next: (@Sendable (URLRequest) -> (Int, Data))?) {
        lock.lock()
        defer { lock.unlock() }
        handler = next
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let handler = Self.handler
        Self.lock.unlock()
        guard let handler else { return }
        let (status, data) = handler(request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
