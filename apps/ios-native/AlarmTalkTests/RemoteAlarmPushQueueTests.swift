import Foundation
import XCTest
@testable import AlarmTalk

@MainActor
final class RemoteAlarmPushQueueTests: XCTestCase {
    func test_foregroundPushRunsAfterBackgroundPassIsCancelled() async throws {
        try await assertQueuedPush(cancelFirst: true)
    }

    func test_queuedPushRetriesFailedRowAndIncludesNewLocalEdit() async throws {
        try await assertQueuedPush(cancelFirst: false)
    }

    func test_cancelledWaiterDoesNotConsumeNextPushRequest() async throws {
        try await assertQueuedPush(cancelFirst: true, cancelWaiter: true)
    }

    private func assertQueuedPush(cancelFirst: Bool, cancelWaiter: Bool = false) async throws {
        let firstRequest = expectation(description: "background PATCH awaiting response")
        let host = "\(UUID().uuidString.lowercased()).push-queue.example.test"
        let fixture = PushQueueFixture(firstRequest: firstRequest)
        PushQueueURLProtocol.configure(host: host, fixture: fixture)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PushQueueURLProtocol.self]
        let session = URLSession(configuration: config)
        defer {
            session.invalidateAndCancel()
            PushQueueURLProtocol.configure(host: host, fixture: nil)
        }
        let api = AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: session)
        let auth = AuthViewModel(api: api)
        auth._setSessionForTesting(AuthSession(token: "old-token", user: AuthUser(id: "owner", email: "owner@example.test")))
        let store = LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory.appendingPathComponent("push-queue-\(UUID()).json"),
            loadRecords: { [] }
        )
        await store.waitUntilLoadedFromDisk()
        XCTAssertTrue(store.hasLoadedFromDisk)
        var existing = LocalAlarmRecord(id: "existing", label: "old", hour: 8, minute: 0, fireAtMillis: 1)
        existing.remoteAlarmId = "remote-existing"
        existing.ownerUserId = "owner"
        store.upsert(existing)
        let background = RemoteAlarmPushSync(api: api, store: store, auth: auth)
        let foreground = RemoteAlarmPushSync(api: api, store: store, auth: auth)
        let active = Task { @MainActor in try await background.runOnce() }
        await fulfillment(of: [firstRequest], timeout: 2)

        // 첫 회차가 후보를 읽은 뒤 추가한 편집도 대기 호출이 다시 읽어야 한다.
        var added = LocalAlarmRecord(id: "added", label: "new", hour: 9, minute: 0, fireAtMillis: 2)
        added.ownerUserId = "owner"
        store.upsert(added)
        let queued = expectation(description: "foreground push requested")
        var waiterFinished = false
        let waiter = Task { @MainActor in
            queued.fulfill()
            defer { waiterFinished = true }
            return try await foreground.runOnce()
        }
        await fulfillment(of: [queued], timeout: 1)
        XCTAssertFalse(waiterFinished, "대기 중인 호출을 성공/0건으로 완료하지 않는다")
        XCTAssertEqual(fixture.requests.count, 1)

        var following: Task<RemoteAlarmPushSync.PushResult, Error>?
        if cancelWaiter {
            waiter.cancel()
            let nextQueued = expectation(description: "next foreground push requested")
            following = Task { @MainActor in
                nextQueued.fulfill()
                return try await foreground.runOnce()
            }
            await fulfillment(of: [nextQueued], timeout: 1)
        }
        auth._setSessionForTesting(AuthSession(token: "fresh-token", user: AuthUser(id: "owner", email: "owner@example.test")))
        if cancelFirst { active.cancel() }
        else { fixture.failFirstRequest() }

        switch await active.result {
        case .success(let result):
            XCTAssertFalse(cancelFirst)
            XCTAssertEqual(result, .init(attempted: 1, created: 0, updated: 0, failed: 1))
        case .failure(let error):
            XCTAssertTrue(cancelFirst)
            XCTAssertTrue(error is CancellationError)
        }
        let result: RemoteAlarmPushSync.PushResult
        if let following {
            do { _ = try await waiter.value; XCTFail("취소된 대기 호출은 전송하지 않는다") }
            catch { XCTAssertTrue(error is CancellationError) }
            result = try await following.value
        } else {
            result = try await waiter.value
        }
        XCTAssertEqual(result, .init(attempted: 2, created: 1, updated: 1, failed: 0))
        XCTAssertEqual(store.record(id: "added")?.remoteAlarmId, "remote-new")
        XCTAssertEqual(store.record(id: "existing")?.syncStateEnum, .synced)
        XCTAssertEqual(fixture.requests.map(\.httpMethod), ["PATCH", "PATCH", "POST"])
        XCTAssertEqual(fixture.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer old-token")
        for request in fixture.requests.dropFirst() {
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fresh-token")
        }
    }
}

private final class PushQueueFixture: @unchecked Sendable {
    private let lock = NSLock()
    private let firstRequest: XCTestExpectation
    private var recorded: [URLRequest] = []
    private var blocked: PushQueueURLProtocol?

    init(firstRequest: XCTestExpectation) { self.firstRequest = firstRequest }
    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }
    func receive(_ transport: PushQueueURLProtocol) {
        lock.lock()
        recorded.append(transport.request)
        let first = recorded.count == 1
        if first { blocked = transport }
        lock.unlock()
        if first { firstRequest.fulfill() }
        else { transport.respond(status: 200) }
    }
    func failFirstRequest() {
        lock.lock()
        let transport = blocked
        blocked = nil
        lock.unlock()
        transport?.respond(status: 503)
    }
}

private final class PushQueueURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var fixtures: [String: PushQueueFixture] = [:]
    static func configure(host: String, fixture: PushQueueFixture?) {
        lock.lock()
        defer { lock.unlock() }
        fixtures[host] = fixture
    }
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasSuffix(".push-queue.example.test") == true
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
        fixture.receive(self)
    }
    func respond(status: Int) {
        let remoteID = request.httpMethod == "PATCH" ? "remote-existing" : "remote-new"
        let body = status == 200 ? "{\"alarm\":{\"id\":\"\(remoteID)\"}}" : #"{"error":"unavailable"}"#
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
