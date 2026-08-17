import XCTest
@testable import AlarmTalk

/// 테마 알람이 **어느 클립을 트는가** — 안드로이드와 같은 답이 나와야 한다.
@MainActor
final class BucketVariantResolverTests: XCTestCase {

    // MARK: - 운세: 안드로이드와 같은 값이어야 한다

    /// ⚠ **이 표는 안드로이드 `FortuneThemeIndexTest` 와 글자 하나까지 같아야 한다.**
    /// 한 사람이 두 기기를 쓰면 같은 날 같은 운세를 들어야 하므로, 양쪽에 같은 기대값을
    /// 박아 둔다 — 한쪽 산식이 흔들리면 그쪽 테스트가 깨진다.
    func test_fortuneThemeIndex_matchesAndroid() {
        let cases: [(gender: String, birth: String, time: String, date: String, count: Int, expected: Int)] = [
            ("여자", "1994-03-02", "05:30", "2026-08-18", 9, 3),
            ("남자", "1988-11-27", "", "2026-08-18", 9, 6),
            ("여자", "1994-03-02", "05:30", "2026-08-19", 9, 4),
        ]
        for c in cases {
            XCTAssertEqual(
                BucketVariantResolver.fortuneThemeIndex(
                    gender: c.gender, birthDate: c.birth, birthTime: c.time, date: c.date, count: c.count
                ),
                c.expected,
                "seed=\(c.gender)|\(c.birth)|\(c.time)|\(c.date)"
            )
        }
    }

    func test_fortuneThemeIndex_isStableForSamePersonAndDay() {
        let a = BucketVariantResolver.fortuneThemeIndex(
            gender: "여자", birthDate: "1994-03-02", birthTime: "05:30", date: "2026-08-18", count: 9
        )
        let b = BucketVariantResolver.fortuneThemeIndex(
            gender: " 여자 ", birthDate: "1994-03-02 ", birthTime: " 05:30", date: "2026-08-18", count: 9
        )
        XCTAssertEqual(a, b, "trim 규칙이 안드로이드와 달라지면 두 기기가 갈라진다.")
    }

    func test_fortuneThemeIndex_changesWithTheDay() {
        let day1 = BucketVariantResolver.fortuneThemeIndex(
            gender: "여자", birthDate: "1994-03-02", birthTime: "05:30", date: "2026-08-18", count: 9
        )
        let day2 = BucketVariantResolver.fortuneThemeIndex(
            gender: "여자", birthDate: "1994-03-02", birthTime: "05:30", date: "2026-08-19", count: 9
        )
        XCTAssertNotEqual(day1, day2, "날짜가 바뀌면 테마도 바뀌어야 한다(매일 같은 운세는 기능 상실).")
    }

    // MARK: - 발사 시 자리

    func test_variantIndex_weather_usesResolvedForecast() {
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.contextVariantIndex = 1  // 비
        XCTAssertEqual(BucketVariantResolver.variantIndex(for: record), 1)
    }

    func test_variantIndex_weather_unresolvedFallsBackToTheApologyClip() {
        // 조건을 못 받았으면 **맑음(0)이 아니라 마지막 안내 클립**이다.
        // 0 으로 때우면 비 오는 날에 "하늘 한 번 올려다보세요" 가 나간다.
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.contextVariantIndex = nil
        XCTAssertEqual(BucketVariantResolver.variantIndex(for: record), 8)
    }

    func test_variantIndex_weather_legacyBucketWithoutApologyClipStaysNil() {
        // 안내 클립이 없던 옛 묶음(8개)은 size-1 이 '추위' 라 폴백하면 오히려 거짓말이 된다.
        var record = makeBucketRecord(bucketId: "weather", clipCount: 8)
        record.contextVariantIndex = nil
        XCTAssertNil(BucketVariantResolver.variantIndex(for: record))
    }

    func test_variantIndex_weather_ignoresRotation() {
        // 날씨는 회전하지 않는다 — 회전 값이 남아 있어도 조건이 이긴다.
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.contextVariantIndex = 2
        record.bucketRotationIndex = 7
        XCTAssertEqual(BucketVariantResolver.variantIndex(for: record), 2)
    }

    func test_variantIndex_otherBucketRotates() {
        var record = makeBucketRecord(bucketId: "medication", clipCount: 4)
        record.bucketRotationIndex = 6  // 한 바퀴 넘게 돌았어도
        XCTAssertEqual(BucketVariantResolver.variantIndex(for: record), 2)
    }

    func test_variantIndex_nilWhenNoClips() {
        var record = makeBucketRecord(bucketId: "weather", clipCount: 0)
        record.contextVariantIndex = 3
        XCTAssertNil(BucketVariantResolver.variantIndex(for: record))
    }

    // MARK: - 언제 다시 받는가

    func test_needsRefresh_outsidePrepareWindow_isFalse() {
        let now: Int64 = 1_000_000
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.fireAtMillis = now + BucketVariantResolver.prepareWindowMillis + 1
        // 며칠 뒤 예보로 굳히면 엉뚱해진다.
        XCTAssertFalse(BucketVariantResolver.weatherVariantNeedsRefresh(record, nowMillis: now))
    }

    func test_needsRefresh_neverResolved_isTrue() {
        let now: Int64 = 1_000_000
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.fireAtMillis = now + 3_600_000
        record.contextVariantIndex = nil
        XCTAssertTrue(BucketVariantResolver.weatherVariantNeedsRefresh(record, nowMillis: now))
    }

    func test_needsRefresh_alreadyResolvedForThisFiring_isFalse() {
        let now: Int64 = 1_000_000
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.fireAtMillis = now + 3_600_000
        record.contextVariantIndex = 1
        record.contextResolvedAtMillis = now  // 발사 24h 이내에 받았다
        XCTAssertFalse(BucketVariantResolver.weatherVariantNeedsRefresh(record, nowMillis: now))
    }

