import XCTest
@testable import AlarmTalk

/// **날씨 조건 갱신도 소유자로 걸러야 한다**(2026-09-08 리뷰 39차).
///
/// 이 경로는 조건이 바뀌면 **다시 예약한다** — 그래서 소유자 필터가 없으면 지금 로그인한
/// 사람의 토큰으로 앞 계정 행을 고치고 OS 에 다시 건다. 그 알람은 지금 사람에게 보이지도
/// 꺼지지도 않는다(`docs/spec/alarm-lifecycle.md` §1-2).
///
/// ⚠ 경합이 필요 없다: 자동 401 뒤 다른 계정이 로그인한 기기에는 앞 계정 행이
/// `enabled = true`, `alarmKitID = nil` 로 그대로 남아 있다.
@MainActor
final class WeatherVariantOwnerScopeTests: XCTestCase {

    /// 어떤 (도시, 날짜) 로 물었는지 세어 둔다 — 남의 계정 행은 **묻지도 말아야** 한다.
    private final class StubResolver: PrerenderVariantResolving, @unchecked Sendable {
        var cities: [String] = []
        var index: Int? = 3
        func getPrerenderVariant(
            context: String,
            country: String?,
            city: String?,
            targetDate: String,
            timezone: String,
            token: String
        ) async throws -> Int? {
            cities.append(city ?? "")
            return index
        }
    }

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("weather-owner-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private let now = Int64(Date().timeIntervalSince1970 * 1000)

    private func weatherAlarm(id: String, owner: String?, city: String) -> LocalAlarmRecord {
        var r = LocalAlarmRecord(
            id: id, label: "아침", hour: 7, minute: 0,
            fireAtMillis: now + 60 * 60 * 1000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now, updatedAtMillis: now
        )
        r.enabled = true
        r.ownerUserId = owner
        r.bucketId = "weather"
        r.voiceWeatherCity = city
        r.contextVariantIndex = nil
        return r
    }

    func test_남의_계정_알람은_묻지도_고치지도_않는다() async {
        let store = makeStore()
        store.upsert(weatherAlarm(id: "A", owner: "A", city: "서울"))
        store.upsert(weatherAlarm(id: "B", owner: "B", city: "부산"))
        let api = StubResolver()
        let service = WeatherVariantRefreshService(api: api, store: store)

        let changed = await service.refreshDue(token: "t", ownerUserId: "B", nowMillis: now)

        XCTAssertEqual(changed, 1)
        XCTAssertEqual(store.record(id: "B")?.contextVariantIndex, 3)
        XCTAssertNil(store.record(id: "A")?.contextVariantIndex, "남의 계정 알람을 고쳤다")
        XCTAssertNil(store.record(id: "A")?.contextResolvedAtMillis)
        XCTAssertEqual(api.cities, ["부산"], "남의 계정 도시를 내 토큰으로 물었다")
    }

    /// ⚠ 반대로 좁히지도 말 것 — 소유자 미기록(옛 행)은 지금 계정 것으로 본다.
    /// 여기서 빼면 옛 행의 날씨가 영영 갱신되지 않는다(어제 날씨로 울린다).
    func test_소유자_미기록_행은_갱신한다() async {
        let store = makeStore()
        store.upsert(weatherAlarm(id: "옛행", owner: nil, city: "대구"))
        let api = StubResolver()
        let service = WeatherVariantRefreshService(api: api, store: store)

        let changed = await service.refreshDue(token: "t", ownerUserId: "B", nowMillis: now)

        XCTAssertEqual(changed, 1)
        XCTAssertEqual(store.record(id: "옛행")?.contextVariantIndex, 3)
    }

    /// 계정을 못 가리면 아무것도 하지 않는다 — 이 경로는 살아 있는 토큰이 있어야 하므로
    /// 만료 계정으로 되짚지 않는다.
    func test_계정이_없으면_아무것도_하지_않는다() async {
        let store = makeStore()
        store.upsert(weatherAlarm(id: "A", owner: "A", city: "서울"))
        let api = StubResolver()
        let service = WeatherVariantRefreshService(api: api, store: store)

        let changed = await service.refreshDue(token: "t", ownerUserId: nil, nowMillis: now)

        XCTAssertEqual(changed, 0)
        XCTAssertTrue(api.cities.isEmpty)
        XCTAssertNil(store.record(id: "A")?.contextVariantIndex)
    }
}
