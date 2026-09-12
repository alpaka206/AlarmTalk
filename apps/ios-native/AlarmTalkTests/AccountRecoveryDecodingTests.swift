import Foundation
import XCTest
@testable import AlarmTalk

/// #735 — 오류를 직접 던지는 mock 대신 실제 API의 2xx 디코딩부터 복구 훅까지 연결한다.
@MainActor
final class AccountRecoveryDecodingTests: XCTestCase {
    func test_malformedCancelResponseRechecksAccountBeforeCompletingRecovery() async throws {
        let bodies = [
            #"{"success":true,"status":"active""#, // 잘린 JSON
            #"{"success":true}"#, // 필수 필드 누락
            #"{"success":"true","status":"active"}"#, // 타입 불일치
            #"{"success":true,"status":null}"#, // 필수 값 null
        ]
        for body in bodies {
            try await withRecovery(cancelBody: body, confirmation: .active) { vm, userID in
                var recoveredIDs: [String] = []
                vm.onAccountRecovered = { id in
                    XCTAssertFalse(vm.pendingDeletion)
                    XCTAssertFalse(PendingSignOutStore.isPending(id))
                    XCTAssertEqual(vm.session?.user.deletionStatus, "active")
                    recoveredIDs.append(id)
                }

                await vm.cancelAccountDeletion()

                XCTAssertEqual(recoveredIDs, [userID], body)
                XCTAssertEqual(vm.session?.token, "confirmed-token")
                XCTAssertEqual(KeychainStore.readSession()?.user.deletionStatus, "active")
                XCTAssertNil(vm.statusMessage, "복구를 확인한 뒤 최초 디코딩 실패를 표시하지 않는다")
                XCTAssertFalse(vm.isBusy)
            }
        }
    }

    func test_decoderFailureAloneCannotCompleteRecovery() async throws {
        for confirmation in [Confirmation.pending, .unavailable, .malformed] {
            try await withRecovery(cancelBody: #"{"success":true}"#, confirmation: confirmation) { vm, userID in
                var restarts = 0
                vm.onAccountRecovered = { _ in restarts += 1 }

                await vm.cancelAccountDeletion()

                XCTAssertEqual(restarts, 0)
                XCTAssertTrue(vm.pendingDeletion)
                XCTAssertEqual(vm.session?.user.deletionStatus, "pending_deletion")
                XCTAssertEqual(KeychainStore.readSession()?.user.deletionStatus, "pending_deletion")
                XCTAssertTrue(PendingSignOutStore.isPending(userID))
                XCTAssertNotNil(vm.statusMessage)
                XCTAssertFalse(vm.isBusy)
            }
        }
    }

    private enum Confirmation { case active, pending, unavailable, malformed }

    private func withRecovery(
        cancelBody: String,
        confirmation: Confirmation,
        _ body: (AuthViewModel, String) async throws -> Void
    ) async throws {
        let previous = KeychainStore.readSession()
        let userID = UUID().uuidString
        let suite = "recovery-decoding-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let host = "\(UUID().uuidString.lowercased()).recovery-decoding.example.test"
        let pendingUser = AuthUser(id: userID, email: "recover@example.test", deletionStatus: "pending_deletion")
        func me(_ status: String, token: String) throws -> Data {
            try JSONSerialization.data(withJSONObject: [
                "token": token,
                "user": ["id": userID, "email": pendingUser.email, "deletion_status": status],
            ])
        }
        let confirmationResponse: (Int, Data)
        switch confirmation {
        case .active: confirmationResponse = (200, try me("active", token: "confirmed-token"))
        case .pending: confirmationResponse = (200, try me("pending_deletion", token: "initial-token"))
        case .unavailable: confirmationResponse = (503, Data(#"{"error":"unavailable"}"#.utf8))
        case .malformed: confirmationResponse = (200, Data(#"{"user":null}"#.utf8))
        }
        let fixture = RecoveryDecodingFixture(responses: [
            (200, try me("pending_deletion", token: "initial-token")),
            (200, Data(cancelBody.utf8)),
            confirmationResponse,
        ])
        RecoveryDecodingURLProtocol.configure(host: host, fixture: fixture)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RecoveryDecodingURLProtocol.self]
        let session = URLSession(configuration: config)
        defer {
            session.invalidateAndCancel()
            RecoveryDecodingURLProtocol.configure(host: host, fixture: nil)
            PendingSignOutStore.clear(userID)
            defaults.removePersistentDomain(forName: suite)
            if let previous { try? KeychainStore.saveSession(previous) }
            else { KeychainStore.deleteSession() }
        }
        let api = AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: session)
        let vm = AuthViewModel(api: api, accessSnapshotStore: AccessSnapshotStore(defaults: defaults))
        defer { vm.onAccountRecovered = { _ in } }
        vm._setSessionForTesting(AuthSession(token: "initial-token", user: pendingUser))
        await vm.refreshUser()
        XCTAssertTrue(vm.pendingDeletion)
        PendingSignOutStore.mark(userID)

        try await body(vm, userID)

        XCTAssertEqual(fixture.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }, [
            "GET /api/auth/me", "DELETE /api/user/me/deletion", "GET /api/auth/me",
        ], "깨진 취소 응답 뒤 실제 API로 상태를 한 번 재확인해야 한다")
        for request in fixture.requests {
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer initial-token")
        }
    }
}

private final class RecoveryDecodingFixture: @unchecked Sendable {
    private let lock = NSLock()
    private let responses: [(Int, Data)]
    private var recorded: [URLRequest] = []

    init(responses: [(Int, Data)]) { self.responses = responses }
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
        return responses[index]
    }
}

private final class RecoveryDecodingURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    // 늦게 도착한 다른 사례의 요청이 현재 사례의 응답을 소비하지 않게 격리한다.
    nonisolated(unsafe) private static var fixtures: [String: RecoveryDecodingFixture] = [:]

    static func configure(host: String, fixture: RecoveryDecodingFixture?) {
        lock.lock()
        defer { lock.unlock() }
        fixtures[host] = fixture
    }
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasSuffix(".recovery-decoding.example.test") == true
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
        let (status, body) = fixture.respond(to: request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
