import Foundation

/// 편집기 문구 화면에서 고른 지역·운세 정보를 **내 계정 설정**에 반영할 값.
///
/// 안드로이드 `ui/editor/AlarmEditorScreen.kt` 의 문구 결과 처리와 같다 —
/// `saveWeatherLocation`/`saveFortuneInfo` 로 기기에 적고, `onUpdateDynamicPromptSettings` 로 계정에 올리고,
/// 지역이 **실제로 바뀌었을 때만** `WeatherRegionHolidaySync.onRegionSaved` 로 공휴일 국가를 맞춘다.
///
/// ⚠ **기기(키체인)에만 적고 끝내지 말 것**(2026-09-30 수정). 예전 iOS 는 편집기에서 고른 지역을
/// 알람을 저장할 때 키체인에만 적었다(옛 `persistDynamicPromptPreferencesIfNeeded`, 지금은 없다). 그런데
/// 계정 설정을 받을 때마다 서버 값이 기기 값을 덮으므로(`AccountPromptSettingsAdoption.swift`), 계정에 지역이
/// 한 번이라도 있으면 편집기에서 고른 지역은 다음 알람에서 조용히 옛 지역으로 되돌아갔고, 공휴일 국가도
/// 따라오지 않았다. 설정 '지역' 행과 같은 길(기기 저장 + '안 올라간 변경' 표시 + 계정 저장 + 공휴일 국가)을 탄다.
struct EditorPromptPreferenceUpdate: Equatable {
    /// 기기(키체인)와 계정에 적을 값 — 지금 계정 기본값 위에 이번에 고른 것만 덮었다.
    var preferences: DynamicPromptPreferences
    /// 계정(`PATCH /user/me`)에 올려야 하는가 — 서버가 가진 값과 다를 때만.
    var needsUpload: Bool
    /// 지역이 **바뀌었으면** 그 지역 키 — 공휴일 국가를 그 나라로 맞춘다(`HolidayStore.adoptCountry(ofWeatherRegion:)`).
    /// 날씨 종류만 다시 골랐거나(지역 그대로) 되짚지 못한 옛 글자면 nil — 달력을 건드리지 않는다.
    var changedRegionKey: String?
}

extension DynamicPromptPreferences {

    /// 편집기 문구 화면의 결과 → 계정 설정에 반영할 값. 반영할 것이 없으면 nil.
    ///
    /// - Parameters:
    ///   - result: 문구 화면이 돌려준 값(`MessageSettingsPane` 의 `onSave`).
    ///   - familyAlarmMode: 가족 알람인가. ⚠ **가족 알람의 지역·사주는 받는 사람의 것이다** — 내 계정에
    ///     적으면 내 날씨 문구가 남의 도시가 되고, 공휴일 국가를 맞추면 **남의 나라 공휴일로 내 알람이 꺼진다.**
    ///   - saved: 지금 내 기본값(`AlarmEditorSheet.savedPromptPreferences` — 계정 설정을 받아 적은 뒤의 기기 값).
    ///   - server: 서버가 가진 값(`DynamicPromptPreferences.from(settings:)`). 이것과 다를 때만 올린다.
    static func editorUpdate(
        result: MessageSettingsResult,
        familyAlarmMode: Bool,
        saved: DynamicPromptPreferences,
        server: DynamicPromptPreferences
    ) -> EditorPromptPreferenceUpdate? {
        guard !familyAlarmMode, !result.isManual else { return nil }
        let context = RandomPromptContext.normalized(result.context)
        var next = saved
        var touched = false
        if context.usesWeather, result.weatherCity.nilIfBlank != nil {
            // 목록으로 되짚히는 값이면 **옛 앱이 읽는 표준 글자**로 적는다(설정 '지역' 행과 같다).
            // 되짚지 못한 옛 글자(직접 입력 시절의 "속초")는 적힌 그대로다.
            let labels = WeatherRegions.storageLabels(country: result.weatherCountry, city: result.weatherCity)
            next.weatherCountry = labels.country ?? ""
            next.weatherCity = labels.city ?? ""
            touched = true
        }
        if context.usesFortune,
           let gender = result.fortuneGender.nilIfBlank,
           let birthDate = result.fortuneBirthDate.nilIfBlank,
           let birthTime = result.fortuneBirthTime.nilIfBlank {
            next.fortuneGender = gender
            next.fortuneBirthDate = birthDate
            next.fortuneBirthTime = birthTime
            touched = true
        }
        guard touched else { return nil }
        let region = next.weatherRegion
        return EditorPromptPreferenceUpdate(
            preferences: next,
            needsUpload: next != server,
            changedRegionKey: region.flatMap { $0.key != saved.weatherRegion?.key ? $0.key : nil }
        )
    }
}
