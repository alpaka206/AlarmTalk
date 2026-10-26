package com.alarmtalk.app

import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.sync.PrefetchTarget
import com.alarmtalk.app.sync.StockClipPrefetchPriority
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 기본 목소리 받기의 순서(`docs/spec/voice-and-message.md` 「알람마다 필요한 목소리만 본다」) — 저장된 다음 알람 →
 * 고르려는 목소리·테마 → 고르려는 목소리의 나머지 → 저장된 알람 목소리의 나머지 → 그 밖. 받는 대상은 줄지 않는다.
 */
class StockClipPrefetchPriorityTest {
    private fun clip(id: String, voice: String, category: String) =
        StockClip(messageId = id, voiceProfileId = voice, category = category, language = "ko")

    private val manifest = listOf(
        clip("a-weather", "70000000-0000-4000-9000-00000000000a", "weather"),
        clip("a-cheer", "70000000-0000-4000-9000-00000000000a", "cheer"),
        clip("b-weather", "70000000-0000-4000-9000-00000000000b", "weather"),
        clip("b-cheer", "70000000-0000-4000-9000-00000000000b", "cheer"),
        clip("c-weather", "70000000-0000-4000-9000-00000000000c", "weather"),
        clip("c-cheer", "70000000-0000-4000-9000-00000000000c", "cheer"),
    )

    private fun order(saved: List<PrefetchTarget>, requested: PrefetchTarget?) =
        StockClipPrefetchPriority.order(manifest, saved, requested) { it }.map { it.messageId }

    @Test
    fun 아무_단서가_없으면_매니페스트_순서_그대로다() {
        assertEquals(manifest.map { it.messageId }, order(emptyList(), null))
    }

    @Test
    fun 저장된_다음_알람이_먼저이고_고른_목소리가_그다음이다() {
        val saved = listOf(PrefetchTarget("70000000-0000-4000-9000-00000000000c", "cheer"))
        val requested = PrefetchTarget("70000000-0000-4000-9000-00000000000b", "weather")
        assertEquals(
            listOf("c-cheer", "b-weather", "b-cheer", "c-weather", "a-weather", "a-cheer"),
            order(saved, requested),
        )
    }

    @Test
    fun 다음에_울릴_알람부터_받는다() {
        val saved = listOf(PrefetchTarget("70000000-0000-4000-9000-00000000000b", "cheer"), PrefetchTarget("70000000-0000-4000-9000-00000000000a", "weather"))
        // 저장된 알람 목소리의 나머지(a-cheer 는 둘째 알람의 목소리라 b-weather 보다 뒤다)
        assertEquals(listOf("b-cheer", "a-weather", "b-weather", "a-cheer", "c-weather", "c-cheer"), order(saved, null))
    }

    @Test
    fun 테마_없이_목소리만_골랐으면_그_목소리_전체가_다른_목소리보다_먼저다() {
        assertEquals(
            listOf("c-weather", "c-cheer", "a-weather", "a-cheer", "b-weather", "b-cheer"),
            order(emptyList(), PrefetchTarget("70000000-0000-4000-9000-00000000000c", null)),
        )
    }

    @Test
    fun 다른_목소리로_다시_고르면_새_선택이_앞선다() {
        val first = order(emptyList(), PrefetchTarget("70000000-0000-4000-9000-00000000000b", null))
        assertEquals("b-weather", first.first())
        // 워커는 배치마다 다시 줄 세운다 — 남은 목록을 새 선택으로 세우면 새 목소리가 맨 앞이다.
        val remaining = StockClipPrefetchPriority.order(
            manifest.filter { it.messageId in first.drop(1) },
            emptyList(),
            PrefetchTarget("70000000-0000-4000-9000-00000000000a", null),
        ) { it }.map { it.messageId }
        assertEquals(listOf("a-weather", "a-cheer"), remaining.take(2))
        assertEquals(5, remaining.size)
    }

    @Test
    fun 폰에_다_받지_못한_기본_목소리만_고르지_못한다() {
        val progress = mapOf("70000000-0000-4000-9000-00000000000a" to (19 to 19), "70000000-0000-4000-9000-00000000000b" to (3 to 19))
        assertFalse(systemVoiceStillDownloading("70000000-0000-4000-9000-00000000000a", progress))
        assertTrue(systemVoiceStillDownloading("70000000-0000-4000-9000-00000000000b", progress))
        // 모르면 막지 않는다 — 저장이 그 자리에서 받는다.
        assertFalse(systemVoiceStillDownloading("70000000-0000-4000-9000-00000000000b", null))
        assertFalse(systemVoiceStillDownloading("70000000-0000-4000-9000-00000000000c", progress))
        // 내 목소리는 이 판정의 대상이 아니다(ClipGate 가 본다).
        assertFalse(systemVoiceStillDownloading("clone-1", mapOf("clone-1" to (0 to 5))))
    }
}