    func test_needsRefresh_staleValueFromAPreviousFiring_isTrue() {
        // 반복 알람이 한 번 울리고 다음 날로 넘어간 상황 — 옛 값은 어제 조건이다.
        let now: Int64 = 10_000_000_000
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.fireAtMillis = now + 3_600_000
        record.contextVariantIndex = 1
        record.contextResolvedAtMillis = record.fireAtMillis - BucketVariantResolver.resolveValidWindowMillis - 1
        XCTAssertTrue(BucketVariantResolver.weatherVariantNeedsRefresh(record, nowMillis: now))
    }

    func test_needsRefresh_pastFiring_isFalse() {
        // 이미 지난 발사분(울리는 중·놓친 알람)에 시간당 재시도가 무한히 붙지 않게 한다.
        let now: Int64 = 1_000_000
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.fireAtMillis = now - 1
        record.contextVariantIndex = nil
        XCTAssertFalse(BucketVariantResolver.weatherVariantNeedsRefresh(record, nowMillis: now))
    }

    func test_needsRefresh_disabledAlarm_isFalse() {
        let now: Int64 = 1_000_000
        var record = makeBucketRecord(bucketId: "weather", clipCount: 9)
        record.fireAtMillis = now + 3_600_000
        record.contextVariantIndex = nil
        record.enabled = false
        XCTAssertFalse(BucketVariantResolver.weatherVariantNeedsRefresh(record, nowMillis: now))
    }

    // MARK: - 저장 시 남길 값

    func test_nextState_freshIndexWinsOverReset() {
        // 지역·날짜를 바꾼 편집이야말로 reset 이 켜지는 경우다. 그때 방금 받아 온 값을
        // 버리면 갱신이 돌기 전에 울려 '못 받았어요' 안내가 나간다.
        let state = BucketVariantResolver.nextWeatherVariantState(
            nextBucketId: "weather",
            resetVariant: true,
            currentIndex: 3,
            currentResolvedAtMillis: 100,
            freshIndex: 1,
            nowMillis: 999
        )
        XCTAssertEqual(state.index, 1)
        XCTAssertEqual(state.resolvedAtMillis, 999)
    }

    func test_nextState_resetDropsStaleValue() {
        let state = BucketVariantResolver.nextWeatherVariantState(
            nextBucketId: "weather",
            resetVariant: true,
            currentIndex: 3,
            currentResolvedAtMillis: 100,
            freshIndex: nil
        )
        XCTAssertNil(state.index)
        XCTAssertNil(state.resolvedAtMillis)
    }

    func test_nextState_offlineKeepsWhatWeHad() {
        // 오프라인 저장 — 이미 받아 둔 조건이 있으면 지키다.
        let state = BucketVariantResolver.nextWeatherVariantState(
            nextBucketId: "weather",
            resetVariant: false,
            currentIndex: 3,
            currentResolvedAtMillis: 100,
            freshIndex: nil
        )
        XCTAssertEqual(state.index, 3)
        XCTAssertEqual(state.resolvedAtMillis, 100)
    }

    func test_nextState_leavingWeatherClearsIt() {
        let state = BucketVariantResolver.nextWeatherVariantState(
            nextBucketId: "medication",
            resetVariant: false,
            currentIndex: 3,
            currentResolvedAtMillis: 100,
            freshIndex: nil
        )
        XCTAssertNil(state.index)
    }

    func test_shouldReset_whenCityChanges() {
        var previous = makeBucketRecord(bucketId: "weather", clipCount: 9)
        previous.voiceWeatherCity = "서울"
        XCTAssertTrue(
            BucketVariantResolver.shouldResetWeatherVariant(
                previous: previous,
                nextBucketId: "weather",
                nextCountry: previous.voiceWeatherCountry,
                nextCity: "부산",
                nextFireAtMillis: previous.fireAtMillis
            )
        )
    }

    func test_shouldReset_whenFireDateChanges() {
        let previous = makeBucketRecord(bucketId: "weather", clipCount: 9)
        XCTAssertTrue(
            BucketVariantResolver.shouldResetWeatherVariant(
                previous: previous,
                nextBucketId: "weather",
                nextCountry: previous.voiceWeatherCountry,
                nextCity: previous.voiceWeatherCity,
                nextFireAtMillis: previous.fireAtMillis + 24 * 60 * 60 * 1000
            )
        )
    }

    func test_shouldReset_isFalseWhenNothingRelevantChanged() {
        let previous = makeBucketRecord(bucketId: "weather", clipCount: 9)
        XCTAssertFalse(
            BucketVariantResolver.shouldResetWeatherVariant(
                previous: previous,
                nextBucketId: "weather",
                nextCountry: previous.voiceWeatherCountry,
                nextCity: previous.voiceWeatherCity,
                nextFireAtMillis: previous.fireAtMillis
            )
        )
    }

    // MARK: - Helpers

    private func makeBucketRecord(bucketId: String, clipCount: Int) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            id: UUID().uuidString,
            label: "테마 알람",
            hour: 7,
            minute: 0,
            fireAtMillis: 1_700_000_000_000
        )
        record.bucketId = bucketId
        record.bucketClipKeys = clipCount > 0 ? (0..<clipCount).map { "stock_clip_\($0)" } : []
        record.voiceWeatherCountry = "대한민국"
        record.voiceWeatherCity = "서울"
        record.voiceFortuneGender = "여자"
        record.voiceFortuneBirthDate = "1994-03-02"
        record.voiceFortuneBirthTime = "05:30"
        record.enabled = true
        return record
    }
}
