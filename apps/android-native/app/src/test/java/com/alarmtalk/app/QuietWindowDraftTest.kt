package com.alarmtalk.app

import com.alarmtalk.app.network.FamilyAlarmQuietWindow
import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 방해금지 구간 초안 ↔ 서버 값 왕복.
 *
 * 초안이 시·분 문자열 넷에서 [LocalTime] 둘로 바뀌었다 — 서버로 나가는 "HH:mm" 과, 비정형 값을
 * 시·분 **따로** 9시·0분으로 채우던 옛 규칙(`splitTime`)이 그대로인지 고정한다.
 */
class QuietWindowDraftTest {

    @Test
    fun roundTripsServerTimeAsTwoDigitHourMinute() {
        val window = FamilyAlarmQuietWindow(days = listOf(5, 1, 3), start = "22:00", end = "07:05")
        val draft = window.toDraft()
        assertEquals(LocalTime.of(22, 0), draft.start)
        assertEquals(LocalTime.of(7, 5), draft.end)
        assertEquals(FamilyAlarmQuietWindow(days = listOf(1, 3, 5), start = "22:00", end = "07:05"), draft.toWindow())
    }

    @Test
    fun fillsInvalidHourAndMinuteIndependently() {
        // 시가 범위 밖이면 시만 9 로, 분이 범위 밖이면 분만 0 으로 — 나머지는 살린다.
        assertEquals(LocalTime.of(9, 30), quietTimeOrDefault("25:30"))
        assertEquals(LocalTime.of(18, 0), quietTimeOrDefault("18:60"))
        assertEquals(LocalTime.of(9, 0), quietTimeOrDefault("abc"))
        assertEquals(LocalTime.of(9, 0), quietTimeOrDefault(""))
        // 한 자리 시·분도 두 자리로 나간다.
        assertEquals("07:05", FamilyAlarmQuietWindow(start = "7:5", end = "23:59").toDraft().toWindow().start)
    }

    @Test
    fun emptyOrOutOfRangeDaysFallBackToWeekdays() {
        val draft = FamilyAlarmQuietWindow(days = listOf(7, -1)).toDraft()
        assertEquals(setOf(1, 2, 3, 4, 5), draft.days)
        assertTrue(draft.isValid())
        assertFalse(draft.copy(days = emptySet()).isValid())
    }
}
