package com.alarmtalk.app.data

import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip

/**
 * **"알람을 만들 준비가 됐는가"** 를 한 값으로 계산한다.
 *
 * 사용자에게는 '서버가 만드는 중' 과 '폰이 받는 중' 이 구분되지 않는다. 둘을 합쳐 하나의
 * 진행률로 보여 주기 위한 계산이 여기 있다(화면은 이 값을 그리기만 한다).
 *
 * ⚠ **개수를 앱에 박지 않는다.** 기준은 서버 매니페스트([ExpectedVariantCounts])이고,
 * 앱은 그것과 **디스크에 실제로 있는 것**을 비교해 부족분만 센다. 운영이 시드를 늘리면
 * (예: 날씨 9 → 11) 앱 업데이트 없이 그 2개가 '부족' 으로 잡혀야 한다.
 * 그리고 **기본 목소리와 등록 목소리는 개수가 다르다** — 목소리 종류로 갈라 본다.
 *
 * iOS `ClipReadiness.swift` 와 같은 계산이다. 기대값도 같은 표로 테스트한다.
 */
object ClipReadiness {

    /** 한 목소리의 준비 상태. */
    data class VoiceProgress(
        val voiceProfileId: String,
        /** 서버가 아직 만들고 있는가(클론 사전렌더 큐). */
        val isRendering: Boolean,
        /** 서버가 만들다 실패했는가 — 재시도 대상. */
        val renderFailed: Boolean,
        /** 이 목소리가 완전하려면 있어야 할 클립 수(서버 기준). */
        val expected: Int,
        /** 그중 **디스크에 실제로 있는** 클립 수. */
        val cached: Int,
    ) {
        val missing: Int get() = (expected - cached).coerceAtLeast(0)
        val isReady: Boolean get() = expected > 0 && missing == 0 && !isRendering && !renderFailed
    }

    /**
     * 전체 진행률(0.0~1.0). **생성과 다운로드를 합친다.**
     *
     * 아직 서버가 만들고 있는 목소리는 그 몫이 통째로 남은 것으로 센다 — 사용자에게는
     * '만드는 중' 도 '받는 중' 도 똑같이 기다리는 시간이다.
     */
    fun progress(voices: List<VoiceProgress>): Double {
        val expected = voices.sumOf { it.expected }
        if (expected <= 0) return 1.0
        // 렌더 중이면 아직 받을 수 있는 것이 없다(매니페스트에 안 올라와 있다).
        val done = voices.sumOf { if (it.isRendering) 0 else it.cached }
        return (done.toDouble() / expected).coerceAtMost(1.0)
    }

    /**
     * 퍼센트 표시용 정수(0~100). **100% 는 진짜 다 됐을 때만** 나오게 내림한다 —
     * 99.6% 가 100% 로 보이면 사용자는 끝난 줄 알고 나간다.
     */
    fun percent(voices: List<VoiceProgress>): Int {
        val ratio = progress(voices)
        if (ratio >= 1.0) return 100
        return (ratio * 100).toInt().coerceAtMost(99)
    }

    fun isReady(voices: List<VoiceProgress>): Boolean =
        voices.isNotEmpty() && voices.all { it.isReady }

    /**
     * 매니페스트 + 캐시 상태로 목소리별 준비도를 만든다.
     *
     * @param voiceProfileIds 준비 대상 목소리(기본 목소리 전부 + 내가 등록한 것. 공유받은
     *   목소리는 **고를 때** 대상이 되므로 호출자가 넣고 뺀다).
     * @param categoriesFor 그 목소리에서 준비해야 할 카테고리.
     * @param isCached 그 클립이 디스크에 있는가.
     */
    fun evaluate(
        voiceProfileIds: List<String>,
        clips: List<StockClip>,
        expectedVariants: ExpectedVariantCounts?,
        isSystemVoice: (String) -> Boolean,
        categoriesFor: (String) -> List<String>,
        renderState: (String) -> Pair<Boolean, Boolean>,
        isCached: (StockClip) -> Boolean,
    ): List<VoiceProgress> = voiceProfileIds.map { voiceId ->
        val system = isSystemVoice(voiceId)
        var expected = 0
        var cached = 0
        for (category in categoriesFor(voiceId)) {
            val full = expectedVariants?.countFor(category = category, isSystemVoice = system) ?: continue
            if (full <= 0) continue
            expected += full
            // 한 카테고리 안에서 **같은 variant 를 두 번 세지 않는다.** 언어가 섞여
            // 내려오면 같은 자리가 여러 번 잡혀 '다 받았다' 로 읽힌다.
            cached += clips
                .asSequence()
                .filter { it.voiceProfileId == voiceId && it.category == category && isCached(it) }
                .map { it.variant }
                .filter { it < full }
                .toSet()
                .size
        }
        val (rendering, failed) = renderState(voiceId)
        VoiceProgress(
            voiceProfileId = voiceId,
            isRendering = rendering,
            renderFailed = failed,
            expected = expected,
            cached = cached,
        )
    }
}
