package com.alarmtalk.app

import com.alarmtalk.app.network.AppVersionResponse
import com.google.gson.Gson
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 지역 시트의 **날씨 출처 줄은 서버가 원천을 말할 때만** 보인다(코덱스 #845) — 규칙은
 * docs/spec/voice-and-message.md 「지역 시트의 날씨 출처 줄 — 서버가 원천을 말할 때만」.
 *
 * 앱이 "기상청 · 気象庁 · 미국 기상청(NWS)" 을 스스로 단정하면, 서버가 아직 Open-Meteo 를 쓰는 동안(원천 교체가
 * 늦거나 되돌려진 경우 포함) 쓰지 않는 기관을 출처로 적는다. 그래서 `GET /api/app/version` 의
 * `weather_attribution` 이 정확히 `"kma_jma_nws"` 일 때만 그린다.
 *
 * `MainViewModel` 은 단위 테스트에서 세울 수 없고(`EntryRefreshKeepsTokenTest` 와 같은 사정) 이 모듈에는 Compose
 * UI 테스트 의존성이 없어, 셋으로 나눠 고정한다:
 *  1. **판정**: [showsWeatherAttribution] — 그 토큰 하나만 참.
 *  2. **계약**: [AppVersionResponse] 가 필드를 읽고, 필드가 없는 옛 서버·`null` 은 null 이다(앱과 같은 기본 Gson).
 *  3. **배선**(소스): 버전 확인이 값을 받고 실패면 지우며, 시트가 그 판정 뒤에서만 줄을 그리고, 화면에 값이 내려간다.
 */
class WeatherAttributionTest {

    @Test
    fun onlyTheOfficialForecastsTokenShowsTheLine() {
        assertTrue(showsWeatherAttribution("kma_jma_nws"))
        // 응답 전·확인 실패·필드 없는 옛 서버.
        assertFalse(showsWeatherAttribution(null))
        // 지금 서버(Open-Meteo) 또는 앱이 모르는 다른 원천 조합 — 틀린 문장을 말하지 않는다.
        assertFalse(showsWeatherAttribution(""))
        assertFalse(showsWeatherAttribution("open_meteo"))
        // 불투명 토큰이다 — 대소문자·공백을 고쳐 읽지 않는다.
        assertFalse(showsWeatherAttribution("KMA_JMA_NWS"))
        assertFalse(showsWeatherAttribution(" kma_jma_nws"))
    }

    @Test
    fun theVersionResponseCarriesTheTokenAndOldServersReadAsNull() {
        val gson = Gson() // `AlarmTalkApiClient` 의 `GsonConverterFactory.create()` 와 같은 기본 Gson.
        fun parse(extra: String): AppVersionResponse = gson.fromJson(
            "{\"platform\":\"android\",\"min_supported_version\":30,\"latest_version\":30,\"store_url\":\"x\"$extra}",
            AppVersionResponse::class.java,
        )
        assertEquals("kma_jma_nws", parse(",\"weather_attribution\":\"kma_jma_nws\"").weatherAttribution)
        assertNull(parse(",\"weather_attribution\":null").weatherAttribution)
        // 이 필드를 모르는 옛 서버.
        val old = parse("")
        assertNull(old.weatherAttribution)
        assertEquals(30, old.minSupportedVersion)
    }

    @Test
    fun theVersionCheckKeepsTheTokenAndForgetsItOnFailure() {
        val body = bodyOf(authActions, "internal fun MainViewModel.checkAppVersion()")
        val failure = body.indexOf(".onFailure")
        assertTrue("checkAppVersion 의 실패 갈래를 못 찾았다.", failure >= 0)
        assertTrue(
            "버전 확인이 성공했을 때 `weatherAttribution = policy.weatherAttribution` 으로 받지 않는다.",
            body.indexOf("weatherAttribution = policy.weatherAttribution") in 0 until failure,
        )
        assertTrue(
            "버전 확인이 실패하면 `weatherAttribution = null` 로 지워야 한다 — 앞 응답의 원천을 계속 말하게 된다.",
            body.indexOf("weatherAttribution = null", failure) >= 0,
        )
    }

    @Test
    fun theRegionSheetDrawsTheLineOnlyBehindTheServerToken() {
        val dialog = bodyOf(promptSettings, "internal fun WeatherLocationDialog(")
        assertTrue(
            "지역 시트가 서버 토큰으로 판정하지 않는다(`showsWeatherAttribution(LocalWeatherAttribution.current)`).",
            dialog.contains("val showsAttribution = showsWeatherAttribution(LocalWeatherAttribution.current)"),
        )
        val line = dialog.indexOf("R.string.region_picker_weather_attribution")
        val guard = dialog.indexOf("if (showsAttribution) {")
        assertTrue("출처 줄(`region_picker_weather_attribution`)을 못 찾았다.", line >= 0)
        assertTrue("출처 줄이 `if (showsAttribution)` 안에 있지 않다 — 늘 그려진다.", guard in 0 until line)
        // 다른 화면이 판정 없이 같은 문장을 그리면 이 가드가 소용없다 — 그리는 자리는 앱 전체에 이 하나다.
        val drawers = File("src/main/java").walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .flatMap { file -> Regex("""R\.string\.region_picker_weather_attribution""").findAll(file.readText()).map { file.name } }
            .toList()
        assertEquals("출처 줄을 그리는 자리는 지역 시트 하나여야 한다: $drawers", listOf("AlarmRandomPromptSettings.kt"), drawers)
        assertTrue(
            "MainActivity 가 서버 토큰을 화면에 내려 주지 않는다 — 기본값(null)이라 줄이 영영 안 뜬다.",
            readSource("src/main/java/com/alarmtalk/app/MainActivity.kt")
                .contains("LocalWeatherAttribution provides viewModel.weatherAttribution"),
        )
    }

    // ── 소스 읽기(`EntryRefreshKeepsTokenTest` 와 같은 방식) ─────────────────

    private val authActions: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModelAuthActions.kt")
    }

    private val promptSettings: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/editor/AlarmRandomPromptSettings.kt")
    }

    /** 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로. */
    private fun readSource(path: String): String {
        val file = File(path)
        assertTrue(
            "$path 를 못 찾았다(경로: ${file.absolutePath}). 파일을 옮겼으면 이 테스트의 경로도 같이 고칠 것.",
            file.exists(),
        )
        return file.readText()
    }

    /** [header] 로 시작하는 함수 본문만 잘라 낸다 — 다음 함수 선언 앞까지. */
    private fun bodyOf(source: String, header: String): String {
        val start = source.indexOf(header)
        assertTrue("$header 를 못 찾았다 — 이름이 바뀌었으면 이 테스트도 같이 고칠 것.", start >= 0)
        val rest = source.substring(start + header.length)
        return rest.substring(0, NEXT_DECLARATION.find(rest)?.range?.first ?: rest.length)
    }

    private companion object {
        /** 줄 첫머리의 함수 선언. 주석(`//`)은 이 모양이 아니라 걸리지 않는다. */
        val NEXT_DECLARATION = Regex("""(?m)^[ \t]*(?:internal |private |public )?(?:suspend )?fun\s""")
    }
}
