package com.alarmtalk.app.sync

import com.alarmtalk.app.data.SYSTEM_VOICE_ID_PREFIX
import com.alarmtalk.app.data.UsageEventProps
import com.alarmtalk.app.network.StockClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 준비 기록은 받은 대상(기본 목소리·내 목소리)마다 따로 적는다(코덱스 #958). 한 묶음으로 적으면 한국어 기기에서 일본어 클론만
 * 받은 회차가 '한국어 기본 목소리 준비' 로 잡힌다. iOS `StockClipPrefetcher.PreparationReports` 와 한 쌍이다.
 */
class PreparationSplitTest {
    private val systemVoice = SYSTEM_VOICE_ID_PREFIX + "000000000101"
    private fun clip(id: String, voice: String, language: String) =
        StockClip(messageId = id, voiceProfileId = voice, language = language)

    @Test
    fun `기본 목소리를 다 받았고 클론만 받으면 클론 쪽만 그 언어로 시작한다`() {
        val system = clip("s1", systemVoice, "ko")
        val clone = listOf(clip("c1", "clone-1", "ja"), clip("c2", "clone-1", "ja"))

        val specs = PreparationSplit.plan(listOf(system) + clone, missing = clone, deviceLanguage = "ko")

        val only = specs.single()
        assertEquals(false, only.system)
        assertEquals(UsageEventProps.SCOPE_SELECTED_VOICE, only.scope)
        assertEquals("ja", only.language)
        assertEquals("clone-1", only.voiceProfileId)
        assertEquals(2, only.target)
        assertEquals(0, only.alreadyCached)
    }

    @Test
    fun `둘 다 받으면 두 쪽으로 나누고 기본 목소리는 기기 언어다`() {
        val system = listOf(clip("s1", systemVoice, "ko"), clip("s2", systemVoice, "ko"))
        val clones = listOf(clip("c1", "clone-1", "ja"), clip("c2", "clone-2", "en"))

        val specs = PreparationSplit.plan(system + clones, missing = listOf(system[1]) + clones, deviceLanguage = "ko")

        assertEquals(listOf(true, false), specs.map { it.system })
        assertEquals(UsageEventProps.SCOPE_ALL_VOICES, specs[0].scope)
        assertEquals("ko", specs[0].language)
        assertEquals(1, specs[0].alreadyCached)
        // 클론이 둘이면 목소리 하나·언어 하나로 말할 수 없다 — 비운다.
        assertNull(specs[1].voiceProfileId)
        assertNull(specs[1].language)
    }

    @Test
    fun `그 쪽을 다 받았으면 다른 쪽이 예산에 걸려도 준비 끝이다`() {
        assertNull(
            PreparationSplit.failureCode(
                complete = true, sessionExpired = false, budgetExhausted = true, failures = 0, transientFailures = 0,
            ),
        )
        assertEquals(
            "run_budget_exhausted",
            PreparationSplit.failureCode(
                complete = false, sessionExpired = false, budgetExhausted = true, failures = 0, transientFailures = 0,
            ),
        )
        assertEquals(
            "clip_download_permanent",
            PreparationSplit.failureCode(
                complete = false, sessionExpired = false, budgetExhausted = false, failures = 1, transientFailures = 0,
            ),
        )
    }
}
