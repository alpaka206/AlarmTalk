package com.alarmtalk.app

import androidx.work.WorkInfo
import com.alarmtalk.app.sync.StockClipPrefetchWorker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 유니크 작업 이력에서 '지금 화면이 봐야 할' 항목을 고르는 규칙 회귀 가드.
 *
 * getWorkInfosForUniqueWorkFlow 는 이력을 통째로 준다. 실패 후 재시도를 걸면 끝난 옛
 * 항목과 새 항목이 같이 들어오는데, 그냥 first 를 잡으면 재시도가 도는 중에도 화면이
 * 실패 상태에 머물고(= 사용자는 계속 '다시 시도'를 누르는데 KEEP 정책이라 아무 일도
 * 안 일어난다) 만다.
 */
class StockClipPrefetchWorkerPickCurrentTest {

    private data class Item(val name: String, val state: WorkInfo.State)

    private fun pick(vararg items: Item): String? =
        StockClipPrefetchWorker.pickCurrent(items.toList()) { it.state }?.name

    @Test
    fun 재시도가_도는_중이면_끝난_실패보다_진행중을_고른다() {
        assertEquals(
            "retry",
            pick(Item("old", WorkInfo.State.FAILED), Item("retry", WorkInfo.State.ENQUEUED)),
        )
        assertEquals(
            "retry",
            pick(Item("old", WorkInfo.State.FAILED), Item("retry", WorkInfo.State.RUNNING)),
        )
    }

    @Test
    fun 이력_순서가_뒤집혀_와도_진행중을_고른다() {
        assertEquals(
            "retry",
            pick(Item("retry", WorkInfo.State.RUNNING), Item("old", WorkInfo.State.FAILED)),
        )
    }

    @Test
    fun 모두_끝났으면_가장_최근_결과를_고른다() {
        // 옛 실패 뒤에 성공이 붙었으면 성공이 지금 상태다.
        assertEquals(
            "ok",
            pick(Item("old", WorkInfo.State.FAILED), Item("ok", WorkInfo.State.SUCCEEDED)),
        )
        // ⚠ 반대도 같다 — **옛 성공이 새 실패를 가리면 안 된다**(2026-09-01 리뷰).
        // 매니페스트가 바뀌어 영구 실패가 생기면 준비 화면이 '다시 시도' 를 띄워야 한다.
        assertEquals(
            "broken",
            pick(Item("ok", WorkInfo.State.SUCCEEDED), Item("broken", WorkInfo.State.FAILED)),
        )
    }

    @Test
    fun 전부_실패면_마지막_실패를_고른다() {
        // 이때만 '다시 시도'가 뜬다.
        assertEquals(
            "second",
            pick(Item("first", WorkInfo.State.FAILED), Item("second", WorkInfo.State.FAILED)),
        )
    }

    @Test
    fun 이력이_비면_null() {
        assertNull(pick())
    }
}
