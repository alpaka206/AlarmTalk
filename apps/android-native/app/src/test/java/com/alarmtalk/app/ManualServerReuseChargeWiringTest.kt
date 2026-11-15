package com.alarmtalk.app

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 서버 재사용(`cache_hit`)도 **한 번 센다**(2026-10-27 — `docs/spec/voice-and-message.md` §8). 그래서 사용 기록
 * `manual_result_reused`(server)는 새 제작과 같이 서버가 말한 정산 수단·사용월을 싣고, 광고 보상으로 셌으면 보상을 쓴 것으로
 * 적는다(`docs/spec/usage-events.md` §7). 기기 캐시 재사용(local)은 서버를 타지 않아 그대로 차감이 없다.
 */
class ManualServerReuseChargeWiringTest {
    @Test
    fun `서버 재사용 기록은 서버가 말한 정산 수단과 사용월을 싣고 광고 보상이면 보상 사용을 적는다`() {
        val body = functionBody(
            withoutLineComments(readSource("data/UsageSignals.kt")),
            "internal fun recordManualGenerationResult(",
        )
        val start = body.indexOf("if (response.cacheHit == true) {")
        assertTrue("서버 재사용 갈래를 못 찾았다", start >= 0)
        val reuse = body.substring(start, body.indexOf("return", start))
        assertTrue(reuse.contains("reuseLocation = UsageEventProps.REUSE_SERVER"))
        assertTrue(reuse.contains("chargedSource = response.chargedSource"))
        assertTrue(reuse.contains("usageMonth = response.usageMonth"))
        assertTrue(reuse.contains("AdRewardAttempts.spent(context, requestId)"))
    }
}
