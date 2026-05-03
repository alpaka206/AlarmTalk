package com.voicealarm.nativeapp.data

import java.time.LocalDate

object LocalHolidayCalendar {
    fun isHoliday(date: LocalDate): Boolean =
        isKoreanFixedHoliday(date)

    private fun isKoreanFixedHoliday(date: LocalDate): Boolean =
        when (date.monthValue to date.dayOfMonth) {
            1 to 1,
            3 to 1,
            5 to 5,
            6 to 6,
            8 to 15,
            10 to 3,
            10 to 9,
            12 to 25
            -> true
            else -> false
        }
}
