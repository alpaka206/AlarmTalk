package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.observeUserId

object AlarmAppContainer {
    /**
     * **화면보다 오래 사는 작업용 스코프.**
     *
     * ⚠ 울림 화면의 ＋/− 저장이 여기 붙는다(코덱스 #729 3차). 콤포지션 스코프에 붙이면
     * 값을 바꾸자마자 끄거나 나갈 때 **Room 커밋 전에 취소돼** 고른 간격이 사라진다.
     * 단일 스레드라 연타해도 순서가 뒤집히지 않는다.
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val appScope: kotlinx.coroutines.CoroutineScope by lazy {
        kotlinx.coroutines.CoroutineScope(
            kotlinx.coroutines.SupervisorJob() +
                kotlinx.coroutines.Dispatchers.IO.limitedParallelism(1),
        )
    }

    @Volatile
    private var repository: AlarmRepository? = null
    @Volatile
    private var authSessionStore: AuthSessionStore? = null
    @Volatile
    private var usageEventRecorder: UsageEventRecorder? = null

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
                // 비로그인 상태에서 되살려도 되는 알람의 주인. 자동 401 로 끊긴 계정만 담기고,
                // 명시적 로그아웃은 이 값을 지워 그 계정 알람이 되살아나지 않게 한다.
                sessionExpiredOwnerUserIdProvider = { authSessionStore(context).sessionExpiredOwnerUserId() },
                // 로그아웃 때 끄기가 실패한 알람. 프로세스가 죽어도 남아 다음 기회에 마저 끈다.
                pendingDisableAlarmIdsProvider = { authSessionStore(context).pendingDisableAlarmIds() },
                onPendingDisableAdded = { ids -> authSessionStore(context).addPendingDisableAlarmIds(ids) },
                onPendingDisableCleared = { ids -> authSessionStore(context).clearPendingDisableAlarmIds(ids) },
                // 사용 기록 — 만들고 고치고 지운 사건을 로컬 큐에 적는다(전송은 워커가).
                usageEvents = usageEventRecorder(context),
            ).also { repository = it }
        }

    /** Room 인스턴스 — 사용 기록 큐처럼 저장소를 직접 쓰는 곳이 쓴다. */
    fun database(context: Context): AlarmDatabase = AlarmDatabase.getInstance(context)

    /**
     * 사용 기록 기록기. **전역 하나**다 — 여러 개면 큐 상한 정리가 서로를 덮어쓴다.
     *
     * ⚠ 여기서 만들 때 `currentUserId` 를 넘기는 이유: 이벤트는 **그때의 계정**에 속한다.
     * 계정이 바뀌면 남은 큐를 새 주인 이름으로 보내면 안 된다(업로드 워커가 그걸 본다).
     */
    fun usageEventRecorder(context: Context): UsageEventRecorder =
        usageEventRecorder ?: synchronized(this) {
            usageEventRecorder ?: UsageEventRecorder(
                dao = database(context).usageEventDao(),
                currentUserId = { authSessionStore(context).read()?.user?.id },
            ).also { usageEventRecorder = it }
        }

    /** 앱 전역 공휴일 국가 설정 — 설정 화면과 알람 편집기가 공유한다. */
    fun holidayCountryPreferenceStore(context: Context): HolidayCountryPreferenceStore =
        HolidayCountryPreferenceStore(context.applicationContext)
}
