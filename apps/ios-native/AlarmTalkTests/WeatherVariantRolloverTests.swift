import XCTest
@testable import AlarmTalk

/// **발사 날짜가 바뀌면 받아 둔 날씨 조건을 버린다 — 울린 뒤에도**(스펙 5-1, 2026-09-30).
///
/// 조건 인덱스는 **그 날짜의** 날씨다. 2026-09-30 까지 iOS 는 반복 날씨 알람이 울리고 다음
/// 날로 넘어갈 때(`LocalAlarmStore.markStopped`) 인덱스를 남겨 두었다. 받은 시각이 24시간
/// 창 안이라 준비창 갱신이 "이미 받았다" 로 건너뛰고, 그 사이 앱이 깨어나지 못하면
/// **어제 날씨 클립**이 울렸다. 안드로이드는 `AlarmRepository.dismiss`·`setEnabled` 가
/// `shouldResetWeatherVariant` 로 지운다 — 같은 판정을 세 갈래(정지·다시 켜기·놓친 회차
/// 넘기기)에 건다.
@MainActor
final class WeatherVariantRolloverTests: XCTestCase {

    private var tempURLs: [URL] = []

    override func tearDown() async throws {
        for url in tempURLs { try? FileManager.default.removeItem(at: url) }
        tempURLs = []
    }

    private func makeStore() -> LocalAlarmStore {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("weather-rollover-\(UUID().uuidString).json")
        tempURLs.append(url)
        return LocalAlarmStore(storageURL: url, loadFromDisk: false)
    }

    private static let everyDay = 0x7F

    /// 방금(1분 전) 울린 매일 반복 알람. 받아 둔 조건은 **오늘** 것이다.
    private func justFiredWeatherAlarm(
        bucketId: String = "weather",
        kitID: String = UUID().uuidString,
        repeatDaysMask: Int = WeatherVariantRolloverTests.everyDay
    ) -> LocalAlarmRecord {
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let firedAt = nowMillis - 60_000
        let parts = Calendar.current.dateComponents(
            [.hour, .minute],
            from: Date(timeIntervalSince1970: TimeInterval(firedAt) / 1000)
        )
        var record = LocalAlarmRecord(
            label: "날씨",
            hour: parts.hour ?? 7,
            minute: parts.minute ?? 0,
            fireAtMillis: firedAt,
            repeatDaysMask: repeatDaysMask,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceWeatherCountry: "대한민국",
            voiceWeatherCity: "서울",
            state: AlarmRuntimeState.ringing.rawValue,
            alarmKitID: kitID
        )
        record.bucketId = bucketId
        record.bucketClipKeys = (0..<BucketVariantResolver.weatherClipCount).map { "stock_w\($0)" }
        record.contextVariantIndex = 1 // 오늘은 비
        record.contextResolvedAtMillis = nowMillis - 3_600_000
        return record
    }

    // MARK: - 정지(울린 뒤)

    func test_반복_날씨_알람을_끄면_오늘_받은_조건을_버린다() throws {
        let store = makeStore()
        let record = justFiredWeatherAlarm()
        store.upsert(record)

        store.markStopped(alarmKitID: try XCTUnwrap(record.alarmKitID), isHoliday: { _ in false })

        let after = try XCTUnwrap(store.record(id: record.id))
        XCTAssertNotEqual(
            BucketVariantResolver.localDateString(millis: after.fireAtMillis),
            BucketVariantResolver.localDateString(millis: record.fireAtMillis),
            "전제: 다음 발사는 다른 날짜다"
        )
        XCTAssertNil(after.contextVariantIndex, "어제 날씨 인덱스가 다음 날로 넘어갔다")
        XCTAssertNil(after.contextResolvedAtMillis)
        // 지운 뒤에는 준비창 갱신이 새 날짜로 다시 받는다 — 건너뛰면 지운 의미가 없다.
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        XCTAssertTrue(BucketVariantResolver.weatherVariantNeedsRefresh(after, nowMillis: nowMillis))
        // 그 사이 울리면 '맑음(0)' 이 아니라 '못 봤어요' 안내(마지막 클립)다.
        XCTAssertEqual(BucketVariantResolver.variantIndex(for: after), BucketVariantResolver.weatherClipCount - 1)
    }

