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
            // 갱신을 시도했는데도 못 받은 게 남아 있으면 1시간 뒤 다시 시도한다. 평시 갱신은
            // 하루 한 번(22시)이라, 그때 실패한 건(오프라인 등) 이 재시도가 알람 전까지 메운다.
            // 방금 성공한 알람은 대상이 아니다 — 그러면 알람이 울릴 때까지 매시간 재시도가
            // 이어져, 없애려던 시간당 폴링이 그대로 돌아온다.
            val pending = repository.hasFailedWeatherRefresh()
            if (pending) DynamicVoiceRefreshScheduler.scheduleRetryUntilFire(applicationContext)
            Log.i(TAG, "Voice refresh worker complete weatherVariants=$weatherVariants pending=$pending")
            Result.success()
        }.getOrElse { error ->
            AlarmTalkLog.reportError("Dynamic voice refresh worker failed", error)
            Result.retry()
        }
    }
}
