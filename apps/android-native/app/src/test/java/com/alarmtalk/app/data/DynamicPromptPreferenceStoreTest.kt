package com.alarmtalk.app.data

import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 운세·날씨 입력이 **계정별**인지.
 *
 * ⚠ 예전에는 이 둘만 기기 전역 키를 썼다(주석에도 "날씨/사주와 달리" 라고 적혀 있었다).
 * 그런데 성별·생년월일·태어난 시간은 기기 취향이 아니라 **특정 사람의 개인정보**다 —
 * 로그아웃하고 다른 계정으로 들어오면 앞 사람의 사주가 새 사용자의 '내 정보' 로 채워져
 * 보였고, 그대로 저장하면 남의 생년월일로 운세를 받게 된다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DynamicPromptPreferenceStoreTest {

    private fun store() =
        DynamicPromptPreferenceStore(ApplicationProvider.getApplicationContext())

    @Test
    fun `사주는 계정별로 나뉜다`() {
        val s = store()
        s.saveFortuneInfo("user-a", "여성", "1990-01-01", "07:31~09:30")

        assertEquals("여성", s.read("user-a").fortuneGender)
        // 다른 계정에는 아무것도 보이면 안 된다.
        assertEquals("", s.read("user-b").fortuneGender)
        assertEquals("", s.read("user-b").fortuneBirthDate)
        assertEquals("", s.read("user-b").fortuneBirthTime)
    }

    @Test
    fun `날씨 지역도 계정별로 나뉜다`() {
        val s = store()
        s.saveWeatherLocation("user-a", "KR", "서울")

        assertEquals("서울", s.read("user-a").weatherCity)
        assertEquals("", s.read("user-b").weatherCity)
    }

    /** 로그인 전에는 누구 것으로 새길지 모른다 — 읽지도 쓰지도 않는다. */
    @Test
    fun `로그인 전에는 저장하지 않는다`() {
        val s = store()
        s.saveFortuneInfo(null, "남성", "1980-05-05", "09:31~11:30")

        assertEquals("", s.read(null).fortuneGender)
        assertEquals("", s.read("user-a").fortuneGender)
    }

    /**
     * 계정 스코프로 옮기기 전에 저장된 전역 값은 **처음 읽는 계정이 넘겨받는다.**
     * 안 하면 이미 사주를 등록해 둔 사용자가 앱 업데이트 후 값을 잃는다.
     */
    @Test
    fun `옛 전역 값을 첫 계정이 넘겨받는다`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        context.getSharedPreferences("dynamic_prompt_preferences", android.content.Context.MODE_PRIVATE)
            .edit()
            .putString("fortune_gender", "여성")
            .putString("fortune_birth_date", "1990-01-01")
            .putString("weather_city", "부산")
            .apply()

        val s = store()
        val first = s.read("user-a")
        assertEquals("여성", first.fortuneGender)
        assertEquals("부산", first.weatherCity)

        // ⚠ 넘겨받은 뒤 전역 키는 사라져야 한다 — 남으면 다음 계정이 또 물려받아
        //   애초의 누수가 그대로 재현된다.
        assertEquals("", s.read("user-b").fortuneGender)
        assertEquals("", s.read("user-b").weatherCity)
    }

    /** 명시적 로그아웃·탈퇴에서는 개인정보를 남기지 않는다. */
    @Test
    fun `로그아웃하면 사주와 날씨가 지워진다`() {
        val s = store()
        s.saveFortuneInfo("user-a", "여성", "1990-01-01", "07:31~09:30")
        s.saveWeatherLocation("user-a", "KR", "서울")

        s.clearLastSelections("user-a")

        val after = s.read("user-a")
        assertTrue(after.fortuneGender.isEmpty())
        assertTrue(after.fortuneBirthDate.isEmpty())
        assertTrue(after.fortuneBirthTime.isEmpty())
        assertTrue(after.weatherCity.isEmpty())
    }
}
