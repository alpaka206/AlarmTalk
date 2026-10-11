import Foundation

/// 날씨 지역 — 목록(`WeatherRegions`, 생성 파일) 위에서 앱이 쓰는 규칙을 **한 곳에** 둔다.
///
/// 목록 자체는 `Generated/WeatherRegions.generated.swift` 이고 손으로 고치지 않는다
/// (`scripts/gen-weather-regions.py` 가 `packages/shared/src/weather-regions.json` 에서 만든다).
/// 규칙 원문은 `docs/spec/voice-and-message.md` 「날씨 지역은 목록에서만 고른다」.
///
/// 저장 모양은 예전 그대로 **(나라, 도시) 두 글자**다 — 알람 행(`voiceWeatherCountry`·
/// `voiceWeatherCity`)도, 계정 설정(`DynamicPromptPreferences`)도. 지역 키는 그 글자에서
/// **되짚어** 얻는다(`resolveAlias`). 목록에서 고른 값은 옛 앱용 표준 글자(`legacyCountry`·
/// `legacyCity`)로 적히고, 그 글자는 언제나 자기 지역으로 되짚힌다(회귀 `WeatherRegionCatalogTests`).
/// 그래서 키를 따로 한 칸 더 두지 않는다 — 두면 글자와 키가 어긋나는 상태가 생긴다.
extension WeatherRegions {

    /// 저장된 값 → 지역. 계정 설정이 준 `region` 키가 알맞으면 그게 먼저고, 없거나 모르는
    /// 키면 옛 (나라, 도시) 글자를 되짚는다. 못 찾으면 nil — 그 값은 서버의 엄격한 옛 경로로 돈다.
    static func region(key: String? = nil, country: String?, city: String?) -> WeatherRegion? {
        byKey(key) ?? resolveAlias(country: country, city: city)
    }

    /// 알람 행에 적을 (나라, 도시). 되짚히면 **옛 앱이 읽는 표준 글자**, 못 되짚으면 적힌 그대로다.
    ///
    /// 표준 글자로 적는 이유: 옛 앱·옛 서버는 이 글자를 그대로 쓰고, 새 서버는 이 글자를 다시
    /// 키로 되짚는다 — 양쪽 다 같은 지역에 닿는다.
    static func storageLabels(country: String?, city: String?) -> (country: String?, city: String?) {
        if let region = resolveAlias(country: country, city: city) {
            return (region.legacyCountry, region.legacyCity)
        }
        return (country.nilIfBlank, city.nilIfBlank)
    }

    /// 화면에 보일 지역 이름. 되짚히면 앱 언어의 지역 이름, 못 되짚으면 **적힌 글자 그대로**,
    /// 아무것도 없으면 nil. 안드로이드 `weatherRegionDisplay` 와 같은 규칙이다.
    ///
    /// ⚠ **나라를 붙이지 않는다**(2026-08-17 규칙 그대로) — 보이는 자리(설정 '지역' 행, 문구
    /// 상세 카드, 문구 요약 `날씨 · 서울`)는 전부 지역 이름 하나로 말한다.
    /// 단 되짚지 못한 옛 값에서 나라 칸이 **아는 나라가 아니면**, 옛 입력칸이 첫 낱말을 나라 칸으로
    /// 떼어 간 것이라 둘을 다시 이어 붙인다("Birmingham England" 가 "England" 로 보이면 안 된다).
    static func displayName(
        country: String?,
        city: String?,
        language: String = WeatherRegions.currentLanguage()
    ) -> String? {
        if let region = resolveAlias(country: country, city: city) {
            return region.displayName(language: language)
        }
        guard let trimmedCity = city.nilIfBlank?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return nil
        }
        guard let trimmedCountry = country.nilIfBlank?.trimmingCharacters(in: .whitespacesAndNewlines),
              WeatherRegions.country(forLabel: trimmedCountry) == nil else {
            return trimmedCity
        }
        return "\(trimmedCountry) \(trimmedCity)"
    }

    /// 글자는 있는데 목록으로 되짚지 못한 **옛 값**인가(예: 직접 입력 시절의 "속초").
    ///
    /// 이런 값은 지우지도, 고르게 강요하지도 않는다 — 글자를 그대로 보이고 짧은 안내만
    /// 붙인다. 바꾸기 전까지는 서버의 엄격한 옛 경로로 계속 돈다.
    static func isUnresolvedLegacy(country: String?, city: String?) -> Bool {
        city.nilIfBlank != nil && resolveAlias(country: country, city: city) == nil
    }

    /// 되짚지 못한 옛 값이면 그 글자(`displayName` 과 같은 모양), 아니면 nil — 지역 시트의 부제에 쓴다.
    static func unresolvedLegacyLabel(country: String?, city: String?) -> String? {
        isUnresolvedLegacy(country: country, city: city) ? displayName(country: country, city: city) : nil
    }

    /// 지역을 고르는 시트가 처음 보일 나라. 고른 지역이 있으면 그 나라, 없으면 [fallbackCountryCode]
    /// — 이 기기의 공휴일 국가(없으면 기기 지역이 KR·JP·US 면 그 나라, 아니면 KR).
    /// 안드로이드 `initialWeatherPickerCountry`(폴백 = `HolidayCountryPreferenceStore.read()`)와 같다.
    static func initialPickerCountry(
        for region: WeatherRegion?,
        fallbackCountryCode: String? = HolidayStore.persistedCountryCode()
    ) -> WeatherCountry {
        region?.country ?? WeatherCountry.fromCode(fallbackCountryCode) ?? .kr
    }
}
