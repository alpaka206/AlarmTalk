import XCTest
@testable import AlarmTalk

/// **받은 알람에 받는 사람의 조건을 채운다**(2026-09-03 리뷰 15차).
///
/// 받은 가족 알람은 지역·사주가 **전부 비어 있다**(보낸 사람의 것을 받지 않는다).
/// 그 상태로 세트만 묶으면 날씨는 서버 기본값(서울)으로, 운세는 **빈 프로필 해시**로
/// 떨어진다 — `WeatherVariantRefreshService` 를 부르는 것만으로는 안 된다. 그게 읽는
/// 것이 바로 이 필드들이기 때문이다.
///
/// 안드로이드 짝은 `StockClipRebindDecisionTest` 의 조건 채우기 세 건이다.
@MainActor
final class RecipientConditionHydrationTests: XCTestCase {

    private func received(bucket: String) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            label: "받은 알람",
            hour: 7,
            minute: 0,
            fireAtMillis: 0
        )
        record.bucketId = bucket
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.voiceSource = VoiceSource.ttsProfile.rawValue
        record.ttsMessageId = "old-0"
        return record
    }

    private var prefs: DynamicPromptPreferences {
        var value = DynamicPromptPreferences()
        value.weatherCountry = "KR"
        value.weatherCity = "부산"
        value.fortuneGender = "female"
        value.fortuneBirthDate = "1994-03-02"
        value.fortuneBirthTime = "07:30"
        return value
    }

    func testWeatherBucketGetsRecipientRegionOnly() {
        let filled = StockClipLanguageRebinder.withRecipientConditions(
            received(bucket: "weather"), bucket: "weather", prefs: prefs
        )
        XCTAssertEqual(filled.voiceWeatherCountry, "KR")
        XCTAssertEqual(filled.voiceWeatherCity, "부산")
        // ⚠ **그 버킷에 필요한 것만 채운다** — 날씨 알람에 사주를 적어 둘 이유가 없다.
        XCTAssertNil(filled.voiceFortuneBirthDate)
    }

    func testFortuneBucketGetsRecipientSajuOnly() {
        let filled = StockClipLanguageRebinder.withRecipientConditions(
            received(bucket: "fortune"), bucket: "fortune", prefs: prefs
        )
        XCTAssertEqual(filled.voiceFortuneBirthDate, "1994-03-02")
        XCTAssertEqual(filled.voiceFortuneBirthTime, "07:30")
        XCTAssertNil(filled.voiceWeatherCity)
    }

    func testRotatingBucketIsUntouched() {
        let filled = StockClipLanguageRebinder.withRecipientConditions(
            received(bucket: "medication"), bucket: "medication", prefs: prefs
        )
        XCTAssertNil(filled.voiceWeatherCity)
        XCTAssertNil(filled.voiceFortuneBirthDate)
    }

    /// ⚠ **사용자가 그 알람에 넣어 둔 값이 이긴다** — 덮어쓰면 남의 도시로 바뀐다.
    func testExistingConditionsWin() {
        var mine = received(bucket: "weather")
        mine.voiceWeatherCountry = "JP"
        mine.voiceWeatherCity = "도쿄"
        let filled = StockClipLanguageRebinder.withRecipientConditions(
            mine, bucket: "weather", prefs: prefs
        )
        XCTAssertEqual(filled.voiceWeatherCountry, "JP")
        XCTAssertEqual(filled.voiceWeatherCity, "도쿄")
    }

    /// 저장된 취향이 없으면 아무것도 채우지 않는다(빈 문자열을 값으로 쓰지 않는다).
    func testBlankPreferencesLeaveFieldsNil() {
        let empty = StockClipLanguageRebinder.withRecipientConditions(
            received(bucket: "weather"), bucket: "weather", prefs: DynamicPromptPreferences()
        )
        XCTAssertNil(empty.voiceWeatherCity)

        let none = StockClipLanguageRebinder.withRecipientConditions(
            received(bucket: "weather"), bucket: "weather", prefs: nil
        )
        XCTAssertNil(none.voiceWeatherCity)
    }
}
