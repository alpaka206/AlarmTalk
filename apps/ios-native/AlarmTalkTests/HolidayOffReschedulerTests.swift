import XCTest
@testable import AlarmTalk

/// 공휴일 달력이 바뀌면 공휴일off 알람을 **한 번** 다시 거는가(`HolidayOffRescheduler`) — 멱등.
///
/// 예전에는 `HolidayStore.onCountryChanged` 콜백이 그 일을 했는데, 콜백을 꽂기 전(콜드 스타트에서 계정 지역을
/// 받는 순간)·알람 저장소를 읽기 전·JP·US 공휴일이 서버에서 도착한 뒤에는 조용히 빠져, 다음 한 번이
/// 옛 나라 달력으로 울렸다.
/// ⚠ 테스트는 `.standard` 를 건드리지 않는다(이 시뮬레이터 앱의 진짜 표지다) — 따로 만든 저장소로 본다.
@MainActor
final class HolidayOffReschedulerTests: XCTestCase {

    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUp() async throws {
        suiteName = "HolidayOffReschedulerTests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private var stored: String? { defaults.string(forKey: HolidayOffRescheduler.markerDefaultsKey) }

    private func holiday(_ country: String) -> HolidayEntity {
        HolidayEntity(
            countryCode: country, regionCode: "", epochDay: 20_000, localDate: "2024-10-04",
            name: "test", source: "server_sync", updatedAtMillis: 0
        )
    }

    // MARK: - 달력 표지

    func test_달력_표지는_나라와_그_나라_공휴일이_왔는가다() {
        // KR 은 기기 안에서 계산한다 — 받을 것이 없으니 언제나 완성이다.
        XCTAssertEqual(HolidayStore.calendarMarker(country: "KR", holidays: []), "KR")
        // JP·US 는 서버에서 받아야 공휴일이 생긴다.
        XCTAssertEqual(HolidayStore.calendarMarker(country: "JP", holidays: []), "JP:pending")
        XCTAssertEqual(HolidayStore.calendarMarker(country: "JP", holidays: [holiday("US")]), "JP:pending",
                       "다른 나라 공휴일이 있어도 이 나라 것이 아니면 아직이다")
        XCTAssertEqual(HolidayStore.calendarMarker(country: "jp", holidays: [holiday("JP")]), "JP")
    }

    func test_처음_표지는_한_번만_적는다() {
        HolidayOffRescheduler.recordInitialCalendarIfAbsent("kr", defaults: defaults)
        XCTAssertEqual(stored, "KR")
        HolidayOffRescheduler.recordInitialCalendarIfAbsent("JP", defaults: defaults)
        XCTAssertEqual(stored, "KR", "이미 있으면 덮지 않는다 — 덮으면 그 사이 바뀐 나라를 놓친다")
    }

    // MARK: - 다시 걸기

    func test_나라가_바뀌면_한_번만_다시_건다() async {
        let rescheduler = HolidayOffRescheduler(defaults: defaults)
        HolidayOffRescheduler.recordInitialCalendarIfAbsent("KR", defaults: defaults)
        var calls = 0

        // 달력이 그대로면 아무것도 하지 않는다(같은 지역을 다시 골라도 예약을 흔들지 않는다).
        var runs = await rescheduler.runIfNeeded(currentMarker: { "KR" }, recompute: { calls += 1 })
        XCTAssertEqual(runs, 0)

        runs = await rescheduler.runIfNeeded(currentMarker: { "JP" }, recompute: { calls += 1 })
        XCTAssertEqual(runs, 1)
        XCTAssertEqual(stored, "JP")

        // 다시 불려도(계정 설정을 또 받음·화면이 다시 그려짐) 같은 달력이면 돌지 않는다.
        runs = await rescheduler.runIfNeeded(currentMarker: { "JP" }, recompute: { calls += 1 })
        XCTAssertEqual(runs, 0)
        XCTAssertEqual(calls, 1)
    }

    func test_판단할_수_없으면_미루고_표지도_건드리지_않는다() async {
        let rescheduler = HolidayOffRescheduler(defaults: defaults)
        HolidayOffRescheduler.recordInitialCalendarIfAbsent("KR", defaults: defaults)
        var calls = 0
        // 알람 저장소·공휴일 캐시를 읽기 전이다.
        let runs = await rescheduler.runIfNeeded(currentMarker: { nil }, recompute: { calls += 1 })
        XCTAssertEqual(runs, 0)
        XCTAssertEqual(stored, "KR", "미룬 것을 '다 했다' 로 적으면 읽은 뒤에 다시 걸 기회가 사라진다")

        // 읽은 뒤 다시 불리면 그때 건다 — 예전 콜백은 이 경우를 그냥 버렸다.
        await rescheduler.runIfNeeded(currentMarker: { "US" }, recompute: { calls += 1 })
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(stored, "US")
    }

    func test_JP_공휴일이_도착하면_한_번_더_건다() async {
        let rescheduler = HolidayOffRescheduler(defaults: defaults)
        HolidayOffRescheduler.recordInitialCalendarIfAbsent("KR", defaults: defaults)
        var calls = 0
        // 나라를 JP 로 바꾼 순간은 아직 JP 공휴일이 없다 — 일단 그 달력으로 건다.
        await rescheduler.runIfNeeded(currentMarker: { "JP:pending" }, recompute: { calls += 1 })
        // 서버에서 JP 공휴일을 받아 오면 나라는 그대로여도 달력이 바뀌었다.
        await rescheduler.runIfNeeded(currentMarker: { "JP" }, recompute: { calls += 1 })
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(stored, "JP")
    }

    func test_다시_거는_사이_나라가_또_바뀌면_끝난_뒤_한_번_더_돈다() async {
        let rescheduler = HolidayOffRescheduler(defaults: defaults)
        HolidayOffRescheduler.recordInitialCalendarIfAbsent("KR", defaults: defaults)
        var current = "JP"
        var calls = 0
        var nestedRuns = -1
        let runs = await rescheduler.runIfNeeded(currentMarker: { current }, recompute: {
            calls += 1
            if calls == 1 {
                // 도는 사이 지역을 또 골랐다(US). 그 순간의 호출은 기다리지 않고 돌아간다 —
                // 같은 알람을 두 흐름이 동시에 다시 걸면 안 된다.
                current = "US"
                nestedRuns = await rescheduler.runIfNeeded(currentMarker: { current }, recompute: { calls += 100 })
            }
        })
        XCTAssertEqual(nestedRuns, 0, "도는 중에 들어온 호출은 겹쳐 돌지 않는다")
        XCTAssertEqual(runs, 2, "끝난 뒤 표지를 다시 보고 새 나라로 한 번 더 건다")
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(stored, "US")
    }

    func test_표지가_없으면_지금_달력을_기준으로_삼는다() async {
        // 보통은 `HolidayStore.init` 이 먼저 적는다 — 없을 때 괜히 전부 다시 걸지 않는다.
        let rescheduler = HolidayOffRescheduler(defaults: defaults)
        var calls = 0
        await rescheduler.runIfNeeded(currentMarker: { "KR" }, recompute: { calls += 1 })
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(stored, "KR")
    }

    // MARK: - 다시 계산하기(`LocalAlarmStore.recomputeHolidayOffFireTime`)
    //
    // 안드로이드 `HolidayCountryRescheduleTest` 와 같은 표다: 새 달력의 공휴일을 건너뛰고, 멱등이며,
    // 스누즈·울리는 중·일회성은 건드리지 않고, **수정 시각을 올리지 않는다**.

    private func makeStore() -> (LocalAlarmStore, URL) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("holiday-recompute-\(UUID().uuidString).json")
        return (LocalAlarmStore(storageURL: url, loadFromDisk: false), url)
    }

