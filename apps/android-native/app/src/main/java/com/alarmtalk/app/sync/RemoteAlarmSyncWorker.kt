package com.alarmtalk.app.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.alarmtalk.app.AccessSnapshotStore
import com.alarmtalk.app.AccessTicket
import com.alarmtalk.app.EntitlementWrite
import com.alarmtalk.app.EntitlementWriter
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.SessionTokenRenewal
import com.alarmtalk.app.network.apiErrorCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.coroutines.cancellation.CancellationException

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
        return runCatching {
            val api = AlarmTalkApiClient.create()

            // 만료가 가까우면 여기서 세션을 되살린다. 이게 없으면 갱신이 '앱을 여는 것'
            // 에만 걸려 있어, 몇 달씩 안 여는 사용자는 만료된 채로 열게 된다
            // (`SessionTokenRenewal` 주석 참조). 알람 동기화보다 **먼저** 해서, 굴러간
            // 토큰으로 이어지는 pull 이 돌게 한다.
            renewSessionTokenIfNeeded(sessionStore, api, session.token, startGeneration, session.user.id)

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
            when (remoteAlarmSyncFailureOutcome(error)) {
                RemoteAlarmSyncFailureOutcome.RETHROW -> throw error
                RemoteAlarmSyncFailureOutcome.CONSENT_PENDING -> {
                    Log.i(TAG, "Remote alarm worker deferred: consent not settled yet")
                    Result.success()
                }
                RemoteAlarmSyncFailureOutcome.RETRY -> {
                    AlarmTalkLog.reportError("Remote alarm worker failed", error)
                    Result.retry()
                }
            }
        }
    }

    /**
     * 만료가 가까울 때만 `GET /auth/me` 로 토큰을 굴린다.
     *
     * ⚠ **실패해도 던지지 않는다.** 갱신은 알람 동기화의 전제 조건이 아니다 — 여기서
     * 던지면 네트워크가 잠깐 나빴다는 이유로 이미 받아 둔 알람 pull 까지 통째로
     * 재시도로 밀려난다. 유일한 예외는 **취소**다(실패가 아니라 워커가 멈추는 것).
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
        /** 이 토큰을 발급받은 계정. 받아 온 plan 은 **이 계정** 스냅샷에만 적는다. */
        sessionUserId: String,
    ) {
        if (!SessionTokenRenewal.shouldRenew(token, System.currentTimeMillis())) return
        runCatching {
            val me = withContext(Dispatchers.IO) { api.me(AlarmTalkApiClient.bearer(token)) }
            // ⚠ **plan 도 적는다**(2026-09-01 리뷰). `plan_changed` 를 놓친 기기에서는 이
            // 갱신이 **유일하게 성공한 `/auth/me`** 일 수 있는데, 토큰만 저장하면 울림 게이트가
            // 읽는 값은 옛 등급 그대로다 — 보류·환불 뒤에도 클론이 계속 울리거나, 회복됐는데
            // 계속 막힌다. 스펙: "`/auth/me` 로 plan 을 받아 온 경로는 **전부** 적는다".
            // 계정 대조는 세션 세대가 대신한다 — 세대가 바뀌었으면 아래 CAS 가 막는다.
            // ⚠ **인증에 쓴 세션의 계정으로 적는다.** 여기서 저장소를 다시 읽으면 그 사이
            // 로그인한 B 의 id 가 잡혀 **A 의 plan 이 B 의 스냅샷에 박힌다**(그 뒤 굴러온
            // 토큰이 없으면 CAS 도 안 돌아 아무도 못 막는다). 세대가 그대로일 때만 쓴다.
            sessionUserId.takeIf { it.isNotBlank() }?.let { userId ->
                // 문이 세대·계정을 함께 본다 — 그 사이 로그아웃→재로그인이 끼면 거절된다.
                // ⚠ **결과를 버리지 않는다**(2026-09-02 리뷰). 아래 토큰 회전이 세대를 다시
                //   보므로 여기서 되돌릴 것은 없지만, 이 회차가 통째로 옛 세션의 것이었다는
                //   사실은 남겨야 추적된다. 조용히 버리면 "배경 갱신이 왜 안 먹었나" 를
                //   나중에 알 길이 없다.
                val renewed = EntitlementWriter(applicationContext)
                    .write(AccessTicket(userId, startGeneration), "background session renewal") {
                        it.copy(userPlan = me.user.plan)
                    }
                if (renewed != EntitlementWrite.Applied) {
                    Log.i(TAG, "Background plan renewal skipped: session changed mid-run")
                }
            }
            val rolled = me.token?.takeIf { it.isNotBlank() } ?: return@runCatching
            if (sessionStore.saveTokenIfGeneration(startGeneration, rolled) != null) {
                Log.i(TAG, "Session token renewed in background")
            }
        }.onFailure { error ->
            // 취소는 바깥 `runCatching` 까지 그대로 올린다 — 여기서 삼키면 워커가 멈추는
            // 중에도 아래 pull 을 이어 간다.
            if (error is CancellationException) throw error
            AlarmTalkLog.reportError("Background session renewal failed", error)
        }
    }
}

/**
 * `doWork` 의 `runCatching` 이 잡은 실패를 어떻게 마무리할지.
 *
 * - [RETHROW]: **취소는 오류가 아니다.** `CoroutineWorker` 가 멈추거나(`ExistingWorkPolicy.REPLACE`
 *   로 대체되는 앱 복귀 때마다) 나며, `runCatching` 은 이것까지 잡는다. 삼키고 `retry()` 를
 *   돌려주면 WorkManager 는 무시하지만 그 사이 Sentry 에 "Job was cancelled" 가 한 건씩
 *   쌓였다(2026-09-14, 실사용자 10명·17건). 되던져야 WorkManager 가 취소로 본다.
 * - [CONSENT_PENDING]: 로그인 직후 동의 전에는 서버가 모든 데이터 라우트를 403
 *   `CONSENT_REQUIRED` 로 막는다(`middleware/consent.ts`). 사용자가 동의를 마쳐야 풀리는
 *   상태라 백오프 재시도는 403 만 반복한다 — 한 사용자가 17분에 12건을 남겼다. 성공으로
 *   끝내고, 동의 뒤 알람 탭 진입의 `syncNow` 와 15분 주기가 다시 끌어온다. 전경 경로
 *   (`MainViewModelAuthActions` 의 `syncNow`)와 같은 판단이다.
 *   ⚠ 정확히 `CONSENT_REQUIRED` 만이다 — `CONSENT_STATE_UNAVAILABLE`·`ACCOUNT_PENDING_DELETION`
 *   같은 실제 인증·동의 파손은 [RETRY] 로 가 모니터링에 남는다.
 * - [RETRY]: 그 밖의 실패. 보고하고 재시도한다(일시적 네트워크 실패는 `AlarmTalkLog` 가
 *   이슈 대신 브레드크럼으로 낮춘다).
 */
internal enum class RemoteAlarmSyncFailureOutcome { RETHROW, CONSENT_PENDING, RETRY }

internal fun remoteAlarmSyncFailureOutcome(error: Throwable): RemoteAlarmSyncFailureOutcome =
    when {
        error is CancellationException -> RemoteAlarmSyncFailureOutcome.RETHROW
        apiErrorCode(error) == "CONSENT_REQUIRED" -> RemoteAlarmSyncFailureOutcome.CONSENT_PENDING
        else -> RemoteAlarmSyncFailureOutcome.RETRY
    }
