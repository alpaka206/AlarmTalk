package com.alarmtalk.app.sync

import android.content.Context
import android.os.SystemClock
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object RemoteAlarmSyncScheduler {
    private const val PERIODIC_WORK_NAME = "remote_alarm_periodic_sync"
    private const val ONE_TIME_WORK_NAME = "remote_alarm_immediate_sync"

    private val networkConstraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<RemoteAlarmSyncWorker>(
            15,
            TimeUnit.MINUTES,
        )
            .setConstraints(networkConstraints)
            .build()

        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    fun runOnce(context: Context) {
        val request = OneTimeWorkRequestBuilder<RemoteAlarmSyncWorker>()
            .setConstraints(networkConstraints)
            .build()

        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            ONE_TIME_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    // 앱이 포그라운드로 복귀할 때마다 호출되는 즉시 pull. 짧은 시간 연속 복귀(탭 전환 등)로 인한 중복
    // 실행을 minIntervalMs throttle 로 막는다. 첫 호출은 항상 실행(=null). elapsedRealtime 은 부팅 후
    // 경과라 초기 0 비교 이슈를 피하려 nullable 로 둔다.
    @Volatile
    private var lastForegroundRunAtMs: Long? = null

    fun runOnceThrottled(context: Context, minIntervalMs: Long = 60_000L) {
        val now = SystemClock.elapsedRealtime()
        val last = lastForegroundRunAtMs
        if (last != null && now - last < minIntervalMs) return
        lastForegroundRunAtMs = now
        runOnce(context)
    }
}
