import XCTest
@testable import AlarmTalk

/// 지역 시트의 **날씨 출처 줄은 서버가 원천을 말할 때만** 보인다(코덱스 #845) — 규칙은
/// `docs/spec/voice-and-message.md` 「지역 시트의 날씨 출처 줄 — 서버가 원천을 말할 때만」.
///
/// 앱이 "기상청 · 気象庁 · 미국 기상청(NWS)" 을 스스로 단정하면, 서버가 아직 Open-Meteo 를 쓰는 동안(원천 교체가
/// 늦거나 되돌려진 경우 포함) 쓰지 않는 기관을 출처로 적는다. 그래서 `GET /api/app/version` 의
/// `weather_attribution` 이 정확히 `"kma_jma_nws"` 일 때만 그린다. 버전 확인이 값을 받고 실패면 지우는 것은
/// `AppVersionGateTests` 가 본다. 안드로이드 짝은 `WeatherAttributionTest`.
///
/// 판정(`WeatherAttribution`)·응답 모델은 격리되지 않은 타입이라 비격리 테스트다.
final class WeatherAttributionTests: XCTestCase {

    func test_공식_예보_토큰일_때만_출처_줄을_그린다() {
        XCTAssertTrue(WeatherAttribution.showsLine("kma_jma_nws"))
        // 응답 전·확인 실패·필드 없는 옛 서버.
        XCTAssertFalse(WeatherAttribution.showsLine(nil))
        // 지금 서버(Open-Meteo) 또는 앱이 모르는 다른 원천 조합 — 틀린 문장을 말하지 않는다.
        XCTAssertFalse(WeatherAttribution.showsLine(""))
        XCTAssertFalse(WeatherAttribution.showsLine("open_meteo"))
        // 불투명 토큰이다 — 대소문자·공백을 고쳐 읽지 않는다.
        XCTAssertFalse(WeatherAttribution.showsLine("KMA_JMA_NWS"))
        XCTAssertFalse(WeatherAttribution.showsLine(" kma_jma_nws"))
    }

    /// 앱이 쓰는 것과 **같은 디코더**로 읽는다 — 스네이크 키(`weather_attribution`)가 그대로 풀려야 한다.
    func test_버전_응답이_토큰을_싣고_옛_서버는_nil_이다() throws {
        let decoder = AlarmTalkAPI.makeResponseDecoder()
        func decode(_ extra: String) throws -> AppVersionResponse {
            let json = #"{"platform":"ios","min_supported_version":7,"latest_version":7,"store_url":"x""# + extra + "}"
            return try decoder.decode(AppVersionResponse.self, from: Data(json.utf8))
        }
        XCTAssertEqual(try decode(#","weather_attribution":"kma_jma_nws""#).weatherAttribution, "kma_jma_nws")
        XCTAssertNil(try decode(#","weather_attribution":null"#).weatherAttribution)
        // 이 필드를 모르는 옛 서버 — 디코딩이 깨지지 않는다.
        let old = try decode("")
        XCTAssertNil(old.weatherAttribution)
        XCTAssertEqual(old.minSupportedVersion, 7)
    }
}
