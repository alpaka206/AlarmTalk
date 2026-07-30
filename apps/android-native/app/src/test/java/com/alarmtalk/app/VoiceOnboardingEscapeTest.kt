package com.alarmtalk.app

import androidx.work.WorkInfo
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 목소리 준비 화면의 탈출구 노출 판정.
 *
 * 이 화면은 뒤로가기를 삼키고 다른 이동 수단이 없어서, 판정이 틀리면 사용자가 **앱을 아예
 * 못 쓰는 상태로 갇힌다.** 실제로 두 조합을 놓쳤다(Codex #660) — 아래 두 테스트가 그것이다.
 */
class VoiceOnboardingEscapeTest {

    @Test
    fun `네트워크가 없어 큐에만 남은 상태는 즉시 노출 대상이 아니다`() {
        // 워커에 NetworkType.CONNECTED 제약이 있어, 연결이 없으면 한 번도 안 돈 채
        // ENQUEUED 로 남는다(runAttemptCount = 0). 정상 진입 직후와 상태가 같아 여기서는
        // 가를 수 없다 — 그래서 즉시 열지 않는다. 이 조합은 화면의 유예 타이머가 받는다.
        assertFalse(stockPrefetchStalled(WorkInfo.State.ENQUEUED, 0))
    }

    @Test
    fun `빈손으로 성공해도 화면이 남아 있으면 탈출구를 연다`() {
        // 매니페스트가 아직 없으면 워커가 아무것도 못 받고 SUCCEEDED 로 끝난다.
        // completeVoiceSetupIfDownloaded 는 캐시가 0 이라 게이트를 못 닫아 화면이 남는다.
        // 실패도 재시도 대기도 아니라서, 이 분기가 없으면 영원히 갇힌다.
        assertTrue(stockPrefetchStalled(WorkInfo.State.SUCCEEDED, 0))
    }

    @Test
    fun `재시도 대기는 즉시 노출한다`() {
        assertTrue(stockPrefetchStalled(WorkInfo.State.ENQUEUED, 1))
    }

    @Test
    fun `실패와 취소도 종료 상태라 노출한다`() {
        assertTrue(stockPrefetchStalled(WorkInfo.State.FAILED, 3))
        assertTrue(stockPrefetchStalled(WorkInfo.State.CANCELLED, 0))
    }

    @Test
    fun `받는 중이거나 정보가 없으면 즉시 노출하지 않는다`() {
        // 정상 경로. 몇 초면 끝날 일에 선택지를 내밀지 않는다.
        assertFalse(stockPrefetchStalled(WorkInfo.State.RUNNING, 0))
        assertFalse(stockPrefetchStalled(null, 0))
        assertFalse(stockPrefetchStalled(WorkInfo.State.BLOCKED, 0))
    }
}
