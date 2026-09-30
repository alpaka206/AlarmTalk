package com.alarmtalk.app.data

import com.alarmtalk.app.network.DynamicPromptWeatherSettings

// 날씨 지역을 **값으로** 다루는 손으로 쓴 도우미. 목록·되짚기 규칙은 생성 파일
// `WeatherRegions.kt` 에 있고(손으로 고치지 말 것), 여기는 그걸 앱의 저장 모양
// (알람 행의 나라·도시 글자, 계정 설정의 `weather.region`)에 잇는 자리다.
// 규칙: docs/spec/voice-and-message.md 「날씨 지역은 목록에서만 고른다」.

/**
 * 저장된 (나라, 도시) 글자 → 목록의 지역. 못 되짚으면 null.
 *
 * 알람 행은 지역 키 칸이 따로 없다 — 옛 앱이 읽는 한국어 글자(`WeatherRegions.canonicalLabels`)를
 * 나라·도시 칸에 적고, 키는 **언제나 그 글자에서 되짚는다.** 옛 앱용 글자는 자기 지역으로
 * 정확히 돌아온다(회귀 `WeatherRegionsAliasTest`). 옛 글자(직접 입력 시절)도 같은 함수로
 * 되짚히고, 못 되짚는 값은 null 이라 서버의 엄격한 옛 경로로 돈다.
 */
fun weatherRegionFor(country: String?, city: String?): WeatherRegion? =
    WeatherRegions.resolveAlias(country, city)

/** 계정 설정의 날씨 → 지역. 알맞은 `region` 키가 먼저, 없으면 옛 글자를 되짚는다(서버 `normalizeSetting` 과 같은 순서). */
fun DynamicPromptWeatherSettings.resolvedRegion(): WeatherRegion? =
    WeatherRegions.byKey(region) ?: weatherRegionFor(country, city)
