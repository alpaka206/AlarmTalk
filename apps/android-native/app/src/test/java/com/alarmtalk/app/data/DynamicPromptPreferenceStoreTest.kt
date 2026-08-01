package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * '직전에 고른 문구 종류' 의 계정 스코프와 옛 키 이관.
 *
 * 이 값은 새 알람의 기본값이라, 잃으면 사용자에겐 "설정이 리셋됐다" 로 보인다 —
 * CLAUDE.md 의 「알람 편집기 기본값 = 직전 선택 유지」 가 회귀라고 못 박은 동작이다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DynamicPromptPreferenceStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val store = DynamicPromptPreferenceStore(context)
    private val prefs =
        context.getSharedPreferences("dynamic_prompt_preferences", Context.MODE_PRIVATE)

    private fun writeLegacy(value: String) {
        prefs.edit().putString("last_message_context", value).commit()
    }

    private fun legacyValue(): String? = prefs.getString("last_message_context", null)

    @Test
    fun `계정별로 나뉜다`() {
        store.saveLastMessageContext("user-a", "love")
        store.saveLastMessageContext("user-b", "wake_weather")
        assertEquals("love", store.readLastMessageContext("user-a"))
        assertEquals("wake_weather", store.readLastMessageContext("user-b"))
    }

    @Test
    fun `업데이트한 기존 사용자는 옛 전역 값을 그대로 이어받는다`() {
        // 계정별 키 도입 전 저장된 값. 그냥 두면 업데이트 후 첫 알람이 기본 인사말로 돌아간다.
        writeLegacy("love")
        assertEquals("love", store.readLastMessageContext("user-a"))
    }

    @Test
    fun `이어받은 뒤에는 옛 전역 값을 남기지 않는다`() {
        writeLegacy("love")
        store.readLastMessageContext("user-a")
        assertNull(legacyValue())
        // 다음 계정은 물려받지 않는다 — 옛 키는 누구 것인지 모르는 값이다.
        assertNull(store.readLastMessageContext("user-b"))
        // 넘겨받은 계정에는 남아 있다.
        assertEquals("love", store.readLastMessageContext("user-a"))
    }

    @Test
    fun `이미 계정별 값이 있으면 옛 값이 덮어쓰지 않는다`() {
        store.saveLastMessageContext("user-a", "medication")
        writeLegacy("love")
        assertEquals("medication", store.readLastMessageContext("user-a"))
    }

    @Test
    fun `로그인 전에는 이어받지 않고 옛 값도 지우지 않는다`() {
        writeLegacy("love")
        assertNull(store.readLastMessageContext(null))
        assertEquals("love", legacyValue())
    }

    @Test
    fun `로그아웃 정리는 옛 전역 값까지 지운다`() {
        store.saveLastMessageContext("user-a", "love")
        store.saveLastFreeBucket("user-a", "weather")
        writeLegacy("medication")
        store.clearLastSelections("user-a")
        assertNull(store.readLastMessageContext("user-a"))
        assertNull(store.readLastFreeBucket("user-a"))
        assertNull(legacyValue())
    }
}
