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

    private val networkConstraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<DynamicVoiceRefreshWorker>(
            1,
            TimeUnit.HOURS,
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
