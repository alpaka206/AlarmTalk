import Foundation
import XCTest
@testable import AlarmTalk

/// **화면 진입 갱신의 신선도 창**(`docs/spec/plan-gates.md` §4, 2026-09-29).
///
/// 편집기·구성원·이용권 화면과 목소리·더보기 탭이 뜰 때마다 같은 목록을 다시 받던 것을, 같은
/// 계정의 **완결된** 갱신이 같은 앱 진입 안에서 60초 안에 있었으면 건너뛰게 했다. 창이 가리면
/// 안 되는 것 — 쓰기 뒤·푸시의 `force` 갱신, 실패한 갱신 뒤의 진입, 다른 계정, 다음 앱 진입,
/// 백그라운드를 건너 늦게 도착한 옛 답 — 을 고정한다.
///
/// 네트워크는 타지 않는다 — `URLProtocol` 스텁(`BillingPreflightTests` 와 같은 방식).
@MainActor
final class EntryRefreshFreshnessTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: - 창 자체

    func test_같은_계정_같은_진입의_60초_안만_신선하다() {
        var freshness = EntryRefreshFreshness()
        XCTAssertFalse(freshness.isFresh(userID: "u1", entry: 1, now: t0), "받은 적이 없으면 받는다")

        freshness.record(.init(userID: "u1", entry: 1, at: t0))
        XCTAssertTrue(freshness.isFresh(userID: "u1", entry: 1, now: t0.addingTimeInterval(59)))
        XCTAssertFalse(freshness.isFresh(userID: "u1", entry: 1, now: t0.addingTimeInterval(60)), "60초가 지나면 다시 받는다")
        XCTAssertFalse(freshness.isFresh(userID: "u2", entry: 1, now: t0.addingTimeInterval(1)), "다른 계정의 창이 아니다")
        XCTAssertFalse(freshness.isFresh(userID: "u1", entry: 2, now: t0.addingTimeInterval(1)), "앱에 다시 들어오면 다시 받는다")
        XCTAssertFalse(freshness.isFresh(userID: "u1", entry: 1, now: t0.addingTimeInterval(-1)), "시계가 뒤로 가면 모른다")

        freshness.reset()
        XCTAssertFalse(freshness.isFresh(userID: "u1", entry: 1, now: t0.addingTimeInterval(1)))
    }

    /// 회귀(감사 H3): 키에 토큰이 있으면 `/auth/me` 가 토큰을 굴릴 때마다 스로틀 표가 통째로 무효가 됐다.
    /// 키를 만드는 함수가 토큰을 받지 않는다 — 계정과 탭만으로 갈린다.
    func test_탭_스로틀_키는_토큰이_아니라_탭과_계정이다() {
        let alarmsA = MainTabsView.tabRefreshThrottleKey(tab: .alarms, userID: "u1")
        XCTAssertEqual(alarmsA, MainTabsView.tabRefreshThrottleKey(tab: .alarms, userID: "u1"))
        XCTAssertNotEqual(alarmsA, MainTabsView.tabRefreshThrottleKey(tab: .alarms, userID: "u2"))
        XCTAssertNotEqual(alarmsA, MainTabsView.tabRefreshThrottleKey(tab: .menu, userID: "u1"))
    }

    // MARK: - 이용권 새로고침

    func test_이용권_진입_갱신은_창_안에서_다시_받지_않고_force_와_실패는_창을_무시한다() async throws {
        let meFails = LockedFlag()
        let clock = TestClock(now: t0)
        try await withSocialViewModel(clock: clock, meFails: meFails) { vm, current, meCalls, _ in
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 1)
            XCTAssertTrue(vm.entitlementSnapshotComplete)

            clock.now = t0.addingTimeInterval(30)
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 1, "같은 진입의 1분 안 — 편집기·구성원·이용권 화면이 뜰 때마다 다시 받지 않는다")

            await vm.refreshAll(session: current, force: true)
            XCTAssertEqual(meCalls(), 2, "쓰기 뒤·푸시(`force`)는 창을 보지 않는다")

            // 첫 갱신(t0)에서는 80초, force 갱신(t0+30)에서는 50초 — 창은 뒤의 것부터 잰다.
            clock.now = t0.addingTimeInterval(80)
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 2, "창은 마지막으로 완결된 갱신(force 포함)부터 잰다")

            clock.now = t0.addingTimeInterval(91)
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 3, "1분이 지나면 다시 받는다")

            clock.entry = 2
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 4, "앱에 다시 들어오면(백그라운드를 거쳐) 다시 받는다")

            meFails.value = true
            await vm.refreshAll(session: current, force: true)
            XCTAssertEqual(meCalls(), 5)
            XCTAssertFalse(vm.entitlementSnapshotComplete)
            meFails.value = false
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 6, "가장 최근 갱신이 실패했으면 창은 닫혀 있다 — 진입이 다시 받는다")
            XCTAssertTrue(vm.entitlementSnapshotComplete)

            vm.clearUserScopedRemoteState()
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 7, "계정 상태를 비우면(로그아웃·계정 전환) 창도 비워진다")
        }
    }

    /// 회귀(코덱스 #823): 요청을 보낸 뒤 백그라운드를 거쳐 다음 진입에 응답이 도착해도, 창에는
    /// **보낸 진입**을 적는다 — 완료 시점의 진입을 적으면 떠나 있는 동안 받은 옛 답이 돌아온
    /// 진입의 창을 열어 1분 동안 따라잡기를 막는다.
    func test_이용권_응답이_다음_진입에_도착하면_그_진입의_창을_열지_않는다() async throws {
        let clock = TestClock(now: t0)
        let backgroundOnce = LockedFlag()
        backgroundOnce.value = true
        try await withSocialViewModel(clock: clock, onMe: {
            // `/auth/me` 가 서버에 가 있는 사이 백그라운드를 거쳐 다시 들어왔다.
            if backgroundOnce.value { backgroundOnce.value = false; clock.entry += 1 }
        }) { vm, current, meCalls, _ in
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 1)
            XCTAssertTrue(vm.entitlementSnapshotComplete)
            XCTAssertEqual(clock.entry, 2)

            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 2, "진입 1 에 보낸 답으로 진입 2 의 창을 열지 않는다")

            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(meCalls(), 2, "진입 2 에 보낸 답은 진입 2 의 창을 연다")
        }
    }

    /// 회귀(코덱스 #823 3차): 쓰기·푸시 뒤에는 `/auth/me` 를 **대개 한 번** 부른다. 이용권 새로고침이
    /// 끝까지 가면 그 `/auth/me` 로 끝이고, 구독 조회가 실패해 `/auth/me` 전에 멈추면 사용자
    /// 새로고침으로 plan 을 받는다 — 확정할 트랜잭션이 없는 회차(만료 뒤 구독 관리·복원할 것 없음)에는
    /// `onServerEntitlementUpdated` 가 사용자를 대신 읽어 주지 않는다.
    func test_이용권_새로고침이_끝까지_못_가면_사용자_새로고침으로_plan_을_받는다() async throws {
        let subscriptionFails = LockedFlag()
        try await withSocialViewModel(clock: TestClock(now: t0), subscriptionFails: subscriptionFails) { vm, current, meCalls, api in
            let auth = AuthViewModel(api: api)
            auth._setSessionForTesting(current)
            XCTAssertEqual(auth.session?.user.plan, "free")

            await vm.refreshAllThenUserIfIncomplete(auth: auth)
            XCTAssertTrue(vm.entitlementSnapshotComplete)
            XCTAssertEqual(meCalls(), 1, "끝까지 갔으면 그 `/auth/me` 로 끝이다 — 사용자 새로고침을 또 부르지 않는다")

            subscriptionFails.value = true
            await vm.refreshAllThenUserIfIncomplete(auth: auth)
            XCTAssertFalse(vm.entitlementSnapshotComplete)
            XCTAssertEqual(meCalls(), 2, "구독 조회에서 멈추면 이용권 쪽 `/auth/me` 는 안 나간다 — 사용자 새로고침이 한 번 받는다")
            XCTAssertEqual(auth.session?.user.plan, "family", "그 사용자 새로고침이 서버의 지금 plan 을 세션에 넣는다")
        }
    }

    // MARK: - 목소리 새로고침

    func test_목소리_진입_갱신은_창_안에서_다시_받지_않고_반쪽_갱신은_창을_열지_않는다() async throws {
        let quotaFails = LockedFlag()
        let clock = TestClock(now: t0)
        try await withVoiceViewModel(clock: clock, quotaFails: quotaFails) { vm, current, listCalls in
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 1)
            XCTAssertNotNil(vm.draftQuota)

            clock.now = t0.addingTimeInterval(10)
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 1, "편집기를 열 때마다 목소리 목록을 다시 받지 않는다")

            vm.clearPaidVoiceState()
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 2, "무료 정리로 목록을 손으로 깎았으면 다음 진입은 다시 받는다")

            quotaFails.value = true
            await vm.refresh(session: current, force: true)
            XCTAssertEqual(listCalls(), 3)
            quotaFails.value = false
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 4, "한도를 못 받은 반쪽 갱신은 창을 열지 않는다")

            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 4)
        }
    }

    /// 회귀(코덱스 #823): 목소리 쪽도 보낸 진입을 적는다.
    func test_목소리_응답이_다음_진입에_도착하면_그_진입의_창을_열지_않는다() async throws {
        let clock = TestClock(now: t0)
        let backgroundOnce = LockedFlag()
        backgroundOnce.value = true
        try await withVoiceViewModel(clock: clock, onList: {
            if backgroundOnce.value { backgroundOnce.value = false; clock.entry += 1 }
        }) { vm, current, listCalls in
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 1)
            XCTAssertEqual(clock.entry, 2)

            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 2, "진입 1 에 보낸 답으로 진입 2 의 창을 열지 않는다")
        }
    }

    /// 회귀(코덱스 #823 2차): 목소리 갱신에는 세대 가드가 없어 `force` 가 진행 중인 갱신과 겹쳐 돈다.
    /// 앞서 받아들인 진입 갱신이 뒤의 `force` 갱신(반쪽으로 끝남)보다 **늦게** 끝나도 창을 다시 열면
    /// 안 된다 — 열면 다음 진입이 그 반쪽을 메울 재시도를 건너뛴다.
    func test_뒤에_시작한_force_갱신이_반쪽이면_늦게_끝난_앞_갱신이_창을_열지_못한다() async throws {
        let clock = TestClock(now: t0)
        let gate = ResponseGate()
        let olderListArrived = expectation(description: "앞 갱신의 목록 요청이 서버에 닿았다")
        let olderQuotaAnswered = expectation(description: "앞 갱신의 한도 요청이 답을 받았다")
        let profiles = Data(#"{"profiles":[]}"#.utf8)
        try await withVoiceViewModel(clock: clock, handler: { path, ordinal, reply in
            switch (path, ordinal) {
            case ("voice", 1):
                olderListArrived.fulfill()
                gate.hold { reply(200, profiles) }
            case ("voice/draft-quota", 1):
                reply(200, Self.quotaBody)
                olderQuotaAnswered.fulfill()
            case ("voice/draft-quota", _):
                // 뒤의 force 갱신은 한도를 못 받아 반쪽으로 끝난다.
                reply(503, Data(#"{"error":"unavailable"}"#.utf8))
            default:
                reply(200, profiles)
            }
        }) { vm, current, listCalls in
            let older = Task { await vm.refreshOnEntry(session: current) }
            await fulfillment(of: [olderListArrived, olderQuotaAnswered], timeout: 5)
            await vm.refresh(session: current, force: true)
            gate.release()
            await older.value
            XCTAssertEqual(listCalls(), 2)

            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 3, "가장 최근에 받아들인 갱신이 반쪽이었으니 창은 닫혀 있다 — 진입이 다시 받는다")
        }
    }

    /// 회귀(코덱스 #823 6차): 목록을 받은 뒤 강등 정합화(`onAuthoritativeRefresh`) 도중 태스크가
    /// 취소되면(탭을 옮김) 창을 열지 않는다 — 열면 회수된 목소리의 예약이 남았는데 1분 안의 진입이
    /// 그 재시도를 건너뛴다.
    func test_강등_정합화_도중_취소되면_목소리_창을_열지_않는다() async throws {
        try await withVoiceViewModel(clock: TestClock(now: t0)) { vm, current, listCalls in
            // 정합화가 도는 사이 사용자가 탭을 옮겨 `.task(id: selectedTab)` 가 취소된다.
            vm.onAuthoritativeRefresh = { withUnsafeCurrentTask { $0?.cancel() } }
            await Task { await vm.refreshOnEntry(session: current) }.value
            XCTAssertEqual(listCalls(), 1)

            vm.onAuthoritativeRefresh = nil
            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 2, "정합화를 끝내지 못한 회차는 창을 열지 않는다 — 다음 진입이 다시 받는다")

            await vm.refreshOnEntry(session: current)
            XCTAssertEqual(listCalls(), 2, "끝까지 간 회차는 창을 연다")
        }
    }

    // MARK: - 픽스처

    nonisolated private static let quotaBody = Data(
        #"{"limit":1,"used":0,"remaining":1,"registration_limit":1,"registration_used":0,"registration_remaining":1}"#.utf8
    )

    private func withSocialViewModel(
        clock: TestClock,
        meFails: LockedFlag = LockedFlag(),
        subscriptionFails: LockedFlag = LockedFlag(),
        onMe: @escaping @Sendable () -> Void = {},
        _ body: (SocialFeatureViewModel, AuthSession, @escaping @Sendable () -> Int, AlarmTalkAPI) async throws -> Void
    ) async throws {
        let userID = UUID().uuidString
        let current = AuthSession(token: UUID().uuidString, user: AuthUser(id: userID, email: "entry@example.test"))
        let host = "\(UUID().uuidString.lowercased()).entry-refresh.example.test"
        let previous = KeychainStore.readSession()
        // 권한 스냅샷의 문(`EntitlementWriter`)은 키체인의 세션과 대조한다.
        try KeychainStore.saveSession(current)
        let me = try JSONSerialization.data(withJSONObject: [
            "user": ["id": userID, "email": "entry@example.test", "name": "Test", "plan": "family", "deletion_status": "active"]
        ])
        EntryRefreshURLProtocol.configureSync(host: host) { path in
            switch path {
            case "auth/me":
                onMe()
                return meFails.value ? (503, Data(#"{"error":"unavailable"}"#.utf8)) : (200, me)
            case "billing/subscription":
                if subscriptionFails.value { return (503, Data(#"{"error":"unavailable"}"#.utf8)) }
                return (200, Data(#"{"subscription":null,"plan":null,"next_plan":null,"store_renewal_providers":[]}"#.utf8))
            case "billing/vouchers":
                return (200, Data(#"{"vouchers":[]}"#.utf8))
            default:
                return (200, Data(#"{"group":null,"role":null,"members":[]}"#.utf8))
            }
        }
        let urlSession = Self.stubbedSession()
        defer {
            urlSession.invalidateAndCancel()
            EntryRefreshURLProtocol.configure(host: host, handler: nil)
            AccessSnapshotStore().clear(userID: userID)
            if let previous { try? KeychainStore.saveSession(previous) } else { KeychainStore.deleteSession() }
        }
        let api = AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: urlSession)
        let vm = SocialFeatureViewModel(api: api)
        vm.entryRefreshClock = { (clock.entry, clock.now) }
        try await body(vm, current, { EntryRefreshURLProtocol.count(host: host, path: "auth/me") }, api)
    }

    private func withVoiceViewModel(
        clock: TestClock,
        quotaFails: LockedFlag = LockedFlag(),
        onList: @escaping @Sendable () -> Void = {},
        handler: EntryRefreshURLProtocol.Handler? = nil,
        _ body: (VoiceStudioViewModel, AuthSession, @escaping @Sendable () -> Int) async throws -> Void
    ) async throws {
        let current = AuthSession(token: UUID().uuidString, user: AuthUser(id: UUID().uuidString, email: "entry@example.test"))
        let host = "\(UUID().uuidString.lowercased()).entry-refresh.example.test"
        if let handler {
            EntryRefreshURLProtocol.configure(host: host, handler: handler)
        } else {
            EntryRefreshURLProtocol.configureSync(host: host) { path in
                switch path {
                case "voice/draft-quota":
                    if quotaFails.value { return (503, Data(#"{"error":"unavailable"}"#.utf8)) }
                    return (200, Self.quotaBody)
                case "voice":
                    onList()
                    return (200, Data(#"{"profiles":[]}"#.utf8))
                default:
                    // `voice/family` — 공유받은 목소리도 없다.
                    return (200, Data(#"{"profiles":[]}"#.utf8))
                }
            }
        }
        let urlSession = Self.stubbedSession()
        defer {
            urlSession.invalidateAndCancel()
            EntryRefreshURLProtocol.configure(host: host, handler: nil)
        }
        let vm = VoiceStudioViewModel(api: AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: urlSession))
        vm.entryRefreshClock = { (clock.entry, clock.now) }
        try await body(vm, current) { EntryRefreshURLProtocol.count(host: host, path: "voice") }
    }

    private static func stubbedSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [EntryRefreshURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

/// 신선도 창이 보는 진입 번호·시각. 스텁 핸들러(네트워크 스레드)가 '백그라운드를 거쳐 돌아옴' 을
/// 흉내 내려고 진입 번호를 바꾸므로 잠금으로 감싼다.
private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var storedEntry = 1
    private var storedNow: Date

    init(now: Date) { storedNow = now }

    var entry: Int {
        get { lock.lock(); defer { lock.unlock() }; return storedEntry }
        set { lock.lock(); storedEntry = newValue; lock.unlock() }
    }

    var now: Date {
        get { lock.lock(); defer { lock.unlock() }; return storedNow }
        set { lock.lock(); storedNow = newValue; lock.unlock() }
    }
}

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var stored = false

    var value: Bool {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
}

/// 응답을 붙들었다가 풀어 주는 문 — 앞 요청을 뒤 요청보다 늦게 끝나게 한다.
private final class ResponseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: (@Sendable () -> Void)?
    private var released = false

    func hold(_ completion: @escaping @Sendable () -> Void) {
        lock.lock()
        if released { lock.unlock(); completion(); return }
        pending = completion
        lock.unlock()
    }

    func release() {
        lock.lock()
        released = true
        let completion = pending
        pending = nil
        lock.unlock()
        completion?()
    }
}

/// 호스트별로 응답을 고르고 **경로별 호출 수**를 센다. 경로는 `/api/` 뒤(`auth/me`, `voice` …).
/// 핸들러는 그 경로의 몇 번째 호출인지(1부터)를 함께 받고, 답은 나중에 보내도 된다.
private final class EntryRefreshURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Reply = @Sendable (Int, Data) -> Void
    typealias Handler = @Sendable (_ path: String, _ ordinal: Int, _ reply: @escaping Reply) -> Void
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    nonisolated(unsafe) private static var counts: [String: [String: Int]] = [:]

    static func configure(host: String, handler: Handler?) {
        lock.lock()
        defer { lock.unlock() }
        handlers[host] = handler
        if handler == nil { counts[host] = nil }
    }

    static func configureSync(host: String, _ handler: @escaping @Sendable (String) -> (Int, Data)) {
        configure(host: host) { path, _, reply in
            let (status, data) = handler(path)
            reply(status, data)
        }
    }

    static func count(host: String, path: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return counts[host]?[path] ?? 0
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasSuffix(".entry-refresh.example.test") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let host = url.host else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let path = url.path.components(separatedBy: "/api/").last ?? url.path
        Self.lock.lock()
        let handler = Self.handlers[host]
        var ordinal = 0
        if handler != nil {
            ordinal = (Self.counts[host]?[path] ?? 0) + 1
            Self.counts[host, default: [:]][path] = ordinal
        }
        Self.lock.unlock()
        guard let handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
            return
        }
        handler(path, ordinal) { [self] status, data in
            client?.urlProtocol(self, didReceive: HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
