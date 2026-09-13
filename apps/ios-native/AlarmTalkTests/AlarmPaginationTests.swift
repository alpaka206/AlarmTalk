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
        if hasMore, let last = range.last { body["next_cursor"] = String(last + 1) }
        if let total { body["total"] = total }
        return try JSONSerialization.data(withJSONObject: body)
    }

    private func deliveryPage(
        _ version: String?, next: String? = nil, leadingID: String? = nil,
        active: Bool = true, snooze: Int = 5
    ) throws -> Data {
        var rows: [[String: Any]] = []
        if let leadingID { rows.append(["id": leadingID]) }
        var family: [String: Any] = ["id": "family", "is_active": active, "snooze_minutes": snooze]
        if let version { family["delivery_version"] = version }
        rows.append(family)
        var body: [String: Any] = ["alarms": rows, "has_more": next != nil]
        if let next { body["next_cursor"] = next }
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
            if query?.contains(where: { $0.name == "offset" }) == true {
                XCTAssertFalse(query?.contains(where: { $0.name == "pagination" || $0.name == "after" }) ?? true)
            } else {
                XCTAssertEqual(query?.first(where: { $0.name == "pagination" })?.value, "cursor")
            }
        }
    }

    func test_readsAllPagesIncludingFamilyAlarmBeyondFirstFifty() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "100": (200, try page(100..<200, hasMore: true)),
            "200": (200, try page(200..<251, hasMore: false)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.map(\.id), (0..<251).map { String(format: "alarm-%03d", $0) })
            XCTAssertEqual(alarms.last?.isReceivedFamilyAlarm, true)
            XCTAssertEqual(fixture.cursors, ["", "100", "200"])
        }
    }

    func test_exactPageBoundaryStopsAtServerEndCursor() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "100": (200, try page(100..<200, hasMore: false)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 200)
            XCTAssertEqual(fixture.cursors, ["", "100"])
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
            "100": (200, try page(100..<200, hasMore: true, total: 200)),
            "200": (200, try page(200..<201, hasMore: false, total: 200)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 201)
            XCTAssertEqual(fixture.cursors, ["", "100", "200"])
        }
    }

    func test_shortPageStillContinuesWhenServerHasAnotherCursor() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<2, hasMore: true)),
            "2": (200, try page(2..<3, hasMore: false)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 3)
            XCTAssertEqual(fixture.cursors, ["", "2"])
        }
    }

    func test_failedLaterPageThrowsInsteadOfReturningPartialAlarms() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "100": (503, Data(#"{"error":"temporarily unavailable"}"#.utf8)),
        ]) { api, fixture in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("첫 100개를 성공으로 반환하면 안 된다")
            } catch APIError.server(let status, _, _) { XCTAssertEqual(status, 503) }
            XCTAssertEqual(fixture.cursors, ["", "100"])
        }
    }

    func test_emptyIncompletePageThrowsInsteadOfLoopingOrReturningPartialAlarms() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "100": (200, try page(100..<100, hasMore: true)),
        ]) { api, fixture in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("계속 진행하라면서 커서도 행도 없는 페이지는 불완전 응답이다")
            } catch APIError.invalidResponse { }
            XCTAssertEqual(fixture.cursors, ["", "100"])
        }
    }

    func test_overlappingPagesRequireRetryRatherThanDuplicateSnapshot() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "100": (200, try page(99..<100, hasMore: true)),
        ]) { api, fixture in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("페이지 경계에서 목록이 움직인 회차는 다시 읽어야 한다")
            } catch APIError.invalidResponse { }
            XCTAssertEqual(fixture.cursors, ["", "100"])
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

    func test_incompleteLegacyResponseCannotBeAcceptedAsComplete() async throws {
        try await withAPI(pages: ["": (200, Data(#"{"alarms":[],"total":0}"#.utf8))]) { api, _ in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("구서버도 total/limit/offset 계약이 모두 필요하다")
            } catch APIError.invalidResponse { }
        }
    }

    private func legacyPage(_ range: Range<Int>, total: Int = 251) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "alarms": range.map { ["id": "alarm-\($0)", "is_received_family_alarm": $0 == 250] as [String: Any] },
            "total": total, "limit": 100, "offset": range.lowerBound,
        ])
    }

    func test_legacyServerReadsFamilyAlarmAndProbesEmptyPageDespiteShrinkingTotal() async throws {
        try await withAPI(pages: [
            "": (200, try legacyPage(0..<100)),
            "offset-100": (200, try legacyPage(100..<200, total: 1)),
            "offset-200": (200, try legacyPage(200..<251, total: 1)),
            "offset-251": (200, try legacyPage(251..<251, total: 1)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 251)
            XCTAssertEqual(alarms.last?.isReceivedFamilyAlarm, true)
            XCTAssertEqual(fixture.cursors, ["", "offset-100", "offset-200", "offset-251"])
        }
    }

    func test_legacyExactBoundaryRequiresEmptyPage() async throws {
        try await withAPI(pages: [
            "": (200, try legacyPage(0..<100, total: 100)),
            "offset-100": (200, try legacyPage(100..<100, total: 100)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 100)
            XCTAssertEqual(fixture.cursors, ["", "offset-100"])
        }
        try await withAPI(pages: ["": (200, try legacyPage(0..<0, total: 0))]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertTrue(alarms.isEmpty)
            XCTAssertEqual(fixture.cursors, [""])
        }
    }

    func test_legacyInvalidOrChangedContractsAndDuplicatesRejectPartialCollection() async throws {
        let invalidBodies = [
            #"{"alarms":[],"total":1,"offset":1}"#,
            #"{"alarms":[],"total":1,"limit":0,"offset":1}"#,
            #"{"alarms":[],"total":1,"limit":101,"offset":1}"#,
            #"{"alarms":[],"total":-1,"limit":100,"offset":1}"#,
            #"{"alarms":[],"total":1,"limit":100,"offset":0}"#,
            #"{"alarms":[],"total":1,"limit":100,"offset":1,"next_cursor":"2"}"#,
            #"{"alarms":[],"has_more":false}"#,
            #"{"alarms":[{"id":"alarm-0"}],"total":1,"limit":100,"offset":1}"#,
        ]
        for body in invalidBodies {
            try await withAPI(pages: [
                "": (200, try legacyPage(0..<1)), "offset-1": (200, Data(body.utf8)),
            ]) { api, _ in
                do {
                    _ = try await api.listAlarms(token: "alarm-test-token")
                    XCTFail("구서버 호환도 불완전한 회차를 반환하지 않는다: \(body)")
                } catch APIError.invalidResponse { }
            }
        }
        try await withAPI(pages: [
            "": (200, try page(0..<1, hasMore: true)),
            "1": (200, try legacyPage(1..<1)),
        ]) { api, _ in
            do { _ = try await api.listAlarms(token: "alarm-test-token"); XCTFail("커서 회차를 폴백하지 않는다") }
            catch APIError.invalidResponse { }
        }
    }

    func test_legacyLaterFailureDoesNotReturnPartialAlarms() async throws {
        try await withAPI(pages: [
            "": (200, try legacyPage(0..<1)),
            "offset-1": (503, Data(#"{"error":"unavailable"}"#.utf8)),
        ]) { api, fixture in
            do { _ = try await api.listAlarms(token: "alarm-test-token"); XCTFail("부분 성공 금지") }
            catch APIError.server(let status, _, _) { XCTAssertEqual(status, 503) }
            XCTAssertEqual(fixture.cursors, ["", "offset-1"])
        }
    }

    func test_remainingRowsDeletedAfterFirstPageCanEndWithEmptyCursorPage() async throws {
        try await withAPI(pages: [
            "": (200, try page(0..<100, hasMore: true)),
            "100": (200, try page(100..<100, hasMore: false)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 100)
            XCTAssertEqual(fixture.cursors, ["", "100"])
        }
    }

    func test_creationCursorIsIndependentOfUUIDOrder() async throws {
        try await withAPI(pages: [
            "": (200, Data(#"{"alarms":[{"id":"z-old"}],"has_more":true,"next_cursor":"40"}"#.utf8)),
            "40": (200, Data(#"{"alarms":[{"id":"a-new"}],"has_more":false,"next_cursor":null}"#.utf8)),
        ]) { api, fixture in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.map(\.id), ["z-old", "a-new"])
            XCTAssertEqual(fixture.cursors, ["", "40"])
        }
    }

    func test_nonIncreasingOrMalformedCreationCursorCannotCompletePull() async throws {
        for next in ["0", "01", "39", "40", "9007199254740992", "alarm-id"] {
            let invalid = try JSONSerialization.data(withJSONObject: [
                "alarms": [["id": "a-new"]], "has_more": true, "next_cursor": next,
            ])
            try await withAPI(pages: [
                "": (200, Data(#"{"alarms":[{"id":"z-old"}],"has_more":true,"next_cursor":"40"}"#.utf8)),
                "40": (200, invalid),
            ]) { api, fixture in
                do {
                    _ = try await api.listAlarms(token: "alarm-test-token")
                    XCTFail("증가하지 않는 생성 커서를 성공으로 받아들이면 안 된다")
                } catch APIError.invalidResponse { }
                XCTAssertEqual(fixture.cursors, ["", "40"])
            }
        }
    }

    func test_resentDeliveryKeepsOnlyNewestContentsInLatestReadOrder() async throws {
        let initialVersions: [String?] = ["v1", nil]
        for initial in initialVersions {
            try await withAPI(pages: [
                "": (200, try deliveryPage(initial, next: "10", leadingID: "older")),
                "10": (200, try deliveryPage("v2", next: "20", leadingID: "middle", snooze: 10)),
                "20": (200, try deliveryPage("v3", snooze: 12)),
            ]) { api, fixture in
                let alarms = try await api.listAlarms(token: "alarm-test-token")
                XCTAssertEqual(alarms.map(\.id), ["older", "middle", "family"])
                XCTAssertEqual(alarms.last?.deliveryVersion, "v3")
                XCTAssertEqual(alarms.last?.snoozeMinutes, 12)
                XCTAssertEqual(fixture.cursors, ["", "10", "20"])
            }
        }
    }

    func test_slotReplacementCanDeliverDisabledGenerationOnLaterPage() async throws {
        try await withAPI(pages: [
            "": (200, try deliveryPage("v1", next: "10")),
            "10": (200, try deliveryPage("v2", active: false)),
        ]) { api, _ in
            let alarms = try await api.listAlarms(token: "alarm-test-token")
            XCTAssertEqual(alarms.count, 1)
            XCTAssertEqual(alarms.first?.deliveryVersion, "v2")
            XCTAssertEqual(alarms.first?.isActive, false)
        }
    }

    func test_duplicateWithoutNewDeliveryGenerationIsRejected() async throws {
        let versions: [String?] = ["v1", nil, "  "]
        for version in versions {
            try await withAPI(pages: [
                "": (200, try deliveryPage("v1", next: "10")),
                "10": (200, try deliveryPage(version)),
            ]) { api, fixture in
                do {
                    _ = try await api.listAlarms(token: "alarm-test-token")
                    XCTFail("새 전달 버전 없는 중복을 재전송으로 처리하면 안 된다")
                } catch APIError.invalidResponse { }
                XCTAssertEqual(fixture.cursors, ["", "10"])
            }
        }
    }

    func test_previousDeliveryGenerationCannotReappearAfterReplacement() async throws {
        try await withAPI(pages: [
            "": (200, try deliveryPage("v1", next: "10")),
            "10": (200, try deliveryPage("v2", next: "20")),
            "20": (200, try deliveryPage("v1")),
        ]) { api, fixture in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("이미 버린 옛 세대를 최신 세대로 되살리면 안 된다")
            } catch APIError.invalidResponse { }
            XCTAssertEqual(fixture.cursors, ["", "10", "20"])
        }
    }

    func test_duplicateIDWithinOnePageIsNotAnInPlaceResend() async throws {
        let response = Data(#"{"alarms":[{"id":"family","delivery_version":"v1"},{"id":"family","delivery_version":"v2"}],"has_more":false}"#.utf8)
        try await withAPI(pages: ["": (200, response)]) { api, _ in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("한 SELECT에서 같은 id의 두 세대가 나오는 응답은 잘못된 계약이다")
            } catch APIError.invalidResponse { }
        }
    }

    func test_failureAfterResentDeliveryStillRejectsPartialPull() async throws {
        try await withAPI(pages: [
            "": (200, try deliveryPage("v1", next: "10")),
            "10": (200, try deliveryPage("v2", next: "20")),
            "20": (503, Data(#"{"error":"unavailable"}"#.utf8)),
        ]) { api, fixture in
            do {
                _ = try await api.listAlarms(token: "alarm-test-token")
                XCTFail("재전송을 병합했어도 뒤 페이지 실패를 부분 성공으로 반환하지 않는다")
            } catch APIError.server(let status, _, _) { XCTAssertEqual(status, 503) }
            XCTAssertEqual(fixture.cursors, ["", "10", "20"])
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
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        if let offset = query?.first(where: { $0.name == "offset" })?.value { return "offset-\(offset)" }
        return query?.first(where: { $0.name == "after" })?.value ?? ""
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
