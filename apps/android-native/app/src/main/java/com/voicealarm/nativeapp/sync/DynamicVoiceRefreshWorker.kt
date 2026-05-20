package com.voicealarm.nativeapp.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.network.AuthSessionStore
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient

class DynamicVoiceRefreshWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val session = AuthSessionStore(applicationContext).read() ?: return Result.success()
        return runCatching {
            val refreshed = AlarmAppContainer.repository(applicationContext)
                .refreshDueDynamicVoiceAlarms(
                    api = VoiceAlarmApiClient.create(),
                    token = session.token,
                )
            Log.i(TAG, "Dynamic voice refresh worker complete refreshed=$refreshed")
            Result.success()
        }.getOrElse { error ->
            Log.e(TAG, "Dynamic voice refresh worker failed", error)
            Result.retry()
        }
    }
}
