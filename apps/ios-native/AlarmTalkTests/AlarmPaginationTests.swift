import Foundation
import XCTest
@testable import AlarmTalk

/// #730 — 목록을 다 받은 뒤에만 pull에 넘긴다. 실제 서버/알람 엔진은 실행하지 않는다.
@MainActor
final class AlarmPaginationTests: XCTestCase {
    private func page(_ range: Range<Int>, hasMore: Bool, total: Int? = nil) throws -> Data {
        var body: [String: Any] = ["alarms": range.map {
            ["id": String(format: "alarm-%03d", $0), "is_received_family_alarm": $0 == 250] as [String: Any]
        }, "has_more": hasMore]
        if hasMore, let last = range.last { body["next_cursor"] = String(format: "alarm-%03d", last) }
        if let total { body["total"] = total }
        return try JSONSerialization.data(withJSONObject: body)
    }

    private func withAPI(
        pages: [String: (Int, Data)],
        _ body: (AlarmTalkAPI, AlarmPageFixture) async throws -> Void
    ) async throws {
        let host = "\(UUID().uuidString.lowercased()).alarm-pages.example.test"
        let fixture = AlarmPageFixture(pages: pages)
        AlarmPageURLProtocol.configure(host: host, fixture: fixture)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AlarmPageURLProtocol.self]
        let session = URLSession(configuration: config)
        defer {
            session.invalidateAndCancel()
            AlarmPageURLProtocol.configure(host: host, fixture: nil)
        }
        let api = AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: session)
        try await body(api, fixture)
        for request in fixture.requests {
            XCTAssertEqual(request.url?.path, "/api/alarm")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer alarm-test-token")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
                .first(where: { $0.name == "limit" })?.value, "100")
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first(where: { $0.name == "pagination" })?.value, "cursor")
            XCTAssertFalse(query?.contains(where: { $0.name == "offset" }) ?? true)
        }
    }

    func test_readsAllPagesIncludingFamilyAlarmBeyondFirstFifty() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "alarm-099": (200, try page(100..<200, hasMore: true)),
            "alarm-199": (200, try page(200..<251, hasMore: false)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.map(\.id), (0..<251).map { String(format: "alarm-%03d", $0) })
            XCTAssertEqual(alarms.last?.isReceivedFamilyAlarm, true)
            XCTAssertEqual(fixture.cursors, ["", "alarm-099", "alarm-199"])
        }
    }

    func test_exactPageBoundaryStopsAtServerEndCursor() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "alarm-099": (200, try page(100..<200, hasMore: false)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 200)
            XCTAssertEqual(fixture.cursors, ["", "alarm-099"])
        }
    }

    func test_emptySnapshotStopsAfterFirstPage() async throws {
        try await withAPI(pages: ["": (200, try page(0..<0, hasMore: false))]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertTrue(alarms.isEmpty)
            XCTAssertEqual(fixture.cursors, [""])
        }
    }

    func test_shrinkingTotalDoesNotEndCursorTraversalEarly() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true, total: 201)),
            "alarm-099": (200, try page(100..<200, hasMore: true, total: 200)),
            "alarm-199": (200, try page(200..<201, hasMore: false, total: 200)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 201)
            XCTAssertEqual(fixture.cursors, ["", "alarm-099", "alarm-199"])
        }
    }

    func test_shortPageStillContinuesWhenServerHasAnotherCursor() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<2, hasMore: true)),
            "alarm-001": (200, try page(2..<3, hasMore: false)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 3)
            XCTAssertEqual(fixture.cursors, ["", "alarm-001"])
        }
    }

    func test_failedLaterPageThrowsInsteadOfReturningPartialAlarms() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "alarm-099": (503, Data(#"{"error":"temporarily unavailable"}"#.utf8)),
        ]) { api, fixture in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("첫 100개를 성공으로 반환하면 안 된다")
            } catch APIError.server(let status, _, _) { XCTAssertEqual(status, 503) }
            XCTAssertEqual(fixture.cursors, ["", "alarm-099"])
        }
    }

    func test_emptyIncompletePageThrowsInsteadOfLoopingOrReturningPartialAlarms() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "alarm-099": (200, try page(100..<100, hasMore: true)),
        ]) { api, fixture in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("계속 진행하라면서 커서도 행도 없는 페이지는 불완전 응답이다")
            } catch APIError.invalidResponse { }
            XCTAssertEqual(fixture.cursors, ["", "alarm-099"])
        }
    }

    func test_overlappingPagesRequireRetryRatherThanDuplicateSnapshot() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "alarm-099": (200, try page(99..<100, hasMore: true)),
        ]) { api, fixture in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("페이지 경계에서 목록이 움직인 회차는 다시 읽어야 한다")
            } catch APIError.invalidResponse { }
            XCTAssertEqual(fixture.cursors, ["", "alarm-099"])
        }
    }

    func test_cancelledPullDoesNotStartPaging() async throws {
        try await withAPI(pages: [:]) { api, fixture in
            let task = Task { try await api.listAlarms(token: "alarm-test-token") }
            task.cancel()
            do {
                _ = try await task.value
                XCTFail("취소된 pull은 snapshot을 반환하지 않는다")
            } catch is CancellationError { }
            XCTAssertTrue(fixture.requests.isEmpty)
        }
    }

    func test_legacyOffsetResponseCannotBeAcceptedAsComplete() async throws {
        try await withAPI(pages: ["": (200, Data(#"{"alarms":[],"total":0}"#.utf8))]) { api, _ in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("커서 계약이 없는 서버로 offset 폴백하지 않는다")
            } catch is DecodingError { }
        }
    }

    func test_remainingRowsDeletedAfterFirstPageCanEndWithEmptyCursorPage() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "alarm-099": (200, try page(100..<100, hasMore: false)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 100)
            XCTAssertEqual(fixture.cursors, ["", "alarm-099"])
        }
    }
}

private final class AlarmPageFixture: @unchecked Sendable {
    private let pages: [String: (Int, Data)]
    private let lock = NSLock()
    private var recorded: [URLRequest] = []
    init(pages: [String: (Int, Data)]) { self.pages = pages }
    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }
    var cursors: [String] { requests.map(Self.cursor) }
    private static func cursor(_ request: URLRequest) -> String {
        guard let url = request.url else { return "" }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
            .first(where: { $0.name == "after" })?.value ?? ""
    }
    func respond(to request: URLRequest) -> (Int, Data) {
        lock.lock()
        defer { lock.unlock() }
        recorded.append(request)
        guard let page = pages[Self.cursor(request)] else {
            return (500, Data(#"{"error":"unexpected page"}"#.utf8))
        }
        return page
    }
}

private final class AlarmPageURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    // 호스트별 격리: 앞 테스트의 취소된 요청이 다음 테스트의 응답을 소비하지 않는다.
    nonisolated(unsafe) private static var fixtures: [String: AlarmPageFixture] = [:]
    static func configure(host: String, fixture: AlarmPageFixture?) {
        lock.lock()
        defer { lock.unlock() }
        fixtures[host] = fixture
    }
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasSuffix(".alarm-pages.example.test") == true
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
