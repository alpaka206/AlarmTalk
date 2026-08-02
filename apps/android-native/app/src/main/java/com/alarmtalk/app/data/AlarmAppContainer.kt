package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.observeUserId

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
                // 계정이 바뀌면 목록 필터가 즉시 다시 계산되도록 흐름으로도 넘긴다.
                currentUserIdFlow = authSessionStore(context).observeUserId(),
                // 세션이 끝날 때 소유자를 못 새겼으면 예약 직전에 이 임자로 마저 새긴다.
                // 정리가 끝나야만 표시를 지워, 실패하면 다음 기회에 다시 시도한다.
                pendingOwnerUserIdProvider = { authSessionStore(context).pendingOwnerUserId() },
                onOwnershipSettled = { authSessionStore(context).clearPendingOwner() },
                // 명시적 로그아웃으로 떼어낸 알람은 재로그인 전까지 되살리지 않는다.
                // 자동 401(세션 만료)과 구분하는 유일한 신호다.
                alarmsDetachedOnSignOutProvider = { authSessionStore(context).alarmsDetachedOnSignOut() },
            ).also { repository = it }
        }

    /** 앱 전역 공휴일 국가 설정 — 설정 화면과 알람 편집기가 공유한다. */
    fun holidayCountryPreferenceStore(context: Context): HolidayCountryPreferenceStore =
        HolidayCountryPreferenceStore(context.applicationContext)
}
