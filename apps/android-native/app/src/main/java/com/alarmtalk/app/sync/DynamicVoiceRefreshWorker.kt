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
            val repository = AlarmAppContainer.repository(applicationContext)
            val api = AlarmTalkApiClient.create()
            // 사전렌더 '날씨' 버킷 알람의 조건 인덱스 갱신(오프라인 날씨 매칭).
            val weatherVariants = repository.resolveDueCloneBucketVariants(api = api, token = session.token)
            Log.i(TAG, "Voice refresh worker complete weatherVariants=$weatherVariants")
            Result.success()
        }.getOrElse { error ->
            AlarmTalkLog.reportError("Dynamic voice refresh worker failed", error)
            Result.retry()
        }
    }
}
