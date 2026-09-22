import Foundation
import XCTest
@testable import AlarmTalk

/// **저장이 날씨 조회에 붙잡히지 않는다**(2026-09-22 "인터넷이 느려도 괜찮도록").
///
/// 날씨 테마 알람은 저장하면서 `GET /tts/prerender-variant` 를 기다리는데, 그 서버는 뒤에서
/// open-meteo 를 세 번 순차로 부르는 동안 한 바이트도 보내지 않는다. 상한이 없던 때는
/// 세션의 유휴 타임아웃(60초)까지 저장 버튼이 잠긴 채였다. 지금은
/// `WeatherVariantSaveLookup.timeoutSeconds`(8초)에서 기다리기를 그만두고 **기존 실패와 같은
/// 경로**(미해결로 저장 → `WeatherVariantRefreshService.refreshDue` 가 채움)로 간다.
///
/// 실제 8초를 기다리지 않는다 — 상한은 주입 가능하고 여기서는 0.2초로 잰다.
@MainActor
final class WeatherVariantSaveTimeoutTests: XCTestCase {

    private let now = Int64(Date().timeIntervalSince1970 * 1000)

    private func weatherRecord(currentIndex: Int? = nil) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            id: "weather-save", label: "아침", hour: 7, minute: 0,
            fireAtMillis: now + 60 * 60 * 1000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now, updatedAtMillis: now
        )
        record.enabled = true
        record.bucketId = "weather"
        record.voiceWeatherCountry = "KR"
        record.voiceWeatherCity = "서울"
        record.contextVariantIndex = currentIndex
        return record
    }

    /// 응답을 주지 않는 서버 위의 진짜 `AlarmTalkAPI`.
    ///
    /// 세션의 유휴 타임아웃을 **3초**로 둔다 — 상한이 없으면 조회가 그때 가서야 돌아오므로
    /// 아래 "1.5초 안" 단언이 60초를 매달리지 않고 곧바로 떨어진다. 앱에서는 그 값이
    /// 60초다(`AlarmTalkAPI.makeDefaultSession`).
    private func hangingAPI() -> AlarmTalkAPI {
        HangingWeatherURLProtocol.reset()
        addTeardownBlock { HangingWeatherURLProtocol.reset() }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HangingWeatherURLProtocol.self]
        configuration.timeoutIntervalForRequest = 3
        return AlarmTalkAPI(
            baseURL: URL(string: "https://weather-save.example.test/api/")!,
            session: URLSession(configuration: configuration)
        )
    }

    // ── 상한 ────────────────────────────────────────────────────────────────

    /// 고치기 전에는 실패한다: 조회가 세션 타임아웃(여기서는 3초, 앱은 60초)까지 돌아오지
    /// 않아 1.5초 단언에 걸린다. 상한이 있으면 0.2초에 `nil` 로 끝나고, 취소가 요청까지
    /// 닿아(`stopLoading`) 늦게 올 응답 자체가 없다.
    func test_매달린_요청은_상한_안에_미해결로_끝난다() async {
        let api = hangingAPI()
        let started = Date()

        let index = await WeatherVariantSaveLookup.freshIndex(
            record: weatherRecord(), token: "t", api: api, timeoutSeconds: 0.2
        )

        let elapsed = Date().timeIntervalSince(started)
        XCTAssertNil(index, "상한을 넘긴 조회는 오프라인과 같은 nil 이다")
        XCTAssertLessThan(elapsed, 1.5, "저장이 세션 타임아웃까지 붙잡혔다 (\(elapsed)s)")
        XCTAssertEqual(HangingWeatherURLProtocol.startCount, 1, "요청은 실제로 나갔어야 한다")
        // `stopLoading` 은 세션 내부 큐에서 온다 — 돌아온 직후 한 박자 늦을 수 있어 잠깐 기다린다.
        let stopped = await Self.waitUntil { HangingWeatherURLProtocol.stopCount == 1 }
        XCTAssertTrue(stopped, "상한을 넘기면 요청을 취소해야 한다 — 살려 두면 늦게 온 응답이 생긴다")
    }

    /// 최대 1초 동안 20ms 간격으로 [condition] 을 다시 본다.
    private static func waitUntil(_ condition: @escaping @Sendable () -> Bool) async -> Bool {
        for _ in 0..<50 {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return condition()
    }

    /// 상한을 넘긴 결과는 **기존 실패 규약과 같다**: 새 알람은 미해결로 남고 준비창 갱신이
    /// 대상으로 잡으며(`weatherVariantNeedsRefresh`), 편집 중인 알람은 옛 값을 지킨다.
    func test_상한_초과는_오프라인과_같은_저장_규약이다() async {
        let api = hangingAPI()
        let fresh = await WeatherVariantSaveLookup.freshIndex(
            record: weatherRecord(), token: "t", api: api, timeoutSeconds: 0.2
        )
        XCTAssertNil(fresh)

        // 새 알람 — 미해결로 저장되고 갱신 대상이다.
        let created = BucketVariantResolver.nextWeatherVariantState(
            nextBucketId: "weather", resetVariant: false,
            currentIndex: nil, currentResolvedAtMillis: nil, freshIndex: fresh
        )
        XCTAssertNil(created.index)
        XCTAssertNil(created.resolvedAtMillis)
        var saved = weatherRecord()
        saved.contextVariantIndex = created.index
        saved.contextResolvedAtMillis = created.resolvedAtMillis
        XCTAssertTrue(
            BucketVariantResolver.weatherVariantNeedsRefresh(saved, nowMillis: now),
            "미해결로 저장된 알람은 refreshDue 가 채워야 한다"
        )

        // 같은 조건의 기존 알람 — 옛 값을 0 으로 덮지 않고 그대로 둔다.
        let edited = BucketVariantResolver.nextWeatherVariantState(
            nextBucketId: "weather", resetVariant: false,
            currentIndex: 5, currentResolvedAtMillis: now - 1000, freshIndex: fresh
        )
        XCTAssertEqual(edited.index, 5)
        XCTAssertEqual(edited.resolvedAtMillis, now - 1000)
    }

    // ── 늦게 온 응답 ───────────────────────────────────────────────────────

    /// 상한 뒤에 도착한 값은 **버려진다.** 취소를 무시하는 스텁이 0.6초 뒤 3 을 돌려주지만
    /// 저장 판정은 `nil` 이어야 한다 — 조회는 한 번만 돌아오므로 그 값이 행에 닿을 길이 없다.
    func test_늦게_온_응답은_값을_덮어쓰지_않는다() async {
        let api = LateResolver(index: 3, delay: 0.6)

        let index = await WeatherVariantSaveLookup.freshIndex(
            record: weatherRecord(), token: "t", api: api, timeoutSeconds: 0.2
        )

        XCTAssertNil(index, "상한 뒤에 온 3 이 저장 판정에 섞였다")
        XCTAssertTrue(api.completed, "스텁이 실제로 값을 만들었어야 '버려졌다' 가 성립한다")
    }

    // ── 반대편 ─────────────────────────────────────────────────────────────

    /// 상한을 걸었다고 **제때 온 답까지** 버리면 안 된다 — 온라인에서는 고른 그 자리에서 맞는
    /// 클립이 정해져야 한다(안드로이드 `withResolvedWeatherVariant` 의 존재 이유).
    func test_제때_온_응답은_그대로_쓴다() async {
        let api = LateResolver(index: 2, delay: 0)

        let index = await WeatherVariantSaveLookup.freshIndex(
            record: weatherRecord(), token: "t", api: api, timeoutSeconds: 0.2
        )

        XCTAssertEqual(index, 2)
        let state = BucketVariantResolver.nextWeatherVariantState(
            nextBucketId: "weather", resetVariant: true,
            currentIndex: 5, currentResolvedAtMillis: now - 1000, freshIndex: index
        )
        XCTAssertEqual(state.index, 2, "새로 받은 값이 reset 보다 먼저다")
    }

    /// 날씨 테마가 아니면 묻지도 기다리지도 않는다.
    func test_날씨_테마가_아니면_묻지_않는다() async {
        let api = LateResolver(index: 2, delay: 0)
        var record = weatherRecord()
        record.bucketId = "medication"

        let index = await WeatherVariantSaveLookup.freshIndex(
            record: record, token: "t", api: api, timeoutSeconds: 0.2
        )

        XCTAssertNil(index)
        XCTAssertEqual(api.calls, 0)
    }

    // ── 헬퍼 자체 ──────────────────────────────────────────────────────────

    /// `withTimeout` 의 세 갈래: 값이 먼저 / 시계가 먼저 / 바깥 취소는 상한 오류로 바꾸지 않는다.
    func test_withTimeout_은_먼저_끝난_쪽이_답이다() async throws {
        let quick = try await withTimeout(seconds: 1) { () async throws -> Int in 7 }
        XCTAssertEqual(quick, 7)

        do {
            _ = try await withTimeout(seconds: 0.05) { () async throws -> Int in
                try await Task.sleep(nanoseconds: 2_000_000_000)
                return 9
            }
            XCTFail("상한을 넘겼는데 값이 돌아왔다")
        } catch let timeout as AsyncTimeoutError {
            XCTAssertEqual(timeout.seconds, 0.05)
        }

        let outer = Task<Int, Error> {
            try await withTimeout(seconds: 5) { () async throws -> Int in
                try await Task.sleep(nanoseconds: 2_000_000_000)
                return 11
            }
        }
        outer.cancel()
        do {
            _ = try await outer.value
            XCTFail("취소됐는데 값이 돌아왔다")
        } catch {
            XCTAssertFalse(error is AsyncTimeoutError, "바깥 취소는 상한 초과가 아니다: \(error)")
            XCTAssertTrue(isCancellation(error), "취소는 취소로 올라가야 한다: \(error)")
        }
    }
}

