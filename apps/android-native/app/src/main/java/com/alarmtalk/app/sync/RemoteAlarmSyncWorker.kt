package com.alarmtalk.app.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.alarmtalk.app.AccessSnapshotStore
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.SessionTokenRenewal
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class RemoteAlarmSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val sessionStore = AuthSessionStore(applicationContext)
        val session = sessionStore.read() ?: return Result.success()
        val startGeneration = sessionStore.sessionGeneration()
        return runCatching {
            val api = AlarmTalkApiClient.create()

            // 만료가 가까우면 여기서 세션을 되살린다. 이게 없으면 갱신이 '앱을 여는 것'
            // 에만 걸려 있어, 몇 달씩 안 여는 사용자는 만료된 채로 열게 된다
            // (`SessionTokenRenewal` 주석 참조). 알람 동기화보다 **먼저** 해서, 굴러간
            // 토큰으로 이어지는 pull 이 돌게 한다.
            renewSessionTokenIfNeeded(sessionStore, api, session.token, startGeneration)

            // 갱신됐을 수 있으니 저장소에서 다시 읽는다. 세션이 끝났으면 조용히 종료한다.
            val token = sessionStore.read()?.token ?: return@runCatching Result.success()
            val result = AlarmAppContainer.repository(applicationContext)
                .pullReceivedAlarms(api, token)
            Log.i(
                TAG,
                "Remote alarm worker complete total=${result.total} imported=${result.imported} updated=${result.updated} failed=${result.failed}",
            )
            if (result.failed > 0) {
                Result.retry()
            } else {
                Result.success()
            }
        }.getOrElse { error ->
            AlarmTalkLog.reportError("Remote alarm worker failed", error)
            Result.retry()
        }
    }

    /**
     * 만료가 가까울 때만 `GET /auth/me` 로 토큰을 굴린다.
     *
     * ⚠ **실패해도 던지지 않는다.** 갱신은 알람 동기화의 전제 조건이 아니다 — 여기서
     * 던지면 네트워크가 잠깐 나빴다는 이유로 이미 받아 둔 알람 pull 까지 통째로
     * 재시도로 밀려난다.
     *
     * ⚠ 저장은 [AuthSessionStore.saveTokenIfGeneration] 으로 **판정과 쓰기를 한 덩어리**
     * 로 한다. 따로 하면 그 사이에 낀 로그아웃을 되돌려, 비운 저장소에 끝난 세션을 되쓴다
     * (`PlanChangeSyncWorker` 가 같은 이유로 같은 함수를 쓴다).
     */
    private suspend fun renewSessionTokenIfNeeded(
        sessionStore: AuthSessionStore,
        api: AlarmTalkApi,
        token: String,
        startGeneration: Long,
    ) {
        if (!SessionTokenRenewal.shouldRenew(token, System.currentTimeMillis())) return
        runCatching {
            val me = withContext(Dispatchers.IO) { api.me(AlarmTalkApiClient.bearer(token)) }
            // ⚠ **plan 도 적는다**(2026-09-01 리뷰). `plan_changed` 를 놓친 기기에서는 이
            // 갱신이 **유일하게 성공한 `/auth/me`** 일 수 있는데, 토큰만 저장하면 울림 게이트가
            // 읽는 값은 옛 등급 그대로다 — 보류·환불 뒤에도 클론이 계속 울리거나, 회복됐는데
            // 계속 막힌다. 스펙: "`/auth/me` 로 plan 을 받아 온 경로는 **전부** 적는다".
            // 계정 대조는 세션 세대가 대신한다 — 세대가 바뀌었으면 아래 CAS 가 막는다.
            sessionStore.read()?.user?.id?.takeIf { it.isNotBlank() }?.let { userId ->
                if (sessionStore.sessionGeneration() == startGeneration) {
                    AccessSnapshotStore(applicationContext).updateUserPlan(userId, me.user.plan)
                }
            }
            val rolled = me.token?.takeIf { it.isNotBlank() } ?: return@runCatching
            if (sessionStore.saveTokenIfGeneration(startGeneration, rolled) != null) {
                Log.i(TAG, "Session token renewed in background")
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Background session renewal failed", error)
        }
    }
}
