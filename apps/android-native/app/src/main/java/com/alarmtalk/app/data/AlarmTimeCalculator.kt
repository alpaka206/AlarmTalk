package com.alarmtalk.app.data

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
        isHoliday: (LocalDate) -> Boolean = { LocalHolidayCalendar.isHoliday(it) },
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
            if (holidayOff && isHoliday(date)) continue

            val candidate = LocalDateTime.of(date, java.time.LocalTime.of(hour, minute))
            if (candidate.isAfter(now)) {
                return candidate.atZone(zoneId).toInstant().toEpochMilli()
            }
        }

        for (offset in 8..21) {
            val date = today.plusDays(offset.toLong())
            if (!isSelected(date, repeatDaysMask)) continue
            if (holidayOff && isHoliday(date)) continue
            return candidateMillis(date, hour, minute, zoneId)
        }

        return candidateMillis(today.plusDays(1), hour, minute, zoneId)
    }

    /**
     * **날짜 지정 알람**의 발사 시각 — [targetDate](`YYYY-MM-DD`)의 시:분을 [timezone](IANA)으로 읽은 절대 시각.
     * 지났어도 그대로 돌려준다(지났는지는 부르는 쪽이 본다). 기기 시간대와 무관하다 — 그게 이 알람의 약속이다
     * (`docs/spec/alarm-lifecycle.md` §4-2). 서머타임의 없는 시각은 `atZone` 이 앞으로 민다. 값이 깨졌으면 null.
     */
    fun datedFireAtMillis(targetDate: String?, timezone: String?, hour: Int, minute: Int): Long? {
        if (targetDate.isNullOrBlank() || hour !in 0..23 || minute !in 0..59) return null
        val date = runCatching { LocalDate.parse(targetDate) }.getOrNull() ?: return null
        val zone = timezone?.takeIf { it.isNotBlank() }
            ?.let { runCatching { ZoneId.of(it) }.getOrNull() }
            ?: return null
        return candidateMillis(date, hour, minute, zone)
    }

    /**
     * 날짜 지정을 켰을 때 처음 고를 날짜 — 지금 고른 시각이 [zoneId] 에서 아직 오지 않았으면 오늘, 지났으면 내일
     * (`docs/spec/alarm-editor.md` §2-1).
     */
    fun initialTargetDate(
        hour: Int,
        minute: Int,
        nowMillis: Long = System.currentTimeMillis(),
        zoneId: ZoneId = ZoneId.systemDefault(),
    ): LocalDate {
        val today = Instant.ofEpochMilli(nowMillis).atZone(zoneId).toLocalDate()
        return if (candidateMillis(today, hour, minute, zoneId) > nowMillis) today else today.plusDays(1)
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
