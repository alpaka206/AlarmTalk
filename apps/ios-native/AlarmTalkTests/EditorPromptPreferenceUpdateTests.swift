import XCTest
@testable import AlarmTalk

/// 편집기 문구 화면에서 고른 지역·운세가 **내 계정 설정**에 올라가는가(`DynamicPromptPreferences.editorUpdate`).
///
/// 예전 iOS 는 편집기에서 고른 지역을 키체인에만 적어, 계정에 지역이 있으면 다음 알람·설정 화면이
/// 옛 지역을 보였고 공휴일 국가도 따라오지 않았다. 안드로이드 `AlarmEditorScreen` 의 문구 결과 처리
/// (`onUpdateDynamicPromptSettings` + 지역이 바뀔 때만 `WeatherRegionHolidaySync.onRegionSaved`)와 같은 판정이다.
final class EditorPromptPreferenceUpdateTests: XCTestCase {

    private let seoul = DynamicPromptPreferences(weatherCountry: "대한민국", weatherCity: "서울")

    private func weatherResult(country: String, city: String) -> MessageSettingsResult {
        MessageSettingsResult(
            context: "wake_weather",
            manualText: "",
            weatherCountry: country,
            weatherCity: city,
            fortuneGender: "",
            fortuneBirthDate: "",
            fortuneBirthTime: ""
        )
    }

    func test_편집기에서_다른_지역을_고르면_계정에_올리고_공휴일_국가를_맞춘다() throws {
        let update = try XCTUnwrap(DynamicPromptPreferences.editorUpdate(
            result: weatherResult(country: "일본", city: "도쿄"),
            familyAlarmMode: false,
            saved: seoul,
            server: seoul
        ))
        XCTAssertEqual(update.preferences.weatherCountry, "일본")
        XCTAssertEqual(update.preferences.weatherCity, "도쿄")
        XCTAssertTrue(update.needsUpload, "계정(서버)에 올라가야 다음 알람·설정·다른 기기가 같은 지역을 본다")
        XCTAssertEqual(update.changedRegionKey, "jp-tokyo", "지역이 바뀌면 공휴일 국가도 그 나라로")
        // 서버로 가는 모양에는 지역 키가 함께 실린다(설정 '지역' 행과 같은 payload).
        XCTAssertEqual(update.preferences.toSettings().weather.region, "jp-tokyo")
    }

    func test_날씨_종류만_다시_고르면_아무것도_올리지_않고_달력도_건드리지_않는다() throws {
        let update = try XCTUnwrap(DynamicPromptPreferences.editorUpdate(
            result: weatherResult(country: "대한민국", city: "서울"),
            familyAlarmMode: false,
            saved: seoul,
            server: seoul
        ))
        XCTAssertFalse(update.needsUpload)
        XCTAssertNil(update.changedRegionKey, "지역이 그대로면 공휴일 국가를 다시 쓰지 않는다(안드로이드와 같다)")
    }

    func test_기기에만_있던_지역은_같은_지역이어도_계정에_올린다() throws {
        // 업데이트 전 편집기가 키체인에만 적어 둔 값 — 서버는 비어 있다.
        let update = try XCTUnwrap(DynamicPromptPreferences.editorUpdate(
            result: weatherResult(country: "대한민국", city: "서울"),
            familyAlarmMode: false,
            saved: seoul,
            server: DynamicPromptPreferences()
        ))
        XCTAssertTrue(update.needsUpload)
        XCTAssertNil(update.changedRegionKey, "지역 자체는 그대로다")
    }

    func test_가족_알람의_지역은_내_계정에_적지_않는다() {
        XCTAssertNil(DynamicPromptPreferences.editorUpdate(
            result: weatherResult(country: "일본", city: "도쿄"),
            familyAlarmMode: true,
            saved: seoul,
            server: seoul
        ), "받는 사람의 지역이다 — 적으면 남의 나라 공휴일로 내 알람이 꺼진다")
    }

    func test_직접_입력은_반영할_것이_없다() {
        var result = weatherResult(country: "일본", city: "도쿄")
        result.context = MessageSettingsResult.manualContext
        XCTAssertNil(DynamicPromptPreferences.editorUpdate(result: result, familyAlarmMode: false, saved: seoul, server: seoul))
    }

    func test_다른_종류는_날씨_칸을_건드리지_않는다() {
        // '약' 을 골랐는데 화면에 남아 있던 날씨 글자까지 계정에 적으면 안 된다.
        var result = weatherResult(country: "일본", city: "도쿄")
        result.context = "medication"
        XCTAssertNil(DynamicPromptPreferences.editorUpdate(result: result, familyAlarmMode: false, saved: seoul, server: seoul))
    }

    func test_옛_앱_표준_글자로_적는다() throws {
        // 목록으로 되짚히는 다른 표기(영어·일본어)도 옛 앱이 읽는 한국어 글자로 적는다.
        let update = try XCTUnwrap(DynamicPromptPreferences.editorUpdate(
            result: weatherResult(country: "Japan", city: "東京都"),
            familyAlarmMode: false,
            saved: seoul,
            server: seoul
        ))
        XCTAssertEqual(update.preferences.weatherCountry, "일본")
        XCTAssertEqual(update.preferences.weatherCity, "도쿄")
    }

    func test_되짚지_못한_옛_글자는_그대로_두고_달력도_건드리지_않는다() throws {
        let update = try XCTUnwrap(DynamicPromptPreferences.editorUpdate(
            result: weatherResult(country: "대한민국", city: "속초"),
            familyAlarmMode: false,
            saved: seoul,
            server: seoul
        ))
        XCTAssertEqual(update.preferences.weatherCity, "속초")
        XCTAssertTrue(update.needsUpload)
        XCTAssertNil(update.changedRegionKey, "나라를 모르는 값으로 공휴일 국가를 바꾸지 않는다")
    }

    func test_운세는_날씨를_지키며_올린다() throws {
        let result = MessageSettingsResult(
            context: "wake_fortune",
            manualText: "",
            weatherCountry: "",
            weatherCity: "",
            fortuneGender: "여성",
            fortuneBirthDate: "1990-01-02",
            fortuneBirthTime: "07:30"
        )
        let update = try XCTUnwrap(DynamicPromptPreferences.editorUpdate(
            result: result, familyAlarmMode: false, saved: seoul, server: seoul
        ))
        XCTAssertEqual(update.preferences.weatherCity, "서울", "계정의 지역을 비우면 안 된다")
        XCTAssertEqual(update.preferences.fortuneBirthDate, "1990-01-02")
        XCTAssertTrue(update.needsUpload)
        XCTAssertNil(update.changedRegionKey)
    }

    func test_운세_칸이_하나라도_비면_운세는_적지_않는다() {
        let result = MessageSettingsResult(
            context: "wake_fortune",
            manualText: "",
            weatherCountry: "",
            weatherCity: "",
            fortuneGender: "여성",
            fortuneBirthDate: "",
            fortuneBirthTime: "07:30"
        )
        XCTAssertNil(DynamicPromptPreferences.editorUpdate(result: result, familyAlarmMode: false, saved: seoul, server: seoul))
    }
}
