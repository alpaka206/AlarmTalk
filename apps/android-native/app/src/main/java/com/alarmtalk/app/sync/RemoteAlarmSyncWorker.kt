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

class RemoteAlarmSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val session = AuthSessionStore(applicationContext).read() ?: return Result.success()
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val result = AlarmAppContainer.repository(applicationContext)
                .pullReceivedAlarms(api, session.token)
            Log.i(
                TAG,
                "Remote alarm worker complete total=${result.total} imported=${result.imported} updated=${result.updated} failed=${result.failed}",
            )
            if (result.failed > 0 && result.imported == 0 && result.updated == 0) {
                Result.retry()
            } else {
                Result.success()
            }
        }.getOrElse { error ->
            AlarmTalkLog.reportError("Remote alarm worker failed", error)
            Result.retry()
        }
    }
}
