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
        val sessionStore = AuthSessionStore(applicationContext)
        // ⚠ 다른 두 워커와 같은 순서 — 세대를 세션보다 먼저 읽는다. 순서가 반대면 두 줄
        // 사이의 A→B 전환에서 **A 의 토큰과 B 의 세대**가 짝지어져, 세대 검사가 통과하는데
        // 데이터는 A 것이다. 이 순서면 세대가 옛것이라 안전하게 실패한다.
        val startGeneration = sessionStore.sessionGeneration()
        val session = sessionStore.read() ?: return Result.success()
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
            when (syncWorkerOutcome(error)) {
                SyncWorkerOutcome.RETHROW -> throw error
                SyncWorkerOutcome.SESSION_EXPIRED -> {
                    // 폐기된 토큰으로는 날씨 변형을 받아 올 수 없다. 재시도 대신 세션을 끊고,
                    // 다시 로그인하면 주기 실행이 알람 전까지 마저 메운다.
                    endSessionAfterWorkerUnauthorized(
                        sessionStore = sessionStore,
                        expectedGeneration = startGeneration,
                        usedToken = session.token,
                        userId = session.user.id,
                        workerName = "Dynamic voice refresh worker",
                    )
                    Result.success()
                }
                SyncWorkerOutcome.CONSENT_PENDING -> {
                    Log.i(TAG, "Dynamic voice refresh worker deferred: consent not settled yet")
                    Result.success()
                }
                SyncWorkerOutcome.RETRY -> {
                    AlarmTalkLog.reportError("Dynamic voice refresh worker failed", error)
                    Result.retry()
                }
            }
        }
    }
}
