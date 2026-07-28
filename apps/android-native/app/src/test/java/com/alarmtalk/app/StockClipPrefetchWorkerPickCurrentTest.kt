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
    fun 모두_끝났고_성공이_있으면_성공을_고른다() {
        // 한 번이라도 받아냈으면 화면을 닫아야 한다 — 뒤에 실패가 붙어 있어도 마찬가지.
        assertEquals(
            "ok",
            pick(Item("old", WorkInfo.State.FAILED), Item("ok", WorkInfo.State.SUCCEEDED)),
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