// MARK: - 스텁

/// 취소를 **무시하는** 조회 — `delay` 뒤에 무조건 `index` 를 돌려준다.
/// 상한 뒤에 도착하는 응답을 만들 때 쓴다(`Task.sleep` 은 취소되면 곧바로 던져서 늦은
/// 응답이 아예 생기지 않는다).
private final class LateResolver: PrerenderVariantResolving, @unchecked Sendable {
    private let lock = NSLock()
    private let index: Int
    private let delay: TimeInterval
    private var _completed = false
    private var _calls = 0

    init(index: Int, delay: TimeInterval) {
        self.index = index
        self.delay = delay
    }

    var completed: Bool {
        lock.lock(); defer { lock.unlock() }
        return _completed
    }

    var calls: Int {
        lock.lock(); defer { lock.unlock() }
        return _calls
    }

    // `NSLock.lock()` 은 async 문맥에서 못 부른다 — 동기 헬퍼로 감싼다.
    private func recordCall() {
        lock.lock(); defer { lock.unlock() }
        _calls += 1
    }

    private func markCompleted() {
        lock.lock(); defer { lock.unlock() }
        _completed = true
    }

    func getPrerenderVariant(
        context: String,
        country: String?,
        city: String?,
        targetDate: String,
        timezone: String,
        token: String
    ) async throws -> Int? {
        recordCall()
        let value = index
        let wait = delay
        return await withCheckedContinuation { continuation in
            DispatchQueue.global().asyncAfter(deadline: .now() + wait) { [self] in
                markCompleted()
                continuation.resume(returning: value)
            }
        }
    }
}

/// 응답을 주지 않고 매달리는 서버. 취소되면 URLSession 이 `stopLoading` 을 부르고 스스로
/// `.cancelled` 로 끝낸다 — 그 횟수로 "상한이 요청까지 취소했는가" 를 본다.
private final class HangingWeatherURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private nonisolated(unsafe) static var starts = 0
    private nonisolated(unsafe) static var stops = 0

    static var startCount: Int {
        lock.lock(); defer { lock.unlock() }
        return starts
    }

    static var stopCount: Int {
        lock.lock(); defer { lock.unlock() }
        return stops
    }

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        starts = 0
        stops = 0
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "weather-save.example.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.starts += 1
        Self.lock.unlock()
        // 아무것도 보내지 않는다.
    }

    override func stopLoading() {
        Self.lock.lock()
        Self.stops += 1
        Self.lock.unlock()
    }
}
