package com.alarmtalk.app.data

import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 준비도 계산 — 준비 페이지와 편집기 관문이 함께 쓰는 값.
 *
 * ⚠ **iOS `ClipReadinessTests` 와 같은 표를 쓴다.** 두 앱이 같은 %를 보여 줘야 한다.
 */
class ClipReadinessTest {

    private fun clip(voice: String, category: String, variant: Int, language: String = "ko") = StockClip(
        messageId = "$voice-$category-$variant-$language",
        voiceProfileId = voice,
        category = category,
        language = language,
        text = "t",
        variant = variant,
    )

    private val counts = ExpectedVariantCounts(
        system = mapOf("weather" to 9, "medication" to 2),
        clone = mapOf("weather" to 9, "medication" to 3, "love" to 3, "fortune" to 5, "greeting" to 1),
    )

    @Test
    fun expectedCountDiffersBetweenSystemAndClone() {
        assertEquals(2, counts.countFor("medication", isSystemVoice = true))
        assertEquals(3, counts.countFor("medication", isSystemVoice = false))
    }

    @Test
    fun systemVoiceIsReadyWithItsOwnSmallerSet() {
        // 기본 목소리의 medication 은 2개면 **완전하다.** 클론 기준(3)으로 재면 영원히 '부족'.
        val result = ClipReadiness.evaluate(
            voiceProfileIds = listOf("sys"),
            clips = listOf(clip("sys", "medication", 0), clip("sys", "medication", 1)),
            expectedVariants = counts,
            isSystemVoice = { true },
            categoriesFor = { listOf("medication") },
            renderState = { false to false },
            isCached = { true },
        )
        assertEquals(2, result.first().expected)
        assertEquals(0, result.first().missing)
        assertTrue(ClipReadiness.isReady(result))
    }

    @Test
    fun missingCountsOnlyWhatIsActuallyAbsent() {
        // 운영이 시드를 9 → 11 로 늘리면 **비는 2개만** 부족으로 잡혀야 한다.
        val grown = ExpectedVariantCounts(system = mapOf("weather" to 11), clone = emptyMap())
        val cachedIds = (0 until 9).map { "sys-weather-$it-ko" }.toSet()
        val result = ClipReadiness.evaluate(
            voiceProfileIds = listOf("sys"),
            clips = (0 until 9).map { clip("sys", "weather", it) },
            expectedVariants = grown,
            isSystemVoice = { true },
            categoriesFor = { listOf("weather") },
            renderState = { false to false },
            isCached = { it.messageId in cachedIds },
        )
        assertEquals(11, result.first().expected)
        assertEquals(9, result.first().cached)
        assertEquals(2, result.first().missing)
        assertFalse(ClipReadiness.isReady(result))
    }

    @Test
    fun sameVariantInTwoLanguagesIsCountedOnce() {
        // 언어가 섞여 내려와도 **자리 수**로 센다. 안 그러면 절반만 받고 '다 됐다' 가 된다.
        val result = ClipReadiness.evaluate(
            voiceProfileIds = listOf("sys"),
            clips = listOf(
                clip("sys", "medication", 0, language = "ko"),
                clip("sys", "medication", 0, language = "en"),
            ),
            expectedVariants = counts,
            isSystemVoice = { true },
            categoriesFor = { listOf("medication") },
            renderState = { false to false },
            isCached = { true },
        )
        assertEquals(1, result.first().cached)
        assertEquals(1, result.first().missing)
    }

    @Test
    fun renderingVoiceCountsAsEntirelyPending() {
        val result = ClipReadiness.evaluate(
            voiceProfileIds = listOf("clone"),
            clips = emptyList(),
            expectedVariants = counts,
            isSystemVoice = { false },
            categoriesFor = { listOf("love") },
            renderState = { true to false },
            isCached = { true },
        )
        assertEquals(0, ClipReadiness.percent(result))
        assertFalse(ClipReadiness.isReady(result))
    }

    @Test
    fun renderFailedIsNotReadyEvenWhenNothingIsMissing() {
        val failed = ClipReadiness.VoiceProgress("clone", isRendering = false, renderFailed = true, expected = 3, cached = 3)
        assertFalse(failed.isReady)
        assertTrue(failed.copy(renderFailed = false).isReady)
    }

    @Test
    fun percentNeverShows100UntilItIsActuallyDone() {
        val almost = listOf(ClipReadiness.VoiceProgress("sys", false, false, expected = 1000, cached = 999))
        assertEquals(99, ClipReadiness.percent(almost))
        val done = listOf(ClipReadiness.VoiceProgress("sys", false, false, expected = 10, cached = 10))
        assertEquals(100, ClipReadiness.percent(done))
    }

    @Test
    fun emptyTargetIsNotReady() {
        // 대상이 없다 = 매니페스트를 아직 못 받았다. 준비됐다고 하면 안 된다.
        assertFalse(ClipReadiness.isReady(emptyList()))
    }
}
