package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.DynamicPromptPreferences
import com.alarmtalk.app.data.HolidayCountryPreferenceStore
import com.alarmtalk.app.data.WeatherCountry
import com.alarmtalk.app.data.WeatherRegionHolidaySync
import com.alarmtalk.app.data.WeatherRegions
import com.alarmtalk.app.data.resolvedRegion
import com.alarmtalk.app.data.toDynamicPromptSettings
import com.alarmtalk.app.data.toPromptPreferences
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings
import com.alarmtalk.app.network.normalizeDynamicPromptSettings
import java.io.File
import kotlinx.coroutines.test.runTest
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
 *  4. 공휴일 국가는 지역의 나라다 — 되짚지 못하면 건드리지 않고, 서버 값은 **바뀌었을 때만** 적는다.
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

    // ── 4. 공휴일 국가 = 지역의 나라 ─────────────────────────────────

    @Test
    fun 지역을_저장하면_공휴일_국가가_그_나라가_되고_못_되짚으면_그대로다() = runTest {
        val store = HolidayCountryPreferenceStore(context)
        store.setCountry("KR")
        WeatherRegionHolidaySync.onRegionSaved(store, WeatherRegions.byKey("us-new-york"))
        assertEquals("US", store.read())
        WeatherRegionHolidaySync.onRegionSaved(store, null)
        assertEquals("US", store.read())
    }

    @Test
    fun 새_기기는_계정_지역의_나라를_받는다() = runTest {
        val store = HolidayCountryPreferenceStore(context)
        assertFalse(store.hasSavedCountry())
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("jp-osaka"))
        assertEquals("JP", store.read())
        assertEquals("jp-osaka", store.lastAccountRegionKey())
    }

    @Test
    fun 업데이트_직후_직접_고른_공휴일_국가는_지역이_바뀌기_전까지_둔다() = runTest {
        val store = HolidayCountryPreferenceStore(context)
        // 옛 '공휴일 달력' 행에서 고른 값.
        store.setCountry("JP")
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("kr-seoul"))
        assertEquals("JP", store.read())
        // 같은 지역을 다시 받아도 그대로다.
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("kr-seoul"))
        assertEquals("JP", store.read())
        // 다른 기기에서 지역을 바꿨다 — 이제 따라간다.
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("us-chicago"))
        assertEquals("US", store.read())
    }

    // ⚠ '이 기기에서 고른 뒤 저장이 실패했는데 서버가 옛 지역을 준다' 는 여기 오지 않는다 — 받아 적기가
    //   LocalPending 이라 [WeatherRegionHolidaySync.onAccountRegionReceived] 를 부르지 않는다
    //   (`AccountPromptSettingsAdoptionTest.이_기기의_변경이_밀려_있으면_공휴일_국가도_서버의_옛_지역을_따르지_않는다`).

    @Test
    fun 받아들일_때마다_지역의_나라로_맞춘다_로그아웃_뒤_같은_계정도() = runTest {
        val store = HolidayCountryPreferenceStore(context)
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("kr-seoul"))
        assertEquals("KR", store.read())
        // 이 기기에서 도쿄를 골랐다(달력 JP). 저장이 실패한 채 로그아웃하면 값과 '안 올라간 변경' 표시는
        // 지워지고 공휴일 국가만 남는다.
        WeatherRegionHolidaySync.onRegionSaved(store, WeatherRegions.byKey("jp-tokyo"))
        assertEquals("JP", store.read())
        // 같은 계정으로 다시 들어와 계정 지역(서울)을 받아들였다 — 화면이 서울이니 달력도 한국이다.
        // ("지난번과 같은 지역이면 건너뛴다" 였다면 JP 에 남았다.)
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("kr-seoul"))
        assertEquals("KR", store.read())
    }

    @Test
    fun 직접_고른_나라를_지키던_중_지역을_다시_고르면_지역의_나라가_된다() = runTest {
        val store = HolidayCountryPreferenceStore(context)
        store.setCountry("JP") // 옛 '공휴일 달력' 행에서 고른 값
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("kr-seoul"))
        assertEquals("JP", store.read())
        assertEquals("kr-seoul", store.keptCountryAccountRegionKey())
        // 설정 '지역' 행에서 서울을 다시 골랐다 — 이제 지키지 않는다.
        WeatherRegionHolidaySync.onRegionSaved(store, WeatherRegions.byKey("kr-seoul"))
        assertEquals("KR", store.read())
        assertNull(store.keptCountryAccountRegionKey())
        // 저장 응답으로 같은 지역을 받아도 한국 그대로다.
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("kr-seoul"))
        assertEquals("KR", store.read())
    }

    /**
     * **지켜 둔 나라는 그 계정의 것이다**(Codex #837). 이 기기 전역의 표시를 지역 키로만 가르면, 같은
     * 지역(서울)의 다른 계정이 들어왔을 때 앞 계정 때 지켜 둔 나라(JP)를 물려받는다 — 그 계정에게는
     * 공휴일 국가를 바꿀 행이 없다. 같은 계정으로 다시 들어오면 그대로 지킨다.
     */
    @Test
    fun 지켜_둔_나라는_다른_계정에_물려주지_않는다() = runTest {
        val store = HolidayCountryPreferenceStore(context)
        store.setCountry("JP") // 옛 '공휴일 달력' 행에서 고른 값
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("kr-seoul"))
        assertEquals("JP", store.read())
        // 같은 계정이 다시 들어왔다(로그아웃 뒤 재로그인) — 그대로 지킨다.
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, WeatherRegions.byKey("kr-seoul"))
        assertEquals("JP", store.read())
        // 다른 계정이 들어왔다 — 지역이 같아도 그 계정의 지역의 나라를 따른다.
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_B, WeatherRegions.byKey("kr-seoul"))
        assertEquals("KR", store.read())
        assertNull(store.keptCountryAccountRegionKey())
        assertNull(store.keptCountryAccountUserId())
    }

    @Test
    fun 계정_지역이_없거나_못_되짚으면_공휴일_국가를_건드리지_않는다() = runTest {
        val store = HolidayCountryPreferenceStore(context)
        store.setCountry("US")
        val legacy = DynamicPromptWeatherSettings(country = "영국", city = "런던").resolvedRegion()
        WeatherRegionHolidaySync.onAccountRegionReceived(store, USER_A, legacy)
        assertEquals("US", store.read())
        assertNull(store.lastAccountRegionKey())
    }

    private companion object {
        const val USER_A = "user-a"
        const val USER_B = "user-b"
    }
}
