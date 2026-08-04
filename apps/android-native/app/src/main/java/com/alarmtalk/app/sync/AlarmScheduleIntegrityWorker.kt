package com.alarmtalk.app.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import java.util.concurrent.TimeUnit

/**
 * OS 알람 예약이 실제로 살아 있는지 주기적으로 다시 새기는 안전망.
 *
 * **왜 필요한가.** 스토어 업데이트는 AlarmManager 등록을 전부 지운다. 복구는
 * `ACTION_MY_PACKAGE_REPLACED` → [com.alarmtalk.app.alarm.BootCompletedReceiver] 한 경로에만
 * 걸려 있는데, 그 경로는 두 가지로 샌다:
 *  - 브로드캐스트가 아예 안 오는 경우(제조사 절전 정책, 강제 종료 상태 등)
 *  - 리시버의 `goAsync()` 창(약 10초)을 넘겨 재예약이 중간에 잘리는 경우
 * 둘 다 사용자에게는 똑같이 "업데이트하고 나니 알람이 안 울린다" 로 보이고, **앱을 열기
 * 전까지 스스로 복구되지 않는다.** 알람 앱에서 그건 치명적이다 — 앱을 안 여는 게 정상이니까.
 *
 * **왜 별도 워커인가.** [RemoteAlarmSyncScheduler] 의 주기 워커에 얹을 수도 있었지만 그쪽은
 * `NetworkType.CONNECTED` 제약이 걸려 있다. **알람이 울리는 일이 네트워크에 묶여선 안 된다** —
 * 비행기 모드로 자는 사람의 알람이 안 울리면 안 되므로 제약 없이 따로 돈다.
 *
 * 하는 일은 [com.alarmtalk.app.data.AlarmRepository.reschedulePendingAlarms] 호출 하나다.
 * 이미 예약된 알람에 다시 걸면 같은 PendingIntent 를 갱신할 뿐이다.
 *
 * **다만 멱등이 아니다** — 발화 시각이 이미 지난 행은 다음 발생으로 재계산돼 새 시각으로
 * 등록된다. 정확 알람을 못 쓰는 기기(API 31·32 + SCHEDULE_EXACT_ALARM 회수)에서는 배달이
 * 늦어질 수 있고, 그 사이 이 워커가 돌면 **아직 배달을 기다리던 등록을 덮는다.** 자세한
 * 내용과 두 번의 실패한 시도는 `AlarmRepository.reschedulePendingAlarms` 의 '알려진 한계'
 * 주석에 있다. 이 파일만 읽고 "재예약은 무해하다" 고 결론 내리지 말 것.
 */
class AlarmScheduleIntegrityWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = runCatching {
        val scheduled = AlarmAppContainer.repository(applicationContext).reschedulePendingAlarms()
        Log.i(TAG, "Alarm schedule integrity check complete scheduled=$scheduled")
        Result.success()
    }.getOrElse { error ->
        AlarmTalkLog.reportError("Alarm schedule integrity check failed", error)
        Result.retry()
    }
}

object AlarmScheduleIntegrityScheduler {
    private const val PERIODIC_WORK_NAME = "alarm_schedule_integrity_periodic"
    private const val ONE_TIME_WORK_NAME = "alarm_schedule_integrity_now"

    /**
     * WorkManager 주기 작업의 **최소 간격인 15분**으로 잡는다.
     *
     * 처음에는 6시간으로 뒀는데 틀렸다. `KEEP` 은 이미 등록된 주기의 리듬을 그대로 두므로,
     * 06:30 에 브로드캐스트를 놓친 기기에서 다음 점검이 몇 시간 뒤일 수 있다 — 07:00 알람은
     * 이미 지난 뒤다. "밤 사이 업데이트돼도 아침 전에 한 번은 돈다" 는 보장이 성립하지 않는다.
     * 알람 앱에서 복구가 늦는 건 복구가 없는 것과 크게 다르지 않다(Codex #666 P1).
     *
     * 15분은 기존 [RemoteAlarmSyncScheduler] 와 같은 리듬이라 새로운 부담이 아니고, 하는 일도
     * 로컬 DB 읽기 + 이미 걸린 예약 갱신뿐이라 가볍다(비용 얘기다 — 위 KDoc 의 '멱등이 아니다'
     * 참고).
     *
     * **제약을 걸지 않는다.** 네트워크·충전·유휴 어느 것도 알람이 울리는 조건이 아니다.
     */
    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<AlarmScheduleIntegrityWorker>(15, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    /**
     * 지금 한 번 돈다. 업데이트·부팅 리시버가 `goAsync()` 창을 넘겨 잘리더라도 이 워커가
     * 재예약을 마저 끝낸다 — 리시버와 중복 실행돼도 멱등이라 문제되지 않는다.
     *
     * `REPLACE` 는 이미 대기 중인 같은 작업을 최신 요청으로 교체할 뿐이라, 연달아 온
     * 브로드캐스트가 작업을 쌓지 않는다.
     */
    fun runOnce(context: Context) {
        val request = OneTimeWorkRequestBuilder<AlarmScheduleIntegrityWorker>().build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            ONE_TIME_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
