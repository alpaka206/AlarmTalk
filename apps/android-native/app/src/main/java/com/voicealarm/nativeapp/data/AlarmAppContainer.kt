package com.voicealarm.nativeapp.data

import android.content.Context
import com.voicealarm.nativeapp.alarm.AlarmScheduler

object AlarmAppContainer {
    @Volatile
    private var repository: AlarmRepository? = null

    fun repository(context: Context): AlarmRepository =
        repository ?: synchronized(this) {
            repository ?: AlarmRepository(
                alarmDao = AlarmDatabase.getInstance(context).alarmDao(),
                characterEventDao = AlarmDatabase.getInstance(context).characterEventDao(),
                holidayCalendarStore = HolidayCalendarStore(AlarmDatabase.getInstance(context).holidayDao()),
                alarmScheduler = AlarmScheduler(context.applicationContext),
                alarmAudioStore = AlarmAudioStore(context.applicationContext),
                context = context.applicationContext,
            ).also { repository = it }
        }
}
