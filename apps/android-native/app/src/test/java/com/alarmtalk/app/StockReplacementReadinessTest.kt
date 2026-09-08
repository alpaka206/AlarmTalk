package com.alarmtalk.app

import com.alarmtalk.app.sync.StockReplacementStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * **판정을 못 한 회차도 준비 신호는 세운다** 회귀 가드.
 *
 * 1회성 오버레이(웰컴 프로모·첫 권한 안내)는 `checkedUserId` 를 기다린다
 * (`ui/app/AlarmTalkApp.kt` 의 두 `LaunchedEffect`). 그런데 그 신호를 세우는 곳은
 * `StockClipPrefetchWorker` **하나뿐**이다 — 매니페스트를 받는 다른 두 곳
 * (`loadStockClips`·`VoiceAccessSyncWorker`)에는 `report` 가 없고, 그쪽이 같이 건
 * 프리페치 `enqueue` 는 워커가 아직 돌고 있어 `KEEP` 에 버려진다.
 * 그래서 조회 실패·SUPERSEDED 처럼 **끝났는데 판정을 못 한** 회차가 조용히 넘어가면
 * 그 세션 내내 오버레이가 안 뜬다.
 * 규약: `docs/spec/gates-and-overlays.md` 「준비 신호는 성공·실패 모두 true」.
 *
 * 짝 규칙은 **근거 없는 회차가 문을 열어서도 안 된다**는 것이다 — 그래서 준비 신호만
 * 세우고 앞 판정은 건드리지 않는다(`manifestFetched = false`).
 */
class StockReplacementReadinessTest {

    /** `object` 라 테스트끼리 상태를 나눠 쓴다 — 공개 API 로만 되돌린다. */
    @Before
    fun reset() {
        StockReplacementStatus.report(userId = null, pending = false, manifestFetched = true)
    }

    @Test
    fun 판정을_못_해도_준비_신호는_선다() {
        StockReplacementStatus.report(userId = "u1", pending = false, manifestFetched = false)

        assertEquals("u1", StockReplacementStatus.checkedUserId.value)
        assertNull(StockReplacementStatus.pendingUserId.value)
    }

    @Test
    fun 판정을_못_한_회차는_앞_판정을_뒤집지_않는다() {
        StockReplacementStatus.report(userId = "u1", pending = true, manifestFetched = true)
        assertEquals("u1", StockReplacementStatus.pendingUserId.value)

        // 조회 실패·SUPERSEDED 갈래 — 준비 신호는 서지만 **문은 열리지 않는다.**
        StockReplacementStatus.report(userId = "u1", pending = false, manifestFetched = false)

        assertEquals("u1", StockReplacementStatus.pendingUserId.value)
        assertEquals("u1", StockReplacementStatus.checkedUserId.value)
    }
}
