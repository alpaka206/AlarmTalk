package com.alarmtalk.app

import com.alarmtalk.app.sync.shouldPromoteToForeground
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 기본 목소리 받기 워커는 **받을 것이 있을 때만** `dataSync` 포그라운드 서비스를 올린다
 * (`docs/spec/voice-and-message.md` 「준비 페이지」, 2026-10-11).
 *
 * 워커는 콜드 스타트마다 돌고 대부분의 회차는 빠진 클립이 0개다. 고치기 전에는 빠진 것을 세기 **전에**
 * `publishProgress`(= `setForeground`)를 불러, 받을 것이 없는 회차마다 서비스와 알림이 떴다가 내려갔다 —
 * 하는 일 없이 Android 15 의 서비스 시간 한도에 들어갔다(ALARMTALK-ANDROID-Y 조사).
 *
 * 판정은 순수 함수([shouldPromoteToForeground])로 고정하고, 워커가 그 판정 **뒤에서만** 서비스를 올리는지는
 * 소스 배선으로 본다 — `CoroutineWorker` 를 유닛 테스트에서 세우려면 WorkManager 테스트 도구가 필요한데 이
 * 모듈에는 없다(`SourceWiring.kt` 의 방식).
 */
class StockClipPrefetchWorkerForegroundTest {

    @Test
    fun nothingMissingNeverPromotes() {
        assertFalse(shouldPromoteToForeground(missingCount = 0))
    }

    @Test
    fun anythingMissingPromotes() {
        assertTrue(shouldPromoteToForeground(missingCount = 1))
        assertTrue(shouldPromoteToForeground(missingCount = 76))
    }

    /**
     * ⚠ **판정 앞에서 서비스를 올리지 않는다.** 고치기 전의 모양(`publishProgress` 가 `missing.isEmpty()`
     * 판정보다 먼저)으로 되돌리면 첫 단언에서 깨진다.
     */
    @Test
    fun theWorkerPromotesOnlyAfterCountingWhatIsMissing() {
        val body = withoutLineComments(
            functionBody(readSource("sync/StockClipPrefetchWorker.kt"), "private suspend fun runWork()"),
        )
        val decision = body.indexOf("shouldPromoteToForeground(missing.size)")
        assertTrue("받을 것이 있는지를 이 판정으로 가른다", decision >= 0)
        val firstPromotion = body.indexOf("publishProgress(")
        assertTrue("서비스를 올리는 첫 자리(publishProgress)는 판정 뒤다", firstPromotion > decision)
        // 받을 것이 없는 갈래 — 진행 값만 알리고 서비스는 올리지 않는다.
        val nothingToDownload = body.substring(decision, firstPromotion)
        assertTrue(nothingToDownload.contains("setProgress(progressData("))
        assertFalse(nothingToDownload.contains("setForeground("))
        assertTrue("받을 것이 없으면 그 자리에서 끝난다", nothingToDownload.contains("Result.success()"))
    }
}
