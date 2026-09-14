import XCTest
@testable import AlarmTalk

/// 날씨 지역 **직접 입력** 한 줄을 (나라, 도시)로 가르는 규칙.
///
/// 이 칸은 프리셋 목록(국내 9개)에 없는 곳에 사는 사람을 위한 것이다. 나라를 안 가르면
/// "뉴욕" 이 **대한민국 뉴욕**으로 저장돼 서버가 날씨를 못 찾는다 — 사용자는 자기 지역
/// 날씨를 들을 줄 알고 저장한다.
final class WeatherLocationParseTests: XCTestCase {

    func test_나라와_도시를_가른다() {
        let parsed = WeatherCityPickerSheet.parseLocation("미국 뉴욕")
        XCTAssertEqual(parsed.country, "미국")
        XCTAssertEqual(parsed.city, "뉴욕")
    }

    /// 도시 이름에 공백이 있어도 **첫 낱말만** 나라다.
    func test_도시에_공백이_있어도_나라는_첫_낱말이다() {
        let parsed = WeatherLocationParseTests.parse("미국 뉴욕 브루클린")
        XCTAssertEqual(parsed.country, "미국")
        XCTAssertEqual(parsed.city, "뉴욕 브루클린")
    }

    /// 공백이 없으면 국내로 본다 — 프리셋과 같은 뜻이라 "속초" 처럼 도시만 적어도 된다.
    func test_공백이_없으면_국내로_본다() {
        let parsed = WeatherLocationParseTests.parse("속초")
        XCTAssertEqual(parsed.country, "대한민국")
        XCTAssertEqual(parsed.city, "속초")
    }

    /// 끝에 공백만 남은 경우 나라 이름을 도시로 오해하면 안 된다.
    func test_뒤에_공백만_있으면_도시로_읽는다() {
        let parsed = WeatherLocationParseTests.parse("속초   ")
        XCTAssertEqual(parsed.country, "대한민국")
        XCTAssertEqual(parsed.city, "속초")
    }

    func test_앞뒤_공백을_다듬는다() {
        let parsed = WeatherLocationParseTests.parse("  일본 도쿄  ")
        XCTAssertEqual(parsed.country, "일본")
        XCTAssertEqual(parsed.city, "도쿄")
    }

    private static func parse(_ raw: String) -> (country: String, city: String) {
        WeatherCityPickerSheet.parseLocation(raw)
    }
}