    /// 날씨가 아닌 테마는 건드리지 않는다 — 판정은 날씨 알람에만 건다.
    func test_날씨가_아닌_테마는_그대로다() throws {
        let store = makeStore()
        let record = justFiredWeatherAlarm(bucketId: "fortune")
        store.upsert(record)

        store.markStopped(alarmKitID: try XCTUnwrap(record.alarmKitID), isHoliday: { _ in false })

        XCTAssertEqual(store.record(id: record.id)?.contextVariantIndex, 1)
    }

    /// 한 번 알람은 꺼지고 끝이다(안드로이드 `dismiss` 의 한 번 갈래와 같다) — 다시 켤 때 판정한다.
    func test_한번_알람은_끄기만_하고_조건은_다시_켤_때_본다() throws {
        let store = makeStore()
        let record = justFiredWeatherAlarm(repeatDaysMask: 0)
        store.upsert(record)

        store.markStopped(alarmKitID: try XCTUnwrap(record.alarmKitID), isHoliday: { _ in false })
        let stopped = try XCTUnwrap(store.record(id: record.id))
        XCTAssertFalse(stopped.enabled)

        store.setEnabled(id: record.id, enabled: true, isHoliday: { _ in false })

        let reenabled = try XCTUnwrap(store.record(id: record.id))
        XCTAssertNotEqual(
            BucketVariantResolver.localDateString(millis: reenabled.fireAtMillis),
            BucketVariantResolver.localDateString(millis: record.fireAtMillis)
        )
        XCTAssertNil(reenabled.contextVariantIndex, "다시 켜서 날짜가 바뀌었는데 옛 조건이 남았다")
    }

    // MARK: - 다시 켜기

    /// 날짜가 그대로면 지우지 않는다 — 받아 둔 조건이 그 날짜 것이므로 다시 받을 이유가 없다.
    func test_다시_켜도_날짜가_같으면_조건을_지킨다() throws {
        let store = makeStore()
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let fireAt = nowMillis + 2 * 3_600_000
        let parts = Calendar.current.dateComponents(
            [.hour, .minute], from: Date(timeIntervalSince1970: TimeInterval(fireAt) / 1000)
        )
        var record = justFiredWeatherAlarm()
        record.hour = parts.hour ?? 0
        record.minute = parts.minute ?? 0
        record.fireAtMillis = fireAt
        record.state = AlarmRuntimeState.armed.rawValue
        store.upsert(record)

        store.setEnabled(id: record.id, enabled: false)
        store.setEnabled(id: record.id, enabled: true, isHoliday: { _ in false })

        let after = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(
            BucketVariantResolver.localDateString(millis: after.fireAtMillis),
            BucketVariantResolver.localDateString(millis: fireAt),
            "전제: 다시 켜도 같은 날짜다"
        )
        XCTAssertEqual(after.contextVariantIndex, 1)
    }

    // MARK: - 놓친 회차 넘기기(복구)

    func test_놓친_회차를_넘길_때도_조건을_버린다() throws {
        let store = makeStore()
        var record = justFiredWeatherAlarm()
        record.state = AlarmRuntimeState.armed.rawValue
        store.upsert(record)

        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let prepared = try XCTUnwrap(
            store.prepareForScheduleRecovery(id: record.id, nowMillis: nowMillis, isHoliday: { _ in false })
        )

        XCTAssertGreaterThan(prepared.fireAtMillis, nowMillis)
        XCTAssertNil(prepared.contextVariantIndex)
    }

    // MARK: - 정지 경로 전체(AlarmKit 정지 → 저장소 → 다시 예약)

    /// 지운 뒤에는 **다시 예약해야 한다** — AlarmKit 은 예약할 때 받은 파일을 그대로 울리므로,
    /// 행만 지우고 두면 OS 는 어제 스테이징한 날씨 파일을 운다.
    func test_정지하면_조건을_지운_뒤_다시_맞춘다() async throws {
        let store = makeStore()
        let context = AlarmAppContext(store: store)
        let record = justFiredWeatherAlarm()
        store.upsert(record)
        var indexWhenReconciled: [Int?] = []
        context.reconcileAfterStop = { id in
            indexWhenReconciled.append(store.record(id: id)?.contextVariantIndex)
        }

        await context.handleAlarmStopped(alarmKitIDString: try XCTUnwrap(record.alarmKitID))

        // 한 번 불렸고(날씨 반복 알람은 정지 뒤 다시 맞춘다), 그때 어제 조건은 이미 지워져 있었다.
        XCTAssertEqual(indexWhenReconciled, [nil])
    }
}
