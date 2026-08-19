package com.alarmtalk.app

import com.alarmtalk.app.data.SYSTEM_VOICE_ID_PREFIX
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 사전렌더 클립 관문([ClipGate.needsClipPreparation]) 회귀 테스트.
 *
 * ⚠ **이 테스트가 지키는 것은 "한 목소리가 종류에 따라 준비됐을 수도 아닐 수도 있다" 는
 * 사실 하나다.** 2026-08-18 전에는 관문이 **목소리를 고를 때만** 돌았는데, 그 전제가 맞으면
 * 목소리를 통과시킨 것이 그 뒤 고른 문구 종류까지 보장하지 못한다 — 그래서 문구 종류
 * 선택과 저장 직전에도 같은 판정을 심었다(`AlarmEditorScreen` 의 세 자리).
 *
 * 그 세 자리가 **같은 함수**를 부르는지는 컴파일러가 지킨다(판정이 이 파일에만 있다).
 * 여기서는 판정 자체가 맞는지를 지킨다.
 */
class ClipPreparationGateTest {
    private val cloneVoiceId = "11111111-1111-4111-8111-111111111111"
    private val sharedVoiceId = "22222222-2222-4222-8222-222222222222"
    private val systemVoiceId = SYSTEM_VOICE_ID_PREFIX + "000000000101"

    private fun clip(voiceId: String, category: String, variant: Int) = StockClip(
        messageId = "$voiceId-$category-$variant",
        voiceProfileId = voiceId,
        category = category,
        language = "ko",
        variant = variant,
    )

    /** 사랑은 3개 다 있고, 약은 3개 중 2개만 있다 — 서버가 아직 만드는 중인 흔한 상태. */
    private val partiallyRenderedClone = listOf(
        clip(cloneVoiceId, "love", 0),
        clip(cloneVoiceId, "love", 1),
        clip(cloneVoiceId, "love", 2),
        clip(cloneVoiceId, "medication", 0),
        clip(cloneVoiceId, "medication", 1),
    )

    private val expected = ExpectedVariantCounts(
        system = mapOf("weather" to 3, "medication" to 2),
        clone = mapOf("love" to 3, "medication" to 3, "greeting" to 3, "weather" to 3, "fortune" to 3),
    )

    private fun gate(
        clips: List<StockClip> = partiallyRenderedClone,
        expectedVariants: ExpectedVariantCounts? = expected,
    ) = ClipGate(stockClips = clips, expectedVariants = expectedVariants, appVoiceLanguage = "ko")

    @Test
    fun `같은 목소리라도 문구 종류에 따라 관문 답이 갈린다`() {
        // 이 한 줄이 문구 종류 선택 자리에 관문이 필요한 이유 전부다.
        assertFalse(
            "사랑은 3개가 다 있으니 통과해야 한다",
            gate().needsClipPreparation(cloneVoiceId, randomPrompt = true, randomContext = "love"),
        )
        assertTrue(
            "약은 3개 중 2개뿐이라 막아야 한다 — 목소리는 같다",
            gate().needsClipPreparation(cloneVoiceId, randomPrompt = true, randomContext = "medication"),
        )
    }

    @Test
    fun `부분 세트는 완전하지 않다`() {
        // variant 0..N-1 이 전부 있어야 한다. 서버가 '절대 인덱스'로 클립을 고르므로
        // 구멍이 있으면 엉뚱한 조건이 재생된다.
        assertFalse(gate().hasCompleteCloneBucket("medication", cloneVoiceId))
        assertTrue(gate().hasCompleteCloneBucket("love", cloneVoiceId))
    }

    @Test
    fun `기본 목소리는 막지 않는다`() {
        // 선다운로드 대상이라 관문이 막을 일이 아니다. 매니페스트에 클립이 하나도 없어도 같다.
        assertFalse(
            gate().needsClipPreparation(systemVoiceId, randomPrompt = true, randomContext = "medication"),
        )
    }

    @Test
    fun `직접 입력은 클립이 필요 없다`() {
        assertFalse(
            gate().needsClipPreparation(cloneVoiceId, randomPrompt = false, randomContext = "medication"),
        )
    }

    @Test
    fun `매니페스트를 못 받았으면 막지 않는다`() {
        // 못 물어본 것이 사용자를 막는 근거가 되면 안 된다.
        assertFalse(
            gate(expectedVariants = null)
                .needsClipPreparation(cloneVoiceId, randomPrompt = true, randomContext = "medication"),
        )
    }

    @Test
    fun `방금 공유받아 클립이 하나도 없는 목소리는 막는다`() {
        // 소유자 쪽 렌더가 아직 안 끝난 경우. 여기서 통과시키면 라이브 생성이 사라진 뒤
        // 울릴 오디오가 없는 알람이 저장된다.
        assertTrue(
            gate().needsClipPreparation(sharedVoiceId, randomPrompt = true, randomContext = "love"),
        )
    }

    @Test
    fun `기본 인사말도 버킷으로 매핑된다`() {
        // `preset` → `greeting`. 유료 클론은 문구 5종이 전부 버킷으로 매핑되므로
        // (CLAUDE.md 「버킷이 붙으면…」) 사실상 모든 종류가 관문 대상이다.
        assertTrue(
            gate().needsClipPreparation(cloneVoiceId, randomPrompt = true, randomContext = "preset"),
        )
    }
}
