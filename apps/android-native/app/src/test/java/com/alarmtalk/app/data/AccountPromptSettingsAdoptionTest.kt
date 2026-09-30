package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.DynamicPromptFortuneSettings
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
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

    // ── 3. 언제 다시 받아 적는가 ────────────────────────────────────

    /**
     * **같은 옛 값을 다시 받아도 다시 돈다**(Codex #837). 저장이 실패한 뒤 서버는 옛 값을 그대로 준다 —
     * 받아 적기의 축이 값뿐이면 다음 `/auth/me` 가 와도 다시 돌지 않아 밀린 변경이 올라가지 않는다.
     * 축에 받은 시각이 있어야 한다(`accountSettingsReceipt`).
     */
    @Test
    fun 같은_옛_값을_다시_받아도_받아_적기를_다시_돌린다() {
        val user = com.alarmtalk.app.network.AuthUser(
            id = "user-a",
            email = "a@example.test",
            dynamicPromptSettings = regionSettings("kr-seoul"),
        )
        val first = com.alarmtalk.app.network.AuthSession(
            token = "t1", provider = "email", user = user, userFetchedAtMillis = 1_000L,
        )
        // 다음 진입의 `/auth/me` — 값은 같고 받은 시각만 다르다(토큰도 굴렀다).
        val next = first.copy(token = "t2", userFetchedAtMillis = 2_000L)
        assertEquals(accountSettingsReceipt(first), accountSettingsReceipt(first.copy()))
        assertNotEquals(accountSettingsReceipt(first), accountSettingsReceipt(next))
        // 프로필만 고친 저장은 받은 시각을 그대로 둔다 — 그때는 값이 바뀌어 다시 돈다.
        val edited = first.copy(user = user.copy(dynamicPromptSettings = regionSettings("jp-tokyo")))
        assertNotEquals(accountSettingsReceipt(first), accountSettingsReceipt(edited))
        // 계정이 없으면 받아 적을 것이 없다.
        assertNull(accountSettingsReceipt(null))
    }

    /**
     * **앞 요청이 떠 있는 사이 되돌린 선택은 앞 요청이 끝난 뒤 다시 올린다**(Codex #837). 서울(A) → 도쿄(B)
     * 를 올리는 사이 서울로 되돌렸다 — 세션의 서버 값은 아직 A 라 편집기는 '같다' 로 보고 올리지 않는다.
     * 그때 표시를 내리지 않아야, B 가 끝나 세션이 B 가 된 뒤 받아 적기가 A 를 덮지 않고 다시 올린다.
     */
    @Test
    fun 앞_요청이_떠_있는_사이_되돌린_선택은_그_요청이_끝난_뒤_다시_올린다() {
        val seoul = requireNotNull(WeatherRegions.byKey("kr-seoul"))
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        savedAndPushed("user-a", "kr-seoul")
        // B(도쿄)를 고르고 올리기 시작했다.
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)
        val pushedTokyo = store.read("user-a").toDynamicPromptSettings()
        // 올리는 사이 A(서울)로 되돌렸다 — 서버 값(아직 A)과 같아 편집기는 올리지 않고, 표시도 그대로 둔다.
        store.saveWeatherLocation("user-a", seoul.legacyCountry, seoul.legacyCity)
        // B 가 끝났다 — 올린 값(B)이 지금 값(A)과 달라 표시는 남는다.
        store.markPushed("user-a", pushedTokyo)
        assertTrue(store.hasUnsyncedChange("user-a"))

        val adoption = store.adoptAccountSettings("user-a", regionSettings("jp-tokyo"))

        assertTrue(adoption is AccountSettingsAdoption.LocalPending)
        assertEquals("kr-seoul", store.read("user-a").weatherRegion?.key)
        assertEquals(
            "kr-seoul",
            (adoption as AccountSettingsAdoption.LocalPending).settings.weather.region,
        )
    }

    /**
     * **밀린 표시는 묶음(날씨·사주)마다다**(Codex #837). 이 기기에서 지역만 고쳐 밀려 있는 사이 다른 기기가 사주를
     * 고쳤으면, 다시 올릴 값은 **밀린 지역 + 서버의 새 사주**다 — 이 기기의 옛 사주까지 올리면 서버가 설정 전체를
     * 갈아 끼워 다른 기기의 변경이 지워진다.
     */
    @Test
    fun 밀린_지역을_다시_올릴_때_다른_기기가_고친_사주는_받아_적고_함께_올린다() {
        val oldFortune = DynamicPromptFortuneSettings(gender = "여성", birthDate = "1990-01-01", birthTime = "07:31~09:30")
        val newFortune = DynamicPromptFortuneSettings(gender = "남성", birthDate = "1988-05-05", birthTime = "05:31~07:30")
        savedAndPushed("user-a", "kr-seoul")
        store.saveFortuneInfo("user-a", oldFortune.gender!!, oldFortune.birthDate!!, oldFortune.birthTime!!)
        store.markPushed("user-a", store.read("user-a").toDynamicPromptSettings())
        assertFalse(store.hasUnsyncedChange("user-a"))
        // 이 기기에서 도쿄로 바꿨는데 올리지 못했다(오프라인) — 지역만 밀려 있다.
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)
        // 그 사이 다른 기기가 사주를 고쳤다 — 서버는 서울 + 새 사주.
        val server = regionSettings("kr-seoul").copy(fortune = newFortune)

        val adoption = store.adoptAccountSettings("user-a", server)

        assertTrue(adoption is AccountSettingsAdoption.LocalPending)
        val resend = (adoption as AccountSettingsAdoption.LocalPending).settings
        assertEquals("jp-tokyo", resend.weather.region)
        assertEquals(newFortune, resend.fortune)
        // 이 기기에도 새 사주를 받아 적고, 지역은 밀린 도쿄 그대로다.
        val local = store.read("user-a")
        assertEquals("jp-tokyo", local.weatherRegion?.key)
        assertEquals("1988-05-05", local.fortuneBirthDate)
        // 다시 올리기가 끝나면 표시가 모두 내려간다.
        store.markPushed("user-a", resend)
        assertFalse(store.hasUnsyncedChange("user-a"))
    }

    /**
     * **사주만 밀렸으면 받은 지역의 나라로 공휴일 국가를 맞춘다**(Codex #837). 날씨 묶음은 서버 값을 받아 적었으니
     * 달력도 따라야 한다 — 전체 결과(`LocalPending`)만 보고 건너뛰면 화면의 지역과 달력의 나라가 갈라진다.
     */
    @Test
    fun 사주만_밀렸으면_받은_지역의_나라로_공휴일_국가를_맞춘다() = runTest {
        val holidays = HolidayCountryPreferenceStore(context)
        adoptAccountPromptSettings(store, holidays, "user-a", regionSettings("kr-seoul"))
        assertEquals("KR", holidays.read())
        // 이 기기에서 사주를 고쳤는데 올리지 못했다 — 사주만 밀려 있다.
        store.saveFortuneInfo("user-a", "여성", "1990-01-01", "07:31~09:30")
        // 다른 기기가 지역을 도쿄로 바꿨다.

        val adoption = adoptAccountPromptSettings(store, holidays, "user-a", regionSettings("jp-tokyo"))

        assertTrue(adoption is AccountSettingsAdoption.LocalPending)
        assertTrue((adoption as AccountSettingsAdoption.LocalPending).weatherAccepted)
        assertEquals("jp-tokyo", store.read("user-a").weatherRegion?.key)
        assertEquals("JP", holidays.read())
        assertEquals("1990-01-01", adoption.settings.fortune.birthDate)
    }

    /**
     * **공휴일 국가는 받아 적은 뒤의 이 기기 지역을 따른다 — 서버 값이 아니다**(Codex #837). 서버의 날씨 묶음이 비어
     * 있으면 '아직 안 올라갔다' 로 보고 이 기기의 지역(도쿄)을 두는데, 서버 값으로 달력을 맞추면 지역이 없다고 보고
     * 기기 기본값(KR)에 남는다 — 화면은 도쿄, 공휴일은 한국이 된다.
     */
    @Test
    fun 서버_날씨가_비어_이_기기_지역을_두면_공휴일_국가도_그_지역을_따른다() = runTest {
        val holidays = HolidayCountryPreferenceStore(context)
        savedAndPushed("user-a", "jp-tokyo")
        assertFalse(store.hasUnsyncedChange("user-a"))

        val adoption = adoptAccountPromptSettings(store, holidays, "user-a", DynamicPromptSettings())

        assertEquals(AccountSettingsAdoption.Accepted, adoption)
        assertEquals("jp-tokyo", store.read("user-a").weatherRegion?.key)
        assertEquals("JP", holidays.read())
    }

    /**
     * **줄에 선 올리기는 차례가 온 뒤의 밀린 사본을 올린다**(Codex #837). 앞 요청이 같은 값을 올려 표시가 내려갔으면
     * 올릴 것이 없고(null), 밀려 있으면 지금의 이 기기 값(받아 적은 다른 묶음 포함)이다.
     */
    @Test
    fun 올릴_사본은_차례가_온_뒤의_밀린_값이고_이미_올렸으면_없다() {
        savedAndPushed("user-a", "kr-seoul")
        assertNull(store.pendingUploadSnapshot("user-a"))
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)
        store.saveFortuneInfo("user-a", "여성", "1990-01-01", "07:31~09:30")

        val queued = requireNotNull(store.pendingUploadSnapshot("user-a"))
        assertEquals("jp-tokyo", queued.weather.region)
        assertEquals("1990-01-01", queued.fortune.birthDate)
        // 앞 요청이 같은 값을 올렸다 — 줄에 서 있던 다음 올리기는 올릴 것이 없다.
        store.markPushed("user-a", queued)
        assertNull(store.pendingUploadSnapshot("user-a"))
    }

    /** 밀린 변경은 다음 응답에서 다시 올린다 — 같은 옛 값이 또 와도 `LocalPending` 이다(멱등). */
    @Test
    fun 밀린_변경은_같은_옛_값이_다시_와도_다시_올릴_것으로_남는다() {
        store.adoptAccountSettings("user-a", regionSettings("kr-seoul"))
        val tokyo = requireNotNull(WeatherRegions.byKey("jp-tokyo"))
        store.saveWeatherLocation("user-a", tokyo.legacyCountry, tokyo.legacyCity)

        val firstAnswer = store.adoptAccountSettings("user-a", regionSettings("kr-seoul"))
        val secondAnswer = store.adoptAccountSettings("user-a", regionSettings("kr-seoul"))

        assertTrue(firstAnswer is AccountSettingsAdoption.LocalPending)
        assertEquals(firstAnswer, secondAnswer)
        assertEquals("jp-tokyo", store.read("user-a").weatherRegion?.key)
    }
}
