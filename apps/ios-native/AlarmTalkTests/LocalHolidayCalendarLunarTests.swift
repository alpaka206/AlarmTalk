import XCTest
@testable import AlarmTalk

/// KoreanLunarHolidayEngine + LocalHolidayCalendar 의 ON-DEVICE 음력/대체공휴일 계산을 검증한다.
/// 골든 벡터: HolidaySeedData(KASI 검증, 2026-2029)의 양력 날짜를 시드/캐시 없이 엔진만으로 재현.
/// 또한 극단 디바이스 타임존(UTC+14, UTC-11)에서도 동일 결과(타임존 독립)임을 증명.
final class LocalHolidayCalendarLunarTests: XCTestCase {

    /// 양력 (y, m, d) 를 Asia/Seoul 자정 Date 로. 엔진/시드와 동일 시계.
    private func seoulDate(_ y: Int, _ m: Int, _ d: Int) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return cal.date(from: DateComponents(year: y, month: m, day: d))!
    }

    /// 임의 타임존 tz 의 정오 instant 를 만든다(타임존 독립성 테스트의 동일 instant 입력용).
    private func noonInstant(_ y: Int, _ m: Int, _ d: Int, tzId: String) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tzId)!
        return cal.date(from: DateComponents(year: y, month: m, day: d, hour: 12))!
    }

    // MARK: - 설날 (음력 1/1) — 엔진은 "기준일(anchor)"만 계산. 연휴(±1일)는 시드/서버 담당.
    // Android `LunarHolidayCalendar.kt:15-16` 와 동일: 엔진은 법정 기준일만, 연휴는 시드가.

    func test_seollal_goldenVectors() {
        // 기준일(설날 당일)만 true: 2026=2/17(화), 2027=2/7(일), 2028=1/27(목), 2029=2/13(화)
        //
        // ⚠ 이 값은 **KASI(한국천문연구원) 공식 민용 음력**이고, 안드로이드의 ground truth
        // (`LunarHolidayCalendarTest.kt` 의 `seollalByYear`,
        // `LunarHolidayCalendarInstrumentedTest.kt` 의 `seollal`)와 같은 값이다.
        //
        // ICU `.chinese` 로 재계산하면 2027=2/6, 2028=1/26 이 나오는데 **그건 중국 자오선
        // (120°E) 기준이라 한국 민용력과 다르다.** 한국은 135°E 기준(dangi)이다. 엔진이
        // `.chinese` 를 쓰던 동안 이 두 해가 하루씩 어긋났고, 그건 엔진 버그였다.
        // 이 기대값을 "엔진에 맞춰" 고치지 말 것 — 고치는 순간 설날 당일에 알람이 울린다.
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 2, 17)), "2026 설날 기준일")
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2027, 2, 7)), "2027 설날 기준일")
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2028, 1, 27)), "2028 설날 기준일")
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2029, 2, 13)), "2029 설날 기준일")
        // 연휴 전날/다음날은 엔진 단독으로는 false (시드가 채운다)
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 2, 16)))
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 2, 18)))

        // --- `.chinese` 회귀 핀 ---
        // 아래 3줄은 음력 캘린더가 dangi 에서 `.chinese` 로 되돌아가면 **즉시** 빨간불이 된다.
        // (`.chinese` 는 자오선이 중국(120°E)이라 삭이 CST 23:00~23:59 에 드는 해가 하루 빠르다.)
        // 2020~2031 KASI 앵커 36개 중 `.chinese` 가 틀리는 것은 이 3건뿐이다.
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2027, 2, 6)),
                       "2/6 은 설날 기준일이 아니다 — .chinese 로 되돌아가면 여기가 true 가 된다")
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2028, 1, 26)),
                       "1/26 은 설날 기준일이 아니다 — 같은 회귀 핀")
        // 부처님오신날 2023: KASI 5/27, `.chinese` 는 5/26 을 준다.
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2023, 5, 27)),
                      "2023 부처님오신날(KASI 5/27)")
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2023, 5, 26)),
                       "5/26 은 .chinese 의 답이지 KASI 의 답이 아니다")
        // 경계: 연휴 바깥 평일도 false
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 2, 15)))
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 2, 19)))
    }

    // MARK: - 추석 (음력 8/15) — 엔진은 기준일(anchor)만.

    func test_chuseok_goldenVectors() {
        // 기준일(추석 당일)만 true: 2026=9/25, 2027=9/15, 2028=10/3, 2029=9/22
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 9, 25)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2027, 9, 15)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2028, 10, 3)))  // 개천절과 겹침
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2029, 9, 22)))
        // 연휴 전날/다음날은 엔진 단독으로는 false
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 9, 24)))
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 9, 26)))
    }

    // MARK: - 부처님오신날 (음력 4/8) 단일일

    func test_buddha_goldenVectors() {
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 5, 24)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2027, 5, 13)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2028, 5, 2)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2029, 5, 20)))
        // 윤4월이 부처님오신날을 오발화시키지 않는지(첫 비윤달만 채택) — 인접일 음성 확인
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 5, 23)))
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(seoulDate(2026, 5, 25)))
    }

    // MARK: - 대체공휴일 (제3조) 골든 벡터

    func test_substitute_goldenVectors() {
        // 2026: 삼일절(일)→3/2, 부처님(일)→5/25, 광복절(토)→8/17, 개천절(토)→10/5
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2026, 3, 2)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2026, 5, 25)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2026, 8, 17)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2026, 10, 5)))

        // 2027: 설날(일 7일)→2/9, 광복절(일)→8/16, 개천절(일)→10/4, 한글날(토)→10/11, 성탄(토)→12/27
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2027, 2, 9)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2027, 8, 16)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2027, 10, 4)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2027, 10, 11)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2027, 12, 27)))

        // 2028: 추석(10/3)이 개천절과 겹침 → 대체 1일만(10/5). 겹침 dedup 검증.
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2028, 10, 5)))
        XCTAssertFalse(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2028, 10, 6)),
                       "겹침은 하루치 손실이므로 대체는 1개만 — 10/6 은 대체 아님")

        // 2029: 어린이날(토)→5/7, 부처님(일)→5/21, 추석(9/22 토 포함)→9/24
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2029, 5, 7)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2029, 5, 21)))
        XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2029, 9, 24)))
    }

    func test_substitute_negativeCases() {
        // 신정(1/1)·현충일(6/6) 은 대체 대상 아님.
        // 2028 신정 1/1 은 토요일이지만 대체 없음.
        XCTAssertFalse(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2028, 1, 3)))
        // 설날·추석은 토요일이라도 대체 없음(SET A). 2027 설날 연휴 시작 2/6 은 토요일이지만,
        // 토요일 자체로는 SET A 대체를 만들지 않는다(일요일 2/7 이 트리거).
        // 평범한 평일은 대체 아님.
        XCTAssertFalse(KoreanLunarHolidayEngine.isSubstituteHoliday(seoulDate(2026, 7, 1)))
    }

    // MARK: - LocalHolidayCalendar 통합 (빈 store 가정 — 엔진만으로 true)

    func test_localHolidayCalendar_lunarAndSubstitute_withoutSeed() {
        // 설날/추석/부처님 + 대체공휴일이 LocalHolidayCalendar.isHoliday 로 잡혀야 함.
        XCTAssertTrue(LocalHolidayCalendar.isHoliday(seoulDate(2026, 2, 17), countryCode: "KR"))
        XCTAssertTrue(LocalHolidayCalendar.isHoliday(seoulDate(2026, 9, 25), countryCode: "KR"))
        XCTAssertTrue(LocalHolidayCalendar.isHoliday(seoulDate(2026, 5, 24), countryCode: "KR"))
        XCTAssertTrue(LocalHolidayCalendar.isHoliday(seoulDate(2026, 8, 17), countryCode: "KR"))  // 대체
        // 고정 양력도 여전히 동작.
        XCTAssertTrue(LocalHolidayCalendar.isHoliday(seoulDate(2026, 1, 1), countryCode: "KR"))
        XCTAssertTrue(LocalHolidayCalendar.isHoliday(seoulDate(2026, 6, 6), countryCode: "KR"))
        // 비-KR 은 false.
        XCTAssertFalse(LocalHolidayCalendar.isHoliday(seoulDate(2026, 2, 17), countryCode: "US"))
        // 평일은 false.
        XCTAssertFalse(LocalHolidayCalendar.isHoliday(seoulDate(2026, 7, 1), countryCode: "KR"))
    }

    // MARK: - 빈 HolidayStore 에서도 엔진 결과가 노출되는지 (cache 없이)

    @MainActor
    func test_holidayStore_emptyCache_fallsBackToEngine() {
        let store = HolidayStore()
        // init 의 시드 Task 가 비동기로 채워지더라도, 현재 메모리 holidays 가 비어 있는 시점에도
        // 음력/대체 엔진이 fallback 으로 true 를 줘야 한다. (시드가 들어와도 OR 이므로 true 유지)
        XCTAssertTrue(store.isHoliday(seoulDate(2026, 2, 17), countryCode: "KR"))   // 설날
        XCTAssertTrue(store.isHoliday(seoulDate(2028, 10, 5), countryCode: "KR"))   // 2028 대체(개천절)
    }

    // MARK: - 타임존 독립성: 동일 instant 를 극단 디바이스 TZ 로 입력해도 동일 판정

    /// **디바이스 타임존 독립성** — 같은 instant 라면 기기 시계를 무엇으로 바꿔도 판정이 같다.
    ///
    /// 이것이 원래 검증하려던 것이다. 엔진은 `seoulGregorian`(고정 Asia/Seoul)만 쓰고
    /// `Calendar.current` 를 참조하지 않으므로, 해외에 있는 사용자도 **한국 공휴일**을
    /// 한국 달력대로 본다. 안드로이드 계측 테스트의 `TimeZone.setDefault` 루프와 같은 축이다.
    func test_engine_isDeviceTimeZoneIndependent() {
        let original = NSTimeZone.default
        defer { NSTimeZone.default = original }

        // 설날(2026-02-17) 한국 정오 instant 하나를 고정한다.
        let instant = noonInstant(2026, 2, 17, tzId: "Asia/Seoul")
        let expectedEpoch = KoreanLunarHolidayEngine.epochDay(year: 2026, month: 2, day: 17)

        for tzId in ["Asia/Seoul", "UTC", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago"] {
            NSTimeZone.default = TimeZone(identifier: tzId)!
            XCTAssertEqual(KoreanLunarHolidayEngine.epochDay(of: instant), expectedEpoch,
                           "기기 시계가 \(tzId) 여도 같은 민용일이어야 한다")
            XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(instant),
                          "기기 시계가 \(tzId) 여도 설날이어야 한다")
        }

        // 대체공휴일(2026-08-17 광복절 대체)도 같은 축으로 확인.
        let subInstant = noonInstant(2026, 8, 17, tzId: "Asia/Seoul")
        for tzId in ["Asia/Seoul", "UTC", "Pacific/Pago_Pago"] {
            NSTimeZone.default = TimeZone(identifier: tzId)!
            XCTAssertTrue(KoreanLunarHolidayEngine.isSubstituteHoliday(subInstant),
                          "기기 시계가 \(tzId) 여도 대체공휴일이어야 한다")
        }
    }

    /// **서로 다른 instant 는 다른 민용일일 수 있다** — 위 테스트와 헷갈리면 안 되는 축.
    ///
    /// 예전에는 이 두 축이 한 테스트에 섞여 있었고, "여러 존의 **정오**" 를 만들어 놓고
    /// 그것들이 전부 Asia/Seoul 기준 같은 날이라고 기대했다. 그건 틀린 전제다 —
    /// 각 존의 정오는 **서로 다른 순간**이라 한국 민용일이 갈릴 수 있다:
    ///
    ///   - Kiritimati(UTC+14) 2026-02-17 정오 = 2026-02-16T22:00Z = KST 02-17 07:00 → 같은 날
    ///   - Pago_Pago(UTC-11) 2026-02-17 정오 = 2026-02-17T23:00Z = KST 02-**18** 08:00 → 다음 날
    ///
    /// 엔진이 Pago 정오를 2/18 로 보는 것은 **옳다.** 사모아에서 정오일 때 한국은 이미
    /// 다음 날 아침이고, 한국 공휴일 판정은 한국 달력을 따른다.
    func test_engine_differentInstantsMayMapToDifferentSeoulDays() {
        let seoulEpoch = KoreanLunarHolidayEngine.epochDay(year: 2026, month: 2, day: 17)

        let kiritimatiNoon = noonInstant(2026, 2, 17, tzId: "Pacific/Kiritimati")
        XCTAssertEqual(KoreanLunarHolidayEngine.epochDay(of: kiritimatiNoon), seoulEpoch,
                       "Kiritimati 정오는 KST 로 아직 같은 날 아침이다")
        XCTAssertTrue(KoreanLunarHolidayEngine.isLunarHoliday(kiritimatiNoon))

        let pagoNoon = noonInstant(2026, 2, 17, tzId: "Pacific/Pago_Pago")
        XCTAssertEqual(KoreanLunarHolidayEngine.epochDay(of: pagoNoon), seoulEpoch + 1,
                       "Pago_Pago 정오는 KST 로 이미 다음 날이다")
        XCTAssertFalse(KoreanLunarHolidayEngine.isLunarHoliday(pagoNoon),
                       "2026-02-18 은 설날 기준일이 아니다(연휴는 시드가 담당)")
    }

    // MARK: - epochDay 가 시드의 ymd 와 정확히 일치 (시계 정렬)

    @MainActor
    func test_epochDay_matchesSeedYmdClock() {
        // HolidayStore.epochDay(of:) 와 엔진 epochDay 가 동일해야 cache/seed/engine 레이어가 정렬됨.
        let d = seoulDate(2026, 2, 17)
        XCTAssertEqual(HolidayStore.epochDay(of: d),
                       KoreanLunarHolidayEngine.epochDay(year: 2026, month: 2, day: 17))
    }
}
