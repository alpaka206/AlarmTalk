import Foundation
import XCTest
@testable import AlarmTalk

@MainActor
final class UsageEventUploaderTests: XCTestCase {
    /// - Parameters:
    ///   - behavior: 스텁 서버가 요청에 어떻게 응하는가.
    ///   - onRequestStart: 요청이 **나간 순간** 부른다 — 전송 도중 취소를 재현할 때 쓴다.
    private func fixture(
        behavior: UsageUploadURLProtocol.Behavior = .respond(status: 200),
        onRequestStart: (@Sendable () -> Void)? = nil
    ) throws -> (AuthSession, UsageEventQueue, AlarmTalkAPI) {
        let session = AuthSession(token: "usage-test-token", user: AuthUser(id: "usage-test-owner", email: "test@example.test"))
        let previous = KeychainStore.readSession()
        try KeychainStore.saveSession(session)
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock {
            if let previous { try KeychainStore.saveSession(previous) }
            else { KeychainStore.deleteSession() }
            try? FileManager.default.removeItem(at: fileURL)
            UsageUploadURLProtocol.configure(behavior: .respond(status: 200))
        }
        let queue = UsageEventQueue(fileURL: fileURL, currentUserID: { "usage-test-owner" })
        for index in 0..<150 {
            queue.record(.alarmCreated, alarmID: "alarm-\(index)", userID: session.user.id)
        }
        XCTAssertEqual(queue.count, 150)
        UsageUploadURLProtocol.configure(behavior: behavior, onRequestStart: onRequestStart)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UsageUploadURLProtocol.self]
        let api = AlarmTalkAPI(baseURL: URL(string: "https://usage-upload.example.test/api/")!,
                               session: URLSession(configuration: configuration))
        return (session, queue, api)
    }

    func testBackgroundBudgetSendsOnlyOneBatch() async throws {
        let (session, queue, api) = try fixture()
        await UsageEventUploader.shared.flush(session: session, api: api, queue: queue, maxBatches: 1)
        XCTAssertEqual(UsageUploadURLProtocol.requestCount, 1)
        XCTAssertEqual(queue.count, 50)
    }

    /// 여느 실패는 **이슈로 올린다**(`reportFailure` 가 불린다) — 아래 취소 케이스와 짝이다.
    /// 취소를 걸러 낸 뒤에도 진짜 실패가 조용해지면 안 되므로, 이 단언이 그 반대편을 지킨다.
    func testFailureKeepsTheEntireBatchAndReports() async throws {
        let (session, queue, api) = try fixture(behavior: .respond(status: 503))
        let reporter = FailureReportRecorder()
        await UsageEventUploader.shared.flush(
            session: session, api: api, queue: queue, maxBatches: 1,
            reportFailure: { reporter.record($0, $1) }
        )
        XCTAssertEqual(UsageUploadURLProtocol.requestCount, 1)
        XCTAssertEqual(queue.count, 150)
        XCTAssertEqual(reporter.reports.count, 1, "5xx 는 그대로 이슈로 올라가야 한다")
    }

    func testPreConsent403IsNotReportedAndKeepsQueue() async throws {
        // 동의 전(403 CONSENT_REQUIRED)은 안드로이드 `SyncWorkerFailure` 의 CONSENT_PENDING 처럼
        // 조용히 끝나야 한다 — 큐는 남기고, 이슈는 없고, 다음 배치로 넘어가지 않는다.
        let (session, queue, api) = try fixture(
            behavior: .respond(status: 403, body: #"{"error":"Consent required","error_code":"CONSENT_REQUIRED"}"#)
        )
        let reporter = FailureReportRecorder()
        await UsageEventUploader.shared.flush(
            session: session, api: api, queue: queue, maxBatches: 2,
            reportFailure: { reporter.record($0, $1) }
        )
        XCTAssertEqual(UsageUploadURLProtocol.requestCount, 1)
        XCTAssertEqual(queue.count, 150)
        XCTAssertEqual(reporter.reports.count, 0, "동의 전 403 이 이슈로 올라가면 BG 사이클마다 허위 경보다")
    }

    func testOther403IsStillReported() async throws {
        // 반대편 고정 — 동의 코드가 아닌 403 은 그대로 이슈다(조용히 삼키는 범위를 넓히지 않는다).
        let (session, queue, api) = try fixture(
            behavior: .respond(status: 403, body: #"{"error":"Forbidden","error_code":"VOICE_LOCKED_FREE_PLAN"}"#)
        )
        let reporter = FailureReportRecorder()
        await UsageEventUploader.shared.flush(
            session: session, api: api, queue: queue, maxBatches: 1,
            reportFailure: { reporter.record($0, $1) }
        )
        XCTAssertEqual(queue.count, 150)
        XCTAssertEqual(reporter.reports.count, 1)
    }

    func testChangedSessionDoesNotSendOldEvents() async throws {
        let (session, queue, api) = try fixture()
        try KeychainStore.saveSession(AuthSession(token: "replacement-token", user: session.user))
        await UsageEventUploader.shared.flush(session: session, api: api, queue: queue, maxBatches: 1)
        XCTAssertEqual(UsageUploadURLProtocol.requestCount, 0)
        XCTAssertEqual(queue.count, 150)
    }

    func testCancelledRunDoesNotSend() async throws {
        let (session, queue, api) = try fixture()
        let task = Task { @MainActor in
            await UsageEventUploader.shared.flush(session: session, api: api, queue: queue, maxBatches: 1)
        }
        task.cancel()
        await task.value
        XCTAssertEqual(UsageUploadURLProtocol.requestCount, 0)
        XCTAssertEqual(queue.count, 150)
    }

    /// **전송 도중 취소된 요청은 이슈가 아니다.** 이미 날아간 URLSession 요청은
    /// `CancellationError` 가 아니라 `URLError(.cancelled)` 로 돌아오는데, 그 코드는
    /// `AlarmTalkLog.isExpectedTransientFailure` 의 일시적 네트워크 목록에 없어 `reportError`
    /// 에 넘기면 Sentry 이슈가 됐다. 큐는 그대로라 잃는 것이 없는 허위 경보다.
    ///
    /// 여기서는 Task 취소 없이 URLSession 만 `.cancelled` 를 주게 해, `Task.isCancelled` 가
    /// 아니라 **오류 자체**로 취소를 알아보는 갈래를 본다. 배치 예산을 2로 줘도 두 번째
    /// 배치로 넘어가지 않는다.
    func testCancelledURLErrorMidFlightIsNotReportedAndKeepsQueue() async throws {
        let (session, queue, api) = try fixture(behavior: .fail(.cancelled))
        let reporter = FailureReportRecorder()
        await UsageEventUploader.shared.flush(
            session: session, api: api, queue: queue, maxBatches: 2,
            reportFailure: { reporter.record($0, $1) }
        )
        XCTAssertEqual(UsageUploadURLProtocol.requestCount, 1, "취소된 회차는 다음 배치로 넘어가지 않는다")
        XCTAssertEqual(queue.count, 150, "취소는 큐를 지우지 않는다")
        XCTAssertTrue(reporter.reports.isEmpty, "취소는 이슈가 아니다 — reportFailure 가 불리면 안 된다")
    }

    /// BG 워치독(25초)·시스템 만료가 하는 일을 그대로 재현한다: 요청이 **나간 뒤에**
    /// 감싸는 Task 를 취소한다. 응답을 주지 않는 스텁 위에서 URLSession 은 `URLError(.cancelled)`
    /// 로 돌아오고, 업로더는 이슈를 올리지 않고 큐를 그대로 둔 채 회차를 끝내야 한다.
    func testTaskCancellationMidFlightIsNotReportedAndKeepsQueue() async throws {
        let started = expectation(description: "usage upload request started")
        let (session, queue, api) = try fixture(behavior: .hang, onRequestStart: { started.fulfill() })
        let reporter = FailureReportRecorder()
        let task = Task { @MainActor in
            await UsageEventUploader.shared.flush(
                session: session, api: api, queue: queue, maxBatches: 2,
                reportFailure: { reporter.record($0, $1) }
            )
        }
        await fulfillment(of: [started], timeout: 5)
        task.cancel()
        await task.value
        XCTAssertEqual(UsageUploadURLProtocol.requestCount, 1, "취소된 회차는 다음 배치로 넘어가지 않는다")
        XCTAssertEqual(queue.count, 150, "취소는 큐를 지우지 않는다")
        XCTAssertTrue(reporter.reports.isEmpty, "전송 도중 취소는 이슈가 아니다")
    }
}

/// `flush` 의 `reportFailure` 자리에 꽂아, 무엇이 **이슈로 올라갈 뻔했는지** 적는다.
/// 유닛 테스트는 Sentry 를 켜지 않으므로 SDK 로는 볼 수 없다(`AlarmTalkLog.shouldStartCrashReporting`).
@MainActor
private final class FailureReportRecorder {
    private(set) var reports: [(message: String, error: Error)] = []

    func record(_ message: String, _ error: Error) {
        reports.append((message, error))
    }
}

private final class UsageUploadURLProtocol: URLProtocol, @unchecked Sendable {
    enum Behavior {
        /// 이 상태코드(와 본문)로 응답한다. 본문은 서버 `error_code` 를 실어야 할 때만 바꾼다.
        case respond(status: Int, body: String = "{}")
        /// 응답 대신 이 오류로 끝낸다 — 전송 도중 취소된 URLSession 이 `.cancelled` 로 그렇게 돌아온다.
        case fail(URLError.Code)
        /// 응답을 주지 않고 매달린다 — 취소가 **전송 도중** 오게 만들 때 쓴다.
        case hang
    }

    private static let lock = NSLock()
    private nonisolated(unsafe) static var behavior: Behavior = .respond(status: 200)
    private nonisolated(unsafe) static var requests = 0
    private nonisolated(unsafe) static var onRequestStart: (@Sendable () -> Void)?

    static var requestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return requests
    }

    static func configure(behavior: Behavior, onRequestStart: (@Sendable () -> Void)? = nil) {
        lock.lock()
        defer { lock.unlock() }
        self.behavior = behavior
        self.onRequestStart = onRequestStart
        requests = 0
    }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "usage-upload.example.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.requests += 1
        let behavior = Self.behavior
        let onRequestStart = Self.onRequestStart
        Self.lock.unlock()
        onRequestStart?()
        switch behavior {
        case .respond(let status, let body):
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
                httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        case .fail(let code):
            client?.urlProtocol(self, didFailWithError: URLError(code))
        case .hang:
            // 취소되면 URLSession 이 `stopLoading` 을 부르고 스스로 `.cancelled` 로 끝낸다.
            break
        }
    }

    override func stopLoading() {}
}
