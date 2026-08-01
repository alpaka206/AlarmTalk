package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 같은 문구를 다시 만들 때 서버를 부르지 않고 전에 만든 오디오를 쓰는 별칭.
 *
 * 오디오 파일 이름은 서버가 준 cache_key 라, 앱은 요청 전에 그 이름을 알 수 없다. 그래서
 * 입력값으로 만든 키에서 서버 키로 가는 화살표를 남긴다. 이 키에 무엇이 들어가는지가
 * **계정 간 유출과 직결**되므로 조합을 테스트로 고정한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TtsInputReuseTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val store = AlarmAudioStore(context)

    private fun key(
        userId: String = "user-a",
        profileId: String = "voice-1",
        text: String = "일어나 규원아",
        category: String = "custom",
        language: String = "ko",
        listenerTitle: String? = "규원아",
    ) = AlarmAudioStore.ttsInputKey(userId, profileId, text, category, language, listenerTitle)

    @Test
    fun `같은 입력이면 같은 키`() {
        assertEquals(key(), key())
    }

    @Test
    fun `공백만 다른 문구는 같은 키로 본다`() {
        assertEquals(key(text = "일어나 규원아"), key(text = "  일어나   규원아  "))
    }

    @Test
    fun `계정이 다르면 키가 다르다`() {
        // 캐시는 기기에 남고 로그아웃해도 안 지워진다. 계정을 안 넣으면 다음 계정이 앞 계정의
        // message_id 를 물려받아 알람 동기화가 서버에서 거부된다.
        assertNotEquals(key(userId = "user-a"), key(userId = "user-b"))
    }

    @Test
    fun `호칭이 다르면 키가 다르다`() {
        // 서버가 호칭을 문구 안에 병합하고, 공유 목소리는 보는 사람마다 호칭이 다르다.
        // 빼면 '엄마 목소리로 아빠 호칭'이 나간다.
        assertNotEquals(key(listenerTitle = "규원아"), key(listenerTitle = "아빠"))
        assertNotEquals(key(listenerTitle = null), key(listenerTitle = "규원아"))
    }

    @Test
    fun `목소리와 언어가 다르면 키가 다르다`() {
        assertNotEquals(key(profileId = "voice-1"), key(profileId = "voice-2"))
        assertNotEquals(key(language = "ko"), key(language = "en"))
    }

    @Test
    fun `별칭을 남기면 그대로 되찾는다`() {
        val input = key()
        assertNull(store.resolveTtsInput(input))
        store.linkTtsInput(input, "server-cache-key-1", "일어나 규원아")
        val alias = store.resolveTtsInput(input)
        assertEquals("server-cache-key-1", alias?.cacheKey)
        assertEquals("일어나 규원아", alias?.displayText)
    }

    @Test
    fun `번역된 표시 문구를 그대로 복원한다`() {
        // 앱 언어와 입력 언어가 다르면 서버가 번역한 문구를 돌려준다. 재사용 때 입력 원문을
        // 쓰면 잠금화면 문구와 실제 음성이 어긋난다.
        val input = key(text = "일어나 규원아", language = "en")
        store.linkTtsInput(input, "server-cache-key-en", "Wake up, Gyuwon")
        assertEquals("Wake up, Gyuwon", store.resolveTtsInput(input)?.displayText)
    }

    @Test
    fun `빈 값으로는 별칭을 남기지 않는다`() {
        store.linkTtsInput("", "server-cache-key-1", "text")
        store.linkTtsInput(key(text = "다른 문구"), "", "text")
        assertNull(store.resolveTtsInput(key(text = "다른 문구")))
        // 표시 문구가 없으면 별칭 자체를 남기지 않는다 — 그 값 없이 재사용하면
        // 번역된 오디오에 원문을 붙이게 된다.
        store.linkTtsInput(key(text = "또 다른 문구"), "server-cache-key-2", "")
        assertNull(store.resolveTtsInput(key(text = "또 다른 문구")))
    }
}
