package com.alarmtalk.app.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object DynamicVoiceRefreshScheduler {
    private const val PERIODIC_WORK_NAME = "dynamic_voice_refresh_periodic"
    private const val ONE_TIME_WORK_NAME = "dynamic_voice_refresh_once"
    private const val RETRY_WORK_NAME = "dynamic_voice_refresh_retry"

    /** 평시 갱신 시각(로컬 22시) — 다음 날 아침 알람의 조건을 전날 밤에 확정한다. */
    private const val REFRESH_HOUR_OF_DAY = 22

    private val networkConstraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /**
     * 평시 갱신은 하루 한 번, 로컬 22시. 예전에는 1시간마다 돌면서 내부 12h 게이트로 걸렀는데,
     * 하루 24번 깨워 배터리·쿼터만 쓰고 실제 갱신은 한두 번이었다. 못 받은 경우는
     * [scheduleRetryUntilFire] 가 알람 시각 전까지 1시간마다 따로 재시도한다.
     */
    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<DynamicVoiceRefreshWorker>(
            1,
            TimeUnit.DAYS,
        )
            .setConstraints(networkConstraints)
            .setInitialDelay(millisUntilNextRefreshHour(), TimeUnit.MILLISECONDS)
            .build()

        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            // KEEP 이면 예전 1시간 주기 작업이 그대로 살아남는다 — 주기가 바뀌었으므로 교체한다.
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    /**
     * 조건을 아직 못 받은 알람이 남아 있을 때 1시간 뒤 한 번 더 시도한다. 워커가 끝날 때마다
     * 남은 게 있으면 다시 걸어, 알람이 울릴 때까지(또는 다 받을 때까지) 이어진다.
     * 오프라인이면 네트워크 제약 때문에 대기하다가 연결되는 순간 실행된다.
     */
    fun scheduleRetryUntilFire(context: Context) {
        val request = OneTimeWorkRequestBuilder<DynamicVoiceRefreshWorker>()
            .setConstraints(networkConstraints)
            .setInitialDelay(1, TimeUnit.HOURS)
            .build()

        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            RETRY_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    private fun millisUntilNextRefreshHour(): Long {
        val zone = java.time.ZoneId.systemDefault()
        val now = java.time.ZonedDateTime.now(zone)
        var next = now.withHour(REFRESH_HOUR_OF_DAY).withMinute(0).withSecond(0).withNano(0)
        if (!next.isAfter(now)) next = next.plusDays(1)
        return java.time.Duration.between(now, next).toMillis()
    }

    fun runOnce(context: Context) {
        val request = OneTimeWorkRequestBuilder<DynamicVoiceRefreshWorker>()
            .setConstraints(networkConstraints)
            .build()

        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            ONE_TIME_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
