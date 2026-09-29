import Foundation
import Testing
@testable import AlarmTalk

/// 날씨 지역 프리셋 — **보이는 이름은 언어마다, 보내는 값은 하나**.
///
/// 안드로이드 `WeatherPresetCitiesResourceTest` 의 짝이다. 안드로이드는 로케일마다 배열을
/// 두므로 "개수가 같은가" 를 보고, iOS 는 저장 값이 카탈로그 키라 "모든 키에 번역이 있는가" 를
/// 본다 — 같은 질문이다(빠지면 그 언어 기기에서 한국어 이름이 섞여 보인다).
///
/// `-testLanguage ko` 로 돌므로 번역은 앱 번들의 `<언어>.lproj` 를 직접 연다
/// (`CodeShareTextTests` 와 같은 방식).
struct WeatherPresetCityLocalizationTests {

    @Test("저장 값은 안드로이드 WeatherPresetCityKeys 와 같은 목록·같은 순서다")
    func keysMatchAndroid() {
        #expect(WeatherCityPickerSheet.presetCities == ["서울", "부산", "인천", "대구", "대전", "광주", "울산", "수원", "제주"])
    }

    @Test("영어·일본어 이름이 모두 있고 안드로이드와 같다", arguments: [
        ("en", ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju", "Ulsan", "Suwon", "Jeju"]),
        ("ja", ["ソウル", "釜山", "仁川", "大邱", "大田", "光州", "蔚山", "水原", "済州"]),
    ])
    func everyPresetIsTranslated(language: String, expected: [String]) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let names = WeatherCityPickerSheet.presetCities.map {
            WeatherCityPickerSheet.displayName(for: $0, bundle: bundle)
        }
        #expect(names == expected)
    }

    @Test("목록 밖 도시는 적힌 그대로 보인다")
    func customCityIsShownAsTyped() throws {
        let path = try #require(Bundle.main.path(forResource: "en", ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(WeatherCityPickerSheet.displayName(for: " 속초 ", bundle: bundle) == "속초")
        // 카탈로그에 같은 글자의 키가 있어도 도시가 아니면 번역하지 않는다.
        #expect(WeatherCityPickerSheet.displayName(for: "직접 입력", bundle: bundle) == "직접 입력")
    }

    @Test("한국어에서는 저장 값이 곧 이름이다")
    func koreanShowsKeys() {
        for key in WeatherCityPickerSheet.presetCities {
            #expect(WeatherCityPickerSheet.displayName(for: key) == key)
        }
    }
}
