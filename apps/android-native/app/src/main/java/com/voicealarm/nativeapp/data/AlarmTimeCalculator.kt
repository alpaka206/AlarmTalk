package com.voicealarm.nativeapp.data

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

object AlarmTimeCalculator {
    fun nextFireAtMillis(
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        holidayOff: Boolean = false,
        nowMillis: Long = System.currentTimeMillis(),
        zoneId: ZoneId = ZoneId.systemDefault(),
    ): Long {
        require(hour in 0..23) { "Hour must be between 0 and 23." }
        require(minute in 0..59) { "Minute must be between 0 and 59." }
        require(repeatDaysMask in 0..0x7f) { "Repeat days mask must only use Sunday through Saturday bits." }

        val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId).toLocalDateTime()
        val today = now.toLocalDate()

        if (repeatDaysMask == 0) {
            val todayCandidate = candidateMillis(today, hour, minute, zoneId)
            return if (todayCandidate > nowMillis) {
                todayCandidate
            } else {
                candidateMillis(today.plusDays(1), hour, minute, zoneId)
            }
        }

        for (offset in 0..7) {
            val date = today.plusDays(offset.toLong())
            if (!isSelected(date, repeatDaysMask)) continue
            if (holidayOff && LocalHolidayCalendar.isHoliday(date)) continue

            val candidate = LocalDateTime.of(date, java.time.LocalTime.of(hour, minute))
            if (candidate.isAfter(now)) {
                return candidate.atZone(zoneId).toInstant().toEpochMilli()
            }
        }

        for (offset in 8..21) {
            val date = today.plusDays(offset.toLong())
            if (!isSelected(date, repeatDaysMask)) continue
            if (holidayOff && LocalHolidayCalendar.isHoliday(date)) continue
            return candidateMillis(date, hour, minute, zoneId)
        }

        return candidateMillis(today.plusDays(1), hour, minute, zoneId)
    }

    fun isSelected(date: LocalDate, repeatDaysMask: Int): Boolean {
        val dayIndex = date.dayOfWeek.value % 7
        return repeatDaysMask and (1 shl dayIndex) != 0
    }

    private fun candidateMillis(
        date: LocalDate,
        hour: Int,
        minute: Int,
        zoneId: ZoneId,
    ): Long = LocalDateTime.of(date, java.time.LocalTime.of(hour, minute))
        .atZone(zoneId)
        .toInstant()
        .toEpochMilli()
}
