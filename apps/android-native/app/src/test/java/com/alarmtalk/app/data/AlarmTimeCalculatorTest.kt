package com.alarmtalk.app.data

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class AlarmTimeCalculatorTest {
    private val zoneId: ZoneId = ZoneId.of("UTC")

    @Test
    fun oneShotUsesTodayWhenTargetTimeIsStillFuture() {
        val now = millis("2026-05-03T08:00:00")

        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = 8,
            minute = 30,
            repeatDaysMask = 0,
            nowMillis = now,
            zoneId = zoneId,
        )

        assertEquals(millis("2026-05-03T08:30:00"), nextFireAt)
    }

    @Test
    fun oneShotRollsToTomorrowWhenTargetTimeAlreadyPassed() {
        val now = millis("2026-05-03T08:31:00")

        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = 8,
            minute = 30,
            repeatDaysMask = 0,
            nowMillis = now,
            zoneId = zoneId,
        )

        assertEquals(millis("2026-05-04T08:30:00"), nextFireAt)
    }

    @Test
    fun repeatUsesNextSelectedDay() {
        val now = millis("2026-05-03T10:00:00")
        val mondayMask = 1 shl 1

        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = 7,
            minute = 15,
            repeatDaysMask = mondayMask,
            nowMillis = now,
            zoneId = zoneId,
        )

        assertEquals(millis("2026-05-04T07:15:00"), nextFireAt)
    }

    @Test
    fun repeatSkipsSelectedTodayWhenTimeAlreadyPassed() {
        val now = millis("2026-05-04T08:00:00")
        val mondayMask = 1 shl 1

        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = 7,
            minute = 0,
            repeatDaysMask = mondayMask,
            nowMillis = now,
            zoneId = zoneId,
        )

        assertEquals(millis("2026-05-11T07:00:00"), nextFireAt)
    }

    @Test
    fun holidayOffSkipsKnownSubstituteHolidayForRepeatAlarm() {
        val now = millis("2026-02-28T08:00:00")
        val mondayMask = 1 shl 1
        val holidays = setOf(LocalDate.of(2026, 3, 2))

        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = 7,
            minute = 0,
            repeatDaysMask = mondayMask,
            holidayOff = true,
            nowMillis = now,
            zoneId = zoneId,
            isHoliday = { it in holidays },
        )

        assertEquals(millis("2026-03-09T07:00:00"), nextFireAt)
    }

    @Test
    fun holidayOffSkipsKnownElectionHolidayForRepeatAlarm() {
        val now = millis("2026-06-01T08:00:00")
        val wednesdayMask = 1 shl 3
        val holidays = setOf(LocalDate.of(2026, 6, 3))

        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = 7,
            minute = 0,
            repeatDaysMask = wednesdayMask,
            holidayOff = true,
            nowMillis = now,
            zoneId = zoneId,
            isHoliday = { it in holidays },
        )

        assertEquals(millis("2026-06-10T07:00:00"), nextFireAt)
    }

    @Test
    fun holidayOffDoesNotChangeOneShotAlarm() {
        val now = millis("2026-05-05T06:00:00")

        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = 7,
            minute = 0,
            repeatDaysMask = 0,
            holidayOff = true,
            nowMillis = now,
            zoneId = zoneId,
        )

        assertEquals(millis("2026-05-05T07:00:00"), nextFireAt)
    }

    @Test
    fun dayBitsMapSundayToZeroAndSaturdayToSix() {
        val sunday = LocalDate.of(2026, 5, 3)
        val saturday = LocalDate.of(2026, 5, 9)

        assertEquals(true, AlarmTimeCalculator.isSelected(sunday, 1 shl 0))
        assertEquals(true, AlarmTimeCalculator.isSelected(saturday, 1 shl 6))
    }

    @Test(expected = IllegalArgumentException::class)
    fun repeatMaskRejectsUnknownBits() {
        AlarmTimeCalculator.nextFireAtMillis(
            hour = 7,
            minute = 0,
            repeatDaysMask = 1 shl 7,
            nowMillis = millis("2026-05-03T08:00:00"),
            zoneId = zoneId,
        )
    }

    /** 날짜 알람은 고른 시간대의 그 시각에 고정된다 — 기기 시간대와 무관하다(alarm-lifecycle.md §4-2). */
    @Test
    fun datedFireTimeIsFixedInTheConfirmedTimezone() {
        val seoulSevenAm = java.time.ZonedDateTime.of(2026, 10, 27, 7, 0, 0, 0, ZoneId.of("Asia/Seoul"))
            .toInstant().toEpochMilli()

        assertEquals(seoulSevenAm, AlarmTimeCalculator.datedFireAtMillis("2026-10-27", "Asia/Seoul", 7, 0))
        // 같은 날짜·시각이라도 시간대가 다르면 다른 절대 시각이다(10월 27일 런던은 서머타임이 끝나 UTC+0).
        assertEquals(
            seoulSevenAm + 9 * 3_600_000L,
            AlarmTimeCalculator.datedFireAtMillis("2026-10-27", "Europe/London", 7, 0),
        )
    }

    @Test
    fun datedFireTimeRejectsBrokenValues() {
        assertEquals(null, AlarmTimeCalculator.datedFireAtMillis(null, "Asia/Seoul", 7, 0))
        assertEquals(null, AlarmTimeCalculator.datedFireAtMillis("2026-02-30", "Asia/Seoul", 7, 0))
        assertEquals(null, AlarmTimeCalculator.datedFireAtMillis("2026-10-27", "Mars/Olympus", 7, 0))
        assertEquals(null, AlarmTimeCalculator.datedFireAtMillis("2026-10-27", null, 7, 0))
    }

    /** 날짜 지정을 켰을 때의 첫 날짜 — 그 시각이 아직이면 오늘, 지났으면 내일(alarm-editor.md §2-1). */
    @Test
    fun initialTargetDateIsTodayOrTomorrow() {
        assertEquals(
            LocalDate.of(2026, 5, 3),
            AlarmTimeCalculator.initialTargetDate(8, 30, millis("2026-05-03T08:00:00"), zoneId),
        )
        assertEquals(
            LocalDate.of(2026, 5, 4),
            AlarmTimeCalculator.initialTargetDate(8, 30, millis("2026-05-03T08:30:00"), zoneId),
        )
    }

    private fun millis(value: String): Long = LocalDateTime.parse(value)
        .atZone(zoneId)
        .toInstant()
        .toEpochMilli()
}
