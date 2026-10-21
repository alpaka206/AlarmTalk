package com.alarmtalk.app.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.alarmtalk.app.AccessTicket
import com.alarmtalk.app.EntitlementWrite
import com.alarmtalk.app.EntitlementWriter
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.isDestroyedAccountFailure
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.SessionTokenRenewal
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * **계정 확인 워커** — 15분 주기(+ 앱 복귀·`account_deletion_requested` 푸시)로 인증된 `GET /auth/me` 를 한 번 보낸다.
 *
 * 하는 일은 셋이다:
 *  - **백그라운드 토큰 갱신**: 만료가 가까우면 응답의 새 토큰으로 갈아 끼운다([SessionTokenRenewal]). 앱을 몇 달씩
 *    안 여는 사용자도 세션이 끊기지 않는다.
 *  - **plan 기록**: 받은 plan 을 권한 스냅샷에 적는다 — `plan_changed` 를 놓친 기기의 울림 게이트가 이 값을 본다.
 *  - **세션이 끝났는지 확인**: 401(만료·폐기)·파기된 계정이면 세션을 끊고, 403 `ACCOUNT_PENDING_DELETION`(다른 기기의
 *    탈퇴 신청)이면 알람까지 끄고 떠난다([syncWorkerOutcome] → [endWorkerSession]).
 *
 * 예전에는 받은 알람을 내려받는 pull 이었다(커플·가족 이용권 폐지로 2026-10-20 에 걷어냈다). 클래스·유니크 작업 이름
 * (`RemoteAlarmSyncScheduler`)은 이미 깔린 주기 작업을 그대로 잇도록 두었다.
 */
class RemoteAlarmSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val sessionStore = AuthSessionStore(applicationContext)
        // ⚠ **세대를 세션보다 먼저 읽는다**(2026-09-01 리뷰, 다른 두 워커와 같은 이유).
        // 순서가 반대면 두 줄 사이의 A→B 전환에서 **A 의 토큰과 B 의 세대**가 짝지어져,
        // 세대 검사가 통과하는데 데이터는 A 것이다. 이 순서면 세대가 옛것이라 안전하게 실패한다.
        val startGeneration = sessionStore.sessionGeneration()
        val session = sessionStore.read() ?: return Result.success()
        // 401·403 을 받았을 때 끊을 세션은 **이 요청이 실제로 보낸 토큰**의 것이다(`endWorkerSession`).
        val usedToken = session.token
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val me = withContext(Dispatchers.IO) { api.me(AlarmTalkApiClient.bearer(usedToken)) }
            val fetchedAt = System.currentTimeMillis()
            // ⚠ **plan 도 적는다**(2026-09-01 리뷰). `plan_changed` 를 놓친 기기에서는 이 응답이
            // **유일하게 성공한 `/auth/me`** 일 수 있는데, 토큰만 저장하면 울림 게이트가 읽는 값은 옛 등급 그대로다 —
            // 보류·환불 뒤에도 클론이 계속 울리거나, 회복됐는데 계속 막힌다. 스펙: "`/auth/me` 로 plan 을 받아 온
            // 경로는 **전부** 적는다".
            // ⚠ **인증에 쓴 세션의 계정으로 적는다.** 여기서 저장소를 다시 읽으면 그 사이 로그인한 B 의 id 가 잡혀
            // **A 의 plan 이 B 의 스냅샷에 박힌다.** 문이 세대·계정을 함께 본다 — 그 사이 로그아웃→재로그인이 끼면
            // 거절된다. 거절은 이 회차가 통째로 옛 세션의 것이었다는 뜻이라 기록만 남긴다.
            session.user.id.takeIf { it.isNotBlank() }?.let { userId ->
                val written = EntitlementWriter(applicationContext)
                    .write(AccessTicket(userId, startGeneration), "background account check") {
                        // plan 과 프로모 종료 시각·받은 시각은 한 벌이다(`AccessSnapshot.withServerUser`).
                        it.withServerUser(me.user, fetchedAt)
                    }
                if (written != EntitlementWrite.Applied) {
                    Log.i(TAG, "Background plan record skipped: session changed mid-run")
                }
            }
            // ⚠ **토큰은 만료가 가까울 때만 갈아 끼운다.** 응답은 매번 새 토큰을 주지만, 주기마다 세션을 다시 쓰면
            // 관찰자(전경 뷰모델)가 그때마다 세션을 다시 흡수한다 — 얻는 것은 없다.
            // 저장은 [AuthSessionStore.saveTokenIfGeneration] 으로 **판정과 쓰기를 한 덩어리**로 한다. 따로 하면
            // 그 사이에 낀 로그아웃을 되돌려, 비운 저장소에 끝난 세션을 되쓴다(`PlanChangeSyncWorker` 와 같은 이유).
            val rolled = me.token?.takeIf { it.isNotBlank() }
            if (rolled != null && SessionTokenRenewal.shouldRenew(usedToken, fetchedAt) &&
                sessionStore.saveTokenIfGeneration(startGeneration, rolled) != null
            ) {
                Log.i(TAG, "Session token renewed in background")
            }
            Result.success()
        }.getOrElse { error ->
            // 파기된 계정 — 이 라우트만 401 이 아니라 404 `AUTH_USER_NOT_FOUND` 로 답한다([isDestroyedAccountFailure]).
            // 다른 라우트(예전의 pull)는 인증 미들웨어가 401 로 돌려줘 아래 세션 종료로 갔다 — 같은 결말로 보낸다.
            val outcome = if (isDestroyedAccountFailure(error)) {
                SyncWorkerOutcome.SESSION_EXPIRED
            } else {
                syncWorkerOutcome(error)
            }
            when (outcome) {
                SyncWorkerOutcome.RETHROW -> throw error
                SyncWorkerOutcome.SESSION_EXPIRED -> {
                    // 재시도해 봐야 같은 토큰이 또 거절당한다 — 세션을 끊고 끝낸다.
                    endWorkerSession(
                        error = error,
                        context = applicationContext,
                        sessionStore = sessionStore,
                        expectedGeneration = startGeneration,
                        usedToken = usedToken,
                        userId = session.user.id,
                        workerName = "Account check worker",
                    )
                    Result.success()
                }
                SyncWorkerOutcome.CONSENT_PENDING -> {
                    Log.i(TAG, "Account check worker deferred: consent not settled yet")
                    Result.success()
                }
                SyncWorkerOutcome.RETRY -> {
                    AlarmTalkLog.reportError("Account check worker failed", error)
                    Result.retry()
                }
            }
        }
    }
}
