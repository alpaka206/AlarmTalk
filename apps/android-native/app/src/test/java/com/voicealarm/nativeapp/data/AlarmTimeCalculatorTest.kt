package com.voicealarm.nativeapp.data

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

    private fun millis(value: String): Long = LocalDateTime.parse(value)
        .atZone(zoneId)
        .toInstant()
        .toEpochMilli()
}
