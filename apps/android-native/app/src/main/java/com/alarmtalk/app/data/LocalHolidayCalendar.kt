package com.alarmtalk.app.data

import java.time.LocalDate

object LocalHolidayCalendar {
    fun isHoliday(date: LocalDate): Boolean =
        isHoliday(countryCode = HolidayCalendarStore.DEFAULT_COUNTRY_CODE, date = date)

    fun isHoliday(countryCode: String, date: LocalDate): Boolean =
        when (countryCode.uppercase()) {
            "KR" -> isKoreanFixedHoliday(date) || isKoreanObservedFixedHoliday(date)
            else -> false
        }

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

    private fun isKoreanObservedFixedHoliday(date: LocalDate): Boolean {
        if (date.dayOfWeek.value != 1) return false
        return isSubstituteEligibleFixedHoliday(date.minusDays(1)) ||
            isSubstituteEligibleFixedHoliday(date.minusDays(2))
    }

    private fun isSubstituteEligibleFixedHoliday(date: LocalDate): Boolean =
        when (date.monthValue to date.dayOfMonth) {
            3 to 1,
            5 to 5,
            8 to 15,
            10 to 3,
            10 to 9,
            12 to 25
            -> true
            else -> false
        }
}
