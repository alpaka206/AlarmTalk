package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.AuthSessionStore

object AlarmAppContainer {
    @Volatile
    private var repository: AlarmRepository? = null
    @Volatile
    private var authSessionStore: AuthSessionStore? = null

    private fun authSessionStore(context: Context): AuthSessionStore =
        authSessionStore ?: synchronized(this) {
            authSessionStore ?: AuthSessionStore(context.applicationContext).also { authSessionStore = it }
        }

    fun repository(context: Context): AlarmRepository =
        repository ?: synchronized(this) {
            repository ?: AlarmRepository(
                alarmDao = AlarmDatabase.getInstance(context).alarmDao(),
                holidayCalendarStore = HolidayCalendarStore(AlarmDatabase.getInstance(context).holidayDao()),
                holidayCountryPreferenceStore = holidayCountryPreferenceStore(context),
                alarmScheduler = AlarmScheduler(context.applicationContext),
                alarmAudioStore = AlarmAudioStore(context.applicationContext),
                context = context.applicationContext,
                // 알람 생성 시 소유자 기록·무료 잠금 스코프용 현재 로그인 계정 id.
                currentUserIdProvider = { authSessionStore(context).read()?.user?.id },
            ).also { repository = it }
        }

    /** 앱 전역 공휴일 국가 설정 — 설정 화면과 알람 편집기가 공유한다. */
    fun holidayCountryPreferenceStore(context: Context): HolidayCountryPreferenceStore =
        HolidayCountryPreferenceStore(context.applicationContext)
}