    /// 매일 07:00, 공휴일에는 끄기. 다음 발생은 공휴일 없는 달력으로 계산해 박아 둔다.
    private func holidayOffAlarm(
        store: LocalAlarmStore,
        nowMillis: Int64,
        repeatDaysMask: Int = 0x7F,
        state: AlarmRuntimeState = .armed
    ) throws -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            label: "공휴일off",
            hour: 7,
            minute: 0,
            fireAtMillis: 0,
            repeatDaysMask: repeatDaysMask,
            holidayOff: true,
            state: state.rawValue,
            alarmKitID: UUID().uuidString
        )
        record.fireAtMillis = try record.nextFireAtMillis(nowMillis: nowMillis, isHoliday: { _ in false })
        return store.upsert(record)
    }

    func test_새_달력의_공휴일을_건너뛰고_수정_시각은_그대로다() throws {
        let (store, url) = makeStore()
        defer { try? FileManager.default.removeItem(at: url) }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let before = try holidayOffAlarm(store: store, nowMillis: now)
        let oldFireDay = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(before.fireAtMillis) / 1000))
        // 새 나라의 달력에서는 그날이 공휴일이다.
        let newCalendar: (Date) -> Bool = { Calendar.current.isDate($0, inSameDayAs: oldFireDay) }

        let recomputed = try XCTUnwrap(store.recomputeHolidayOffFireTime(id: before.id, nowMillis: now, isHoliday: newCalendar))

        XCTAssertGreaterThan(recomputed.fireAtMillis, before.fireAtMillis, "새 나라의 공휴일은 건너뛴다")
        XCTAssertEqual(recomputed.updatedAtMillis, before.updatedAtMillis, "사용자의 편집이 아니다 — 수정 시각을 올리지 않는다")
        XCTAssertEqual(recomputed.syncState, before.syncState)
        // 멱등 — 같은 달력으로 다시 부르면 다시 걸 것이 없다.
        XCTAssertNil(store.recomputeHolidayOffFireTime(id: before.id, nowMillis: now, isHoliday: newCalendar))
    }

    func test_달력이_그대로면_다시_걸지_않는다() throws {
        let (store, url) = makeStore()
        defer { try? FileManager.default.removeItem(at: url) }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let record = try holidayOffAlarm(store: store, nowMillis: now)

        XCTAssertNil(store.recomputeHolidayOffFireTime(id: record.id, nowMillis: now, isHoliday: { _ in false }))
    }

    func test_스누즈_울리는_중_일회성은_건드리지_않는다() throws {
        let (store, url) = makeStore()
        defer { try? FileManager.default.removeItem(at: url) }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let snoozed = try holidayOffAlarm(store: store, nowMillis: now, state: .snoozed)
        let ringing = try holidayOffAlarm(store: store, nowMillis: now, state: .ringing)
        let oneShot = try holidayOffAlarm(store: store, nowMillis: now, repeatDaysMask: 0)
        // 다음 발생을 확실히 바꾸는 달력(다음 사흘이 공휴일)이어도 그대로다.
        let changed: (Date) -> Bool = { date in
            date.timeIntervalSince1970 * 1000 < Double(now) + 3 * 86_400_000
        }
        for record in [snoozed, ringing, oneShot] {
            XCTAssertNil(store.recomputeHolidayOffFireTime(id: record.id, nowMillis: now, isHoliday: changed))
            XCTAssertEqual(store.record(id: record.id)?.fireAtMillis, record.fireAtMillis)
        }
    }
}
