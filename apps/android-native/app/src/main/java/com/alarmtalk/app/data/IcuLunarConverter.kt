package com.alarmtalk.app.data

import android.icu.util.Calendar
import android.icu.util.ULocale
import android.icu.util.TimeZone as IcuTimeZone
import java.time.LocalDate

object IcuLunarConverter : LunarConverter {
    private const val DANGI_EPOCH_OFFSET = 2333
    private const val DAY_MS = 24L * 60L * 60L * 1000L
    private const val KST_OFFSET_MS = 9L * 60L * 60L * 1000L
    private val koreanTimeZone: IcuTimeZone by lazy { IcuTimeZone.getTimeZone("Asia/Seoul") }
    private val koreanLunarLocale: ULocale by lazy { ULocale("ko_KR@calendar=dangi") }

    override fun lunarToGregorian(
        gregorianYear: Int,
        lunarMonth: Int,
        lunarDayOneBased: Int,
        leap: Boolean,
    ): LocalDate? {
        for (candidateYear in intArrayOf(gregorianYear, gregorianYear - 1, gregorianYear + 1)) {
            val calendar = Calendar.getInstance(koreanTimeZone, koreanLunarLocale).apply {
                clear()
                set(Calendar.EXTENDED_YEAR, candidateYear + DANGI_EPOCH_OFFSET)
                set(Calendar.MONTH, lunarMonth - 1)
                set(Calendar.IS_LEAP_MONTH, if (leap) 1 else 0)
                set(Calendar.DAY_OF_MONTH, lunarDayOneBased)
            }
            val date = LocalDate.ofEpochDay(Math.floorDiv(calendar.timeInMillis + KST_OFFSET_MS, DAY_MS))
            if (date.year == gregorianYear) return date
        }
        return null
    }
}
