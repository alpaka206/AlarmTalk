package com.alarmtalk.app.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AlarmTalkApiClient

class DynamicVoiceRefreshWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val session = AuthSessionStore(applicationContext).read() ?: return Result.success()
        return runCatching {
            val refreshed = AlarmAppContainer.repository(applicationContext)
                .refreshDueDynamicAlarmTalks(
                    api = AlarmTalkApiClient.create(),
                    token = session.token,
                )
            Log.i(TAG, "Dynamic voice refresh worker complete refreshed=$refreshed")
            Result.success()
        }.getOrElse { error ->
            AlarmTalkLog.reportError("Dynamic voice refresh worker failed", error)
            Result.retry()
        }
    }
}
