package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.DynamicPromptPreferences
import com.alarmtalk.app.data.WeatherCountry
import com.alarmtalk.app.data.WeatherRegions
import com.alarmtalk.app.data.resolvedRegion
import com.alarmtalk.app.data.toDynamicPromptSettings
import com.alarmtalk.app.data.toPromptPreferences
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings
import com.alarmtalk.app.network.normalizeDynamicPromptSettings
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 날씨 **지역** 고르기(나라 → 지역, 직접 입력 없음)의 회귀 가드 — 규칙은
 * docs/spec/voice-and-message.md 「날씨 지역은 목록에서만 고른다」, 공휴일은
 * docs/spec/alarm-lifecycle.md 「공휴일 국가는 지역의 나라다」.
 *
 * 지키는 것:
 *  1. **보이는 이름은 앱 언어**, 저장 값은 옛 앱용 한국어 글자 한 벌이다.
 *  2. 되짚히는 옛 값은 그 지역으로 보이고, 못 되짚은 옛 값은 **적힌 글자 그대로 + 다시 고르라는 안내**.
 *  3. 계정 설정은 서버로 `region` 키를 함께 보내고, 받은 키는 옛 앱용 글자를 이긴다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class WeatherRegionPickerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    // ── 1·2. 보이는 모양 ─────────────────────────────────────────────

    @Test
    fun 목록의_지역은_앱_언어의_이름으로_보인다() {
        val seoul = weatherRegionDisplay(context, "대한민국", "서울")
        assertEquals("서울", seoul.label)
        assertEquals("kr-seoul", seoul.region?.key)
        assertFalse(seoul.needsRepick)
        // 옛 영어 기기가 남긴 값도 같은 지역이다.
        assertEquals("kr-seoul", weatherRegionDisplay(context, "South Korea", "Seoul").region?.key)
        assertEquals("서울", weatherLocationSettingsLabel(context, "South Korea", "Seoul"))
        assertEquals("경기", weatherLocationSummary(context, "대한민국", "수원"))
    }

    @Test
    @Config(qualifiers = "en")
    fun 영어_기기는_영어_이름이다() {
        assertEquals("Seoul", weatherRegionDisplay(context, "대한민국", "서울").label)
        assertEquals("Tokyo", weatherRegionDisplay(context, "大韓民国", "東京").label)
    }

    @Test
    @Config(qualifiers = "ja")
    fun 일본어_기기는_일본어_이름이다() {
        assertEquals("ソウル", weatherRegionDisplay(context, "대한민국", "서울").label)
        assertEquals("東京都", weatherRegionDisplay(context, "일본", "도쿄").label)
    }

    @Test
    fun 못_되짚은_옛_값은_적힌_글자_그대로에_다시_고르라고_한다() {
        // 아는 나라(옛 앱이 자동으로 붙인 값)면 도시만.
        val sokcho = weatherRegionDisplay(context, "대한민국", "속초")
        assertEquals("속초", sokcho.label)
        assertNull(sokcho.region)
        assertTrue(sokcho.needsRepick)
        // 모르는 나라 칸은 옛 입력칸이 떼어 간 첫 낱말이다 — 이어 붙인다.
        assertEquals("Birmingham England", weatherRegionDisplay(context, "Birmingham", "England").label)
        assertEquals("영국 런던", weatherLocationSettingsLabel(context, "영국", "런던"))
    }

    @Test
    fun 비어_있으면_미설정이고_안내는_없다() {
        val empty = weatherRegionDisplay(context, "", "")
        assertEquals("", empty.label)
        assertFalse(empty.needsRepick)
        assertEquals(context.getString(R.string.misc2_settings_not_set), weatherLocationSettingsLabel(context, "", ""))
    }

    // ── 고르기 상태 ─────────────────────────────────────────────────

    @Test
    fun 고르기는_지금_지역의_나라로_열고_없으면_기기_공휴일_국가로_연다() {
        val tokyo = WeatherRegions.byKey("jp-tokyo")
        assertEquals(WeatherCountry.JP, initialWeatherPickerCountry(tokyo, "KR"))
        assertEquals(WeatherCountry.US, initialWeatherPickerCountry(null, "US"))
        assertEquals(WeatherCountry.US, initialWeatherPickerCountry(null, "us"))
        assertEquals(WeatherCountry.KR, initialWeatherPickerCountry(null, "VN"))
        assertEquals(WeatherCountry.KR, initialWeatherPickerCountry(null, null))
    }

    @Test
    fun 고른_지역은_옛_앱용_글자로_저장되고_다시_열면_그_지역이_체크된다() {
        for (region in WeatherRegions.all) {
            // 고르기의 onConfirm 이 적는 값(`region.legacyCountry` / `legacyCity`).
            val reopened = weatherRegionDisplay(context, region.legacyCountry, region.legacyCity)
            assertEquals(region.key, reopened.region?.key)
            assertEquals(context.getString(region.nameRes), reopened.label)
        }
    }

    @Test
    fun 직접_입력_자리는_없다() {
        // 옛 직접 입력칸·프리셋 배열·기본 나라 문자열이 세 로케일 어디에도 남지 않는다.
        for (dir in listOf("values", "values-en", "values-ja")) {
            val xml = File("src/main/res/$dir/strings.xml")
            assertTrue("$dir/strings.xml 을 못 찾았다(${xml.absolutePath})", xml.exists())
            val text = xml.readText()
            for (gone in listOf("hs_weather_preset_cities", "hs_weather_city_custom", "hs_weather_default_country")) {
                assertFalse("$dir 에 $gone 가 남아 있다", text.contains("\"$gone\""))
            }
        }
    }

    // ── 3. 계정 설정 ────────────────────────────────────────────────

    @Test
    fun 계정_설정은_region_키를_함께_보낸다() {
        val picked = DynamicPromptPreferences(weatherCountry = "미국", weatherCity = "뉴욕")
        assertEquals("us-new-york", picked.toDynamicPromptSettings().weather.region)
        assertEquals("뉴욕", picked.toDynamicPromptSettings().weather.city)
        // 되짚히는 옛 값은 키가 붙고, 못 되짚은 옛 값은 글자만 간다(서버의 엄격한 옛 경로).
        assertEquals(
            "kr-seoul",
            DynamicPromptPreferences(weatherCountry = "South Korea", weatherCity = "Seoul")
                .toDynamicPromptSettings().weather.region,
        )
        val legacy = DynamicPromptPreferences(weatherCountry = "대한민국", weatherCity = "속초").toDynamicPromptSettings()
        assertNull(legacy.weather.region)
        assertEquals("속초", legacy.weather.city)
    }

    @Test
    fun 받은_region_키는_옛_앱용_글자를_이기고_모르는_키는_글자를_둔다() {
        val server = DynamicPromptSettings(
            weather = DynamicPromptWeatherSettings(country = "대한민국", city = "東京", region = "jp-tokyo"),
        )
        val prefs = server.toPromptPreferences()
        assertEquals("일본", prefs.weatherCountry)
        assertEquals("도쿄", prefs.weatherCity)
        assertEquals("jp-tokyo", prefs.weatherRegion?.key)
        // 키만 있어도(글자 없음) 그 지역의 글자로 채운다 — 받은 알람 채우기(`withRecipientConditions`)가 그 글자를 쓴다.
        assertEquals(
            "미국",
            DynamicPromptSettings(weather = DynamicPromptWeatherSettings(region = "us-chicago"))
                .toPromptPreferences().weatherCountry,
        )
        val unknown = DynamicPromptSettings(
            weather = DynamicPromptWeatherSettings(country = "영국", city = "런던", region = "gb-london"),
        ).toPromptPreferences()
        assertEquals("영국", unknown.weatherCountry)
        assertEquals("런던", unknown.weatherCity)
        assertNull(unknown.weatherRegion)
    }

    @Test
    fun 세션에_저장할_때_region_을_잃지_않는다() {
        val normalized = normalizeDynamicPromptSettings(
            DynamicPromptSettings(weather = DynamicPromptWeatherSettings(country = "일본", city = "도쿄", region = " jp-tokyo ")),
        )
        assertEquals("jp-tokyo", normalized.weather.region)
        assertEquals("jp-tokyo", normalized.weather.resolvedRegion()?.key)
        // 옛 서버(키 없음)는 글자를 되짚는다.
        assertEquals(
            "kr-busan",
            DynamicPromptWeatherSettings(country = "대한민국", city = "부산").resolvedRegion()?.key,
        )
    }
}
