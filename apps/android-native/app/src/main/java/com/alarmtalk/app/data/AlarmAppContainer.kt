package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.alarm.AlarmScheduler

object AlarmAppContainer {
    @Volatile
    private var repository: AlarmRepository? = null

    fun repository(context: Context): AlarmRepository =
        repository ?: synchronized(this) {
            repository ?: AlarmRepository(
                alarmDao = AlarmDatabase.getInstance(context).alarmDao(),
                holidayCalendarStore = HolidayCalendarStore(AlarmDatabase.getInstance(context).holidayDao()),
                holidayCountryPreferenceStore = holidayCountryPreferenceStore(context),
                alarmScheduler = AlarmScheduler(context.applicationContext),
                alarmAudioStore = AlarmAudioStore(context.applicationContext),
                context = context.applicationContext,
            ).also { repository = it }
        }

    /** 앱 전역 공휴일 국가 설정 — 설정 화면과 알람 편집기가 공유한다. */
    fun holidayCountryPreferenceStore(context: Context): HolidayCountryPreferenceStore =
        HolidayCountryPreferenceStore(context.applicationContext)
}
