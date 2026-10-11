package com.alarmtalk.app

import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.sync.CLIP_PREFETCH_RUN_BUDGET_MILLIS
import com.alarmtalk.app.sync.mayStartNextClipBatch
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 기본 목소리 받기 **한 회차에는 끝이 있다** — `docs/spec/voice-and-message.md` 「준비 페이지」(2026-10-11).
 *
 * 약한 망에서 한 회차가 끝없이 붙잡지 않게 셋을 둔다: 시간 예산(배치 사이), 클립 요청 하나의 전체 시간 상한,
 * 매니페스트는 회차에 한 번 읽기. 셋째는 `data/AlarmAudioStoreProbeCountTest`(`manifestReads`)가, 둘째의
 * 클라이언트 설정은 `network/AlarmTalkApiClientTest` 가 지킨다. 여기는 예산 판정과 워커 배선이다.
 */
class StockClipPrefetchRunBudgetTest {

    private val start = 5_000L

    /** 매니페스트·프로필 조회가 예산을 다 써도 회차마다 조금은 나아가야 한다. */
    @Test
    fun theFirstBatchAlwaysStarts() {
        assertTrue(mayStartNextClipBatch(batchesStarted = 0, runStartedAtMillis = start, nowMillis = start))
        assertTrue(
            mayStartNextClipBatch(
                batchesStarted = 0,
                runStartedAtMillis = start,
                nowMillis = start + CLIP_PREFETCH_RUN_BUDGET_MILLIS * 3,
            ),
        )
    }

    @Test
    fun laterBatchesStartOnlyWithinTheBudget() {
        assertTrue(mayStartNextClipBatch(1, start, start + CLIP_PREFETCH_RUN_BUDGET_MILLIS - 1))
        assertFalse("예산에 닿으면 다음 배치를 시작하지 않는다", mayStartNextClipBatch(1, start, start + CLIP_PREFETCH_RUN_BUDGET_MILLIS))
        assertFalse(mayStartNextClipBatch(12, start, start + CLIP_PREFETCH_RUN_BUDGET_MILLIS + 60_000L))
    }

    @Test
    fun theBudgetIsAParameter() {
        assertTrue(mayStartNextClipBatch(3, runStartedAtMillis = 0L, nowMillis = 999L, budgetMillis = 1_000L))
        assertFalse(mayStartNextClipBatch(3, runStartedAtMillis = 0L, nowMillis = 1_000L, budgetMillis = 1_000L))
    }

    /**
     * 예산을 넘기는 것은 **배치 하나**까지다(배치 사이에서만 본다). 그 배치의 요청마다 전체 시간 상한이 있으므로
     * 예산 + 상한이 일반 작업의 실행 한도(약 10분) 안에 들어야 회차가 스스로 끝난다 — 서비스를 못 올렸거나
     * 시스템이 서비스를 끝낸 뒤에는 그 한도가 걸린다.
     */
    @Test
    fun aRunEndsOnItsOwnInsideTheTenMinuteWindow() {
        val worstCase = CLIP_PREFETCH_RUN_BUDGET_MILLIS + AlarmTalkApiClient.CLIP_DOWNLOAD_CALL_TIMEOUT_SECONDS * 1_000L
        assertTrue("예산 + 요청 상한 = ${worstCase}ms", worstCase < 10 * 60_000L)
    }

    // ── 배선 — 워커가 실제로 그 판정과 상한을 쓰는가 ─────────────────────────────

    private val runWork: String by lazy {
        withoutLineComments(
            functionBody(readSource("sync/StockClipPrefetchWorker.kt"), "private suspend fun runWork()"),
        )
    }

    @Test
    fun theWorkerChecksTheBudgetBetweenBatches() {
        val loop = runWork.indexOf("missing.chunked(PARALLELISM).withIndex()")
        assertTrue("배치마다 몇 번째인지 센다", loop >= 0)
        val check = runWork.indexOf("mayStartNextClipBatch(batchIndex, runStartedAt, SystemClock.elapsedRealtime())")
        val firstRequest = runWork.indexOf("api.getTtsMessageAudio(")
        assertTrue("예산은 배치를 시작하기 **전에** 본다", check in loop until firstRequest)
        // 시계는 회차 첫머리(매니페스트 조회 전)에서 잡는다 — 조회도 회차다.
        assertTrue(runWork.indexOf("val runStartedAt = SystemClock.elapsedRealtime()") in 0 until runWork.indexOf("api.getStockClips("))
    }

    /** 예산에 닿은 회차는 다시 시도하되, 다른 일시적 실패와 같은 횟수 한도 안이다 — 끝없이 돌지 않는다. */
    @Test
    fun aRunThatHitsTheBudgetRetriesWithinTheAttemptLimit() {
        val yieldBranch = runWork.substringAfter("if (budgetExhausted) {").substringBefore("}")
        assertTrue(yieldBranch.contains("runAttemptCount < MAX_RUN_ATTEMPTS"))
        assertTrue(yieldBranch.contains("Result.retry()"))
        assertTrue(yieldBranch.contains("Result.failure()"))
        // 401·계정 전환은 예산보다 먼저 본다 — 끊어야 할 세션을 다시 시도로 덮지 않는다.
        val budgetYield = runWork.indexOf("if (budgetExhausted) {")
        val sessionCheck = runWork.indexOf("sessionExpired.get()?.let { throw it }")
        assertTrue(sessionCheck in 0 until budgetYield)
        val accountCheck = runWork.indexOf("if (accountChangedDuringRun) return@runCatching Result.retry()", sessionCheck)
        assertTrue(accountCheck in sessionCheck until budgetYield)
    }

    @Test
    fun theWorkerClientHasTheClipCallTimeout() {
        assertTrue(
            runWork.contains(
                "AlarmTalkApiClient.create(callTimeoutSeconds = AlarmTalkApiClient.CLIP_DOWNLOAD_CALL_TIMEOUT_SECONDS)",
            ),
        )
    }
}
