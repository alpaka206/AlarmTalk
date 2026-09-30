package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.DynamicPromptFortuneSettings
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 서버의 계정 설정(지역·사주)을 **이 기기에 받아 적는가**, 그리고 **이 기기의 새 변경을 덮지
 * 않는가**(`DynamicPromptPreferenceStore.adoptAccountSettings`·`adoptAccountPromptSettings`).
 *
 * 예전에는 로컬 저장소를 채우는 길이 이 기기에서 고를 때뿐이라, 두 번째 기기는 계정에 지역이
 * 있는데도 설정에 '지역: 미설정' 이 보였다. 반대로 받을 때마다 덮으면 오프라인에서 고른 새 지역이
 * 서버의 옛 지역으로 조용히 되돌아간다 — 두 방향을 모두 고정한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AccountPromptSettingsAdoptionTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val store = DynamicPromptPreferenceStore(context)

    private fun regionSettings(key: String): DynamicPromptSettings {
        val labels = requireNotNull(WeatherRegions.canonicalLabels(key))
        return DynamicPromptSettings(
            weather = DynamicPromptWeatherSettings(country = labels.country, city = labels.city, region = key),
        )
    }

    /** 이 기기에서 고르고 서버 저장까지 성공한 상태(= 안 올라간 변경 없음). */
    private fun savedAndPushed(userId: String, key: String) {
        val region = requireNotNull(WeatherRegions.byKey(key))
        store.saveWeatherLocation(userId, region.legacyCountry, region.legacyCity)
        store.markPushed(userId, store.read(userId).toDynamicPromptSettings())
    }

    // ── 1. 두 번째 기기 ────────────────────────────────────────────

    @Test
    fun 새_기기는_계정의_지역과_사주를_받아_적는다() {
        val server = regionSettings("jp-osaka").copy(
            fortune = DynamicPromptFortuneSettings(gender = "여성", birthDate = "1990-01-01", birthTime = "07:31~09:30"),
        )

        val adoption = store.adoptAccountSettings("user-a", server)

        assertEquals(AccountSettingsAdoption.Accepted, adoption)
        val local = store.read("user-a")
        assertEquals("jp-osaka", local.weatherRegion?.key)
        assertEquals("일본", local.weatherCountry)
        assertEquals("1990-01-01", local.fortuneBirthDate)
        // 받아 적은 값은 '이 기기의 변경' 이 아니다 — 다시 올릴 것이 없다.
        assertFalse(store.hasUnsyncedChange("user-a"))
    }

    @Test
    fun 옛_서버처럼_키_없이_글자만_와도_그_글자를_적는다() {
        val server = DynamicPromptSettings(weather = DynamicPromptWeatherSettings(country = "대한민국", city = "부산"))

        store.adoptAccountSettings("user-a", server)

        assertEquals("kr-busan", store.read("user-a").weatherRegion?.key)
    }

    @Test
    fun 다른_기기에서_바꾼_지역을_따라간다() {
        savedAndPushed("user-a", "kr-seoul")

        store.adoptAccountSettings("user-a", regionSettings("us-chicago"))

        assertEquals("us-chicago", store.read("user-a").weatherRegion?.key)
    }

    @Test
    fun 같은_값을_몇_번_받아도_결과가_같다() {
        val server = regionSettings("jp-tokyo")
        store.adoptAccountSettings("user-a", server)
        val first = store.read("user-a")

        assertEquals(AccountSettingsAdoption.Accepted, store.adoptAccountSettings("user-a", server))
        assertEquals(first, store.read("user-a"))
    }

    // ── 2. 이 기기의 새 변경은 덮지 않는다 ─────────────────────────

    @Test
    fun 올리지_못한_이_기기의_지역은_서버의_옛_지역으로_덮지_않고_다시_올릴_값을_돌려준다() {
        savedAndPushed("user-a", "kr-seoul")
        // 오프라인에서 도쿄를 골랐다 — 저장(PATCH)은 실패해 서버는 여전히 서울이다.
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)

        val adoption = store.adoptAccountSettings("user-a", regionSettings("kr-seoul"))

        assertEquals("jp-tokyo", store.read("user-a").weatherRegion?.key)
        assertTrue(adoption is AccountSettingsAdoption.LocalPending)
        val resend = (adoption as AccountSettingsAdoption.LocalPending).settings
        assertEquals("jp-tokyo", resend.weather.region)
        assertTrue(store.hasUnsyncedChange("user-a"))
    }

    @Test
    fun 올린_값이_받아들여지면_표시가_내려가고_다시_다른_기기를_따른다() {
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)
        store.markPushed("user-a", store.read("user-a").toDynamicPromptSettings())
        assertFalse(store.hasUnsyncedChange("user-a"))

        store.adoptAccountSettings("user-a", regionSettings("kr-busan"))

        assertEquals("kr-busan", store.read("user-a").weatherRegion?.key)
    }

    @Test
    fun 올리는_사이에_또_고쳤으면_표시를_내리지_않는다() {
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)
        val pushed = store.read("user-a").toDynamicPromptSettings()
        // 응답이 오기 전에 오사카로 다시 골랐다.
        val osaka = requireNotNull(WeatherRegions.byKey("jp-osaka"))
        store.saveWeatherLocation("user-a", osaka.legacyCountry, osaka.legacyCity)

        store.markPushed("user-a", pushed)

        assertTrue(store.hasUnsyncedChange("user-a"))
        // 서버가 도쿄를 돌려줘도 오사카가 남는다.
        store.adoptAccountSettings("user-a", regionSettings("jp-tokyo"))
        assertEquals("jp-osaka", store.read("user-a").weatherRegion?.key)
    }

    @Test
    fun 올리기는_됐는데_응답을_못_받았으면_서버가_같은_값을_줄_때_표시만_내린다() {
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)

        val adoption = store.adoptAccountSettings("user-a", regionSettings("jp-tokyo"))

        assertEquals(AccountSettingsAdoption.Accepted, adoption)
        assertFalse(store.hasUnsyncedChange("user-a"))
    }

    @Test
    fun 서버에_빈_묶음은_로컬을_지우지_않는다() {
        savedAndPushed("user-a", "kr-daegu")
        // 서버에는 사주만 있다(날씨는 아직 안 올라갔다) — 비어 있는 것은 '지웠다' 가 아니다.
        val server = DynamicPromptSettings(
            fortune = DynamicPromptFortuneSettings(gender = "남성", birthDate = "1980-05-05", birthTime = "09:31~11:30"),
        )

        store.adoptAccountSettings("user-a", server)

        val local = store.read("user-a")
        assertEquals("kr-daegu", local.weatherRegion?.key)
        assertEquals("남성", local.fortuneGender)
    }

    @Test
    fun 로그아웃하면_안_올라간_변경_표시도_지운다() {
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)

        store.clearLastSelections("user-a")

        assertFalse(store.hasUnsyncedChange("user-a"))
        // 다시 로그인하면 빈 로컬이 서버를 이기지 않고 계정 값을 받아 온다.
        store.adoptAccountSettings("user-a", regionSettings("kr-seoul"))
        assertEquals("kr-seoul", store.read("user-a").weatherRegion?.key)
    }

    // ── 3. 공휴일 국가도 같은 규칙을 따른다 ────────────────────────

    @Test
    fun 새_기기는_지역과_함께_공휴일_국가도_그_나라가_된다() = runTest {
        val holidays = HolidayCountryPreferenceStore(context)
        assertFalse(holidays.hasSavedCountry())

        adoptAccountPromptSettings(store, holidays, "user-a", regionSettings("us-new-york"))

        assertEquals("us-new-york", store.read("user-a").weatherRegion?.key)
        assertEquals("US", holidays.read())
    }

    @Test
    fun 이_기기의_변경이_밀려_있으면_공휴일_국가도_서버의_옛_지역을_따르지_않는다() = runTest {
        val holidays = HolidayCountryPreferenceStore(context)
        adoptAccountPromptSettings(store, holidays, "user-a", regionSettings("kr-seoul"))
        assertEquals("KR", holidays.read())
        // 이 기기에서 도쿄를 골랐는데 저장이 실패했다(고를 때 공휴일 국가는 이미 JP 가 된다).
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)
        WeatherRegionHolidaySync.onRegionSaved(holidays, tokyo)
        // 그 사이 다른 기기가 계정 지역을 시카고로 바꿨다 — '지난번에 받은 것' 과 다르다.
        val adoption = adoptAccountPromptSettings(store, holidays, "user-a", regionSettings("us-chicago"))

        assertTrue(adoption is AccountSettingsAdoption.LocalPending)
        // 화면의 지역(도쿄)과 달력의 나라가 갈라지지 않는다.
        assertEquals("jp-tokyo", store.read("user-a").weatherRegion?.key)
        assertEquals("JP", holidays.read())
    }
}
