package com.alarmtalk.app

import com.alarmtalk.app.alarm.VisibleActivityCounter
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 울림 알림의 갈래("앱에 보이는 액티비티가 있는가")가 읽는 카운터.
 *
 * `ProcessLifecycleOwner` 대신 이걸 쓰는 이유는 지연이 없어야 해서다 — 알람 직전 700ms 안에
 * 홈·전원을 누른 경우를 '보인다' 로 읽으면 QUIET(전체화면 인텐트 없음)를 고르고, Android 14+ 가
 * `startActivity` 를 막아 잠금 화면에서 소리만 난다(코덱스 리뷰, 2026-09-22).
 */
class VisibleActivityCounterTest {
    @Test
    fun startedThenStoppedIsNotVisible_immediately() {
        val c = VisibleActivityCounter()
        val a = Any()
        assertFalse(c.hasVisible)
        c.started(a)
        assertTrue(c.hasVisible)
        c.stopped(a)
        assertFalse("멈춘 순간 바로 '안 보임' 이어야 한다 — 지연이 있으면 잘못된 갈래를 고른다", c.hasVisible)
    }

    @Test
    fun twoActivitiesOverlap_stillVisibleUntilBothStop() {
        val c = VisibleActivityCounter()
        val a = Any()
        val b = Any()
        c.started(a)
        c.started(b) // 화면 전환: 새 액티비티가 먼저 start, 옛 액티비티가 뒤에 stop
        c.stopped(a)
        assertTrue(c.hasVisible)
        c.stopped(b)
        assertFalse(c.hasVisible)
    }

    @Test
    fun duplicateStartAndUnknownStopDoNotCorruptTheCount() {
        val c = VisibleActivityCounter()
        val a = Any()
        c.started(a)
        c.started(a) // 같은 인스턴스를 두 번 세지 않는다
        c.stopped(Any()) // 모르는 인스턴스의 stop 은 무시
        assertTrue(c.hasVisible)
        c.stopped(a)
        assertFalse(c.hasVisible)
    }
}
