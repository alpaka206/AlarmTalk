package com.alarmtalk.app.data

import com.alarmtalk.app.network.StockClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * greeting 스톡 클립은 보이스당 3개 언어(ko/en/ja)라서 서버 정렬(language ASC = en 먼저)
 * 그대로 firstOrNull 을 쓰면 한국어 사용자도 영어 인사를 듣게 된다. greetingStockClipFor 가
 * 항상 앱 언어를 우선하고 ko → 아무 greeting → 아무 클립 순으로 폴백하는지 고정한다.
 */
class GreetingStockClipTest {

    private fun clip(
        messageId: String,
        voiceProfileId: String = "vp-1",
        category: String? = STOCK_GREETING_CATEGORY,
        language: String? = "ko",
    ) = StockClip(
        messageId = messageId,
        voiceProfileId = voiceProfileId,
        category = category,
        language = language,
    )

    // 서버 정렬과 동일하게 en → ja → ko 순으로 담는다.
    private val greetings = listOf(
        clip("g-en", language = "en"),
        clip("g-ja", language = "ja"),
        clip("g-ko", language = "ko"),
    )

    @Test
    fun `앱 언어의 greeting 을 고른다 - 서버 정렬이 en 우선이어도`() {
        assertEquals("g-ko", greetingStockClipFor(greetings, "vp-1", "ko")?.messageId)
        assertEquals("g-ja", greetingStockClipFor(greetings, "vp-1", "ja")?.messageId)
        assertEquals("g-en", greetingStockClipFor(greetings, "vp-1", "en")?.messageId)
    }

    @Test
    fun `앱 언어 클립이 없으면 ko 로 폴백한다`() {
        val koEnOnly = greetings.filter { it.language != "ja" }
        assertEquals("g-ko", greetingStockClipFor(koEnOnly, "vp-1", "ja")?.messageId)
    }

    @Test
    fun `ko 도 없으면 아무 greeting, greeting 자체가 없으면 그 보이스의 아무 클립`() {
        val enOnly = listOf(clip("g-en", language = "en"))
        assertEquals("g-en", greetingStockClipFor(enOnly, "vp-1", "ko")?.messageId)

        val noGreeting = listOf(clip("w-ko", category = "weather"))
        assertEquals("w-ko", greetingStockClipFor(noGreeting, "vp-1", "ko")?.messageId)
    }

    @Test
    fun `language 가 null 인 레거시 greeting 은 ko 로 취급한다`() {
        val legacy = listOf(clip("g-legacy", language = null), clip("g-en2", language = "en"))
        assertEquals("g-legacy", greetingStockClipFor(legacy, "vp-1", "ko")?.messageId)
    }

    @Test
    fun `다른 보이스의 클립은 절대 고르지 않는다`() {
        val other = listOf(clip("g-other", voiceProfileId = "vp-2"))
        assertNull(greetingStockClipFor(other, "vp-1", "ko"))
    }
}
