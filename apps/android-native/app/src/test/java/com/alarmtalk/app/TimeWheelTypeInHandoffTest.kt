package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * **시 → 분으로 옮겨 칠 때 입력이 꺼지지 않아야 한다.**
 *
 * 2026-08-15 지적: "안드로이드는 시에서 분으로 눌렀을 때 유지가 안 되고 입력이 꺼져."
 * 원인은 `onCommitEdit` 이 **무조건** `editingColumn = null` 을 넣던 것 — 분을 누르면
 * 분이 먼저 자리를 넘겨받고(`onBeginEdit`) 그 직후 시가 포커스를 잃으며 커밋으로 들어와
 * 방금 넘겨받은 자리를 도로 지웠다.
 *
 * iOS 는 같은 동작이 `TimeTypeInUITests` 로 이미 묶여 있었다 — 안드로이드가 원본인데
 * 원본 쪽에만 구멍이 있었다.
 */
class TimeWheelTypeInHandoffTest {

    /** 분이 이미 넘겨받았으면 시의 커밋은 자리를 건드리지 않는다. */
    @Test
    fun `분이 넘겨받은 뒤 시가 커밋해도 분이 남는다`() {
        val next = editingAfterCommit(current = WheelColumn.Minute, committed = WheelColumn.Hour)
        assertEquals(WheelColumn.Minute, next)
    }

    /** 순서가 반대로 와도(시가 먼저 꺼지고 분이 나중에 켜져도) 결과가 같아야 한다. */
    @Test
    fun `아직 시가 편집 중이면 시의 커밋이 입력을 닫는다`() {
        assertNull(editingAfterCommit(current = WheelColumn.Hour, committed = WheelColumn.Hour))
    }

    /** 반대 방향(분 → 시)도 대칭이다. */
    @Test
    fun `시가 넘겨받은 뒤 분이 커밋해도 시가 남는다`() {
        val next = editingAfterCommit(current = WheelColumn.Hour, committed = WheelColumn.Minute)
        assertEquals(WheelColumn.Hour, next)
    }

    /** 이미 닫힌 뒤 늦게 들어온 커밋이 입력을 되살리지 않는다. */
    @Test
    fun `이미 닫혔으면 닫힌 채로 둔다`() {
        assertNull(editingAfterCommit(current = null, committed = WheelColumn.Minute))
    }
}
