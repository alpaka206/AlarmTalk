package com.alarmtalk.app.sync

import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.StockClipManifestStore
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.apiErrorCode
import kotlin.coroutines.cancellation.CancellationException

/**
 * 백그라운드 워커의 `runCatching` 이 잡은 실패를 **어떻게 마무리할지.**
 *
 * ⚠ **`sync/` 의 워커가 전부 같은 함수를 쓴다**(`RemoteAlarmSyncWorker`·`UsageEventUploadWorker`·
 * `DynamicVoiceRefreshWorker`·`PlanChangeSyncWorker`·`VoiceAccessSyncWorker`·
 * `StockClipPrefetchWorker`, 네트워크를 안 타는 `AlarmScheduleIntegrityWorker` 는 취소 갈래만).
 * 워커마다 손으로 가르면 새 워커가 빠지고, 빠진 줄도 모른다 — 실제로 취소·동의 판정은 알람
 * 동기화 워커에만 있었고 나머지는 **401 에도 영원히 재시도**했다(ANDROID-M). 그 1차 수정도
 * 여섯 중 셋에만 닿았다. `AlarmTalkLog` 가 판정을 호출부가 아니라 자기 한 곳에 둔 것과
 * 같은 이유다.
 *
 * ⚠ **빠뜨리는 것을 CI 가 막는다**: `scripts/check-sync-worker-unauthorized.py`
 * (`.github/workflows/ci.yml` 의 lint 잡). `sync/` 아래 `CoroutineWorker` 가 실패 처리에서
 * `Result.retry()` 를 돌려주면서 [syncWorkerOutcome] 을 거치지 않으면 빨간불이 난다.
 *
 * - [RETHROW]: **취소는 오류가 아니다.** `CoroutineWorker` 가 멈추거나(`ExistingWorkPolicy.REPLACE`
 *   로 대체되는 앱 복귀 때마다) 나며, `runCatching` 은 이것까지 잡는다. 삼키고 `retry()` 를
 *   돌려주면 WorkManager 는 무시하지만 그 사이 Sentry 에 "Job was cancelled" 가 한 건씩
 *   쌓였다(2026-09-14, 실사용자 10명·17건). 되던져야 WorkManager 가 취소로 본다.
 * - [SESSION_EXPIRED]: **401.** 같은 토큰으로 다시 보내 봐야 또 거절당한다 — 백오프 재시도는
 *   같은 401 을 영원히 반복하고, 그 회차마다 이슈가 한 건씩 쌓였다. 워커는 재시도하지 않고
 *   [endSessionAfterWorkerUnauthorized] 로 세션을 끊는다(전경의
 *   `MainViewModel.handleUnauthorized` 와 같은 결말).
 * - [CONSENT_PENDING]: 로그인 직후 동의 전에는 서버가 모든 데이터 라우트를 403
 *   `CONSENT_REQUIRED` 로 막는다(`middleware/consent.ts`). 사용자가 동의를 마쳐야 풀리는
 *   상태라 백오프 재시도는 403 만 반복한다 — 한 사용자가 17분에 12건을 남겼다. 성공으로
 *   끝내고, 동의 뒤 알람 탭 진입의 `syncNow` 와 주기 실행이 다시 끌어온다. 전경 경로
 *   (`MainViewModelAuthActions` 의 `syncNow`)와 같은 판단이다.
 *   ⚠ 정확히 `CONSENT_REQUIRED` 만이다 — `CONSENT_STATE_UNAVAILABLE`·`ACCOUNT_PENDING_DELETION`
 *   같은 실제 인증·동의 파손은 [RETRY] 로 가 모니터링에 남는다.
 * - [RETRY]: 그 밖의 실패. 보고하고 재시도한다(일시적 네트워크 실패는 `AlarmTalkLog` 가
 *   이슈 대신 브레드크럼으로 낮춘다).
 */
internal enum class SyncWorkerOutcome { RETHROW, SESSION_EXPIRED, CONSENT_PENDING, RETRY }

/**
 * ⚠ **401 을 `apiErrorCode` 보다 먼저 본다.** `errorBody` 는 한 번만 읽히는데, 401 판정은
 * 상태코드만 보면 되므로(`AlarmTalkLog.isHandledAuthFailure`) 본문을 건드리지 않는다.
 * 순서가 반대면 아무도 쓰지 않을 401 본문을 한 번 읽고 버린다.
 */
internal fun syncWorkerOutcome(error: Throwable): SyncWorkerOutcome =
    when {
        error is CancellationException -> SyncWorkerOutcome.RETHROW
        AlarmTalkLog.isHandledAuthFailure(error) -> SyncWorkerOutcome.SESSION_EXPIRED
        apiErrorCode(error) == "CONSENT_REQUIRED" -> SyncWorkerOutcome.CONSENT_PENDING
        else -> SyncWorkerOutcome.RETRY
    }

/**
 * 세대 검사를 통과한 뒤 **토큰까지 맞는가.** [endSessionAfterWorkerUnauthorized] 의 두 번째 문.
 *
 * 세대만으로는 부족하다 — `GET /auth/me` 의 rolling refresh 는 **같은 세션 안에서** 토큰을
 * 갈아 끼우므로 세대가 그대로다. 옛 토큰으로 이미 날아간 요청이 뒤늦게 401 로 돌아오면
 * 세대 검사를 통과해 **방금 갱신한 멀쩡한 세션을 지운다**(전경의
 * `MainViewModel.handleUnauthorized` 가 `failedToken` 을 보는 것과 같은 이유, Codex #665 P2).
 *
 * 저장소가 이미 비었으면(null·공백) 끊을 세션도 없다 — 거기에 쓰는 것은 정리가 아니라 부활이다.
 *
 * 순수 함수로 떼어 둔 이유는 `AuthSessionStore` 의 `sessionSurvivedForWrite` 와 같다:
 * `EncryptedSharedPreferences`(AndroidKeyStore)는 Robolectric 에서 세워지지 않아 저장소를
 * 띄우지 않고 규칙만 고정한다.
 */
internal fun workerMayEndSession(usedToken: String, storedToken: String?): Boolean =
    !storedToken.isNullOrBlank() && storedToken == usedToken

/**
 * 세션을 끝낼 때 밟는 단계. **순서가 곧 계약**이라 열거형으로 이름을 붙였다 —
 * [sessionExpiryPlan] 참고.
 */
internal enum class SessionExpiryStep {
    /** '자동으로 끊긴 계정' 표시. **반드시 [CLEAR_SESSION] 앞**이다(그 뒤엔 계정 id 를 못 읽는다). */
    MARK_EXPIRED,

    /** 떠 있는 매니페스트 조회의 표를 죽인다. 앞 계정의 늦은 응답이 디스크를 다시 공개하지 못하게. */
    INVALIDATE_MANIFEST_TICKETS,

    /** 저장소 비우기. 세대가 여기서 오르므로 **맨 마지막**이다. */
    CLEAR_SESSION,
}

/**
 * 401 을 받은 워커가 **무엇을 어떤 순서로 할지**. 저장소를 건드리지 않는 순수 함수다.
 *
 * ⚠ **순수 함수로 떼어 둔 이유**(2026-09-21 리뷰). 여기서 지켜야 하는 것은 값이 아니라
 * **순서**다. [SessionExpiryStep.MARK_EXPIRED] 가 [SessionExpiryStep.CLEAR_SESSION] 뒤로
 * 가면 `session_expired_owner` 가 비고, 업데이트 후 재예약이 복원 대상을 잃어 **이 기기의
 * 알람이 조용히 안 울린다.** `EncryptedSharedPreferences`(AndroidKeyStore)는 Robolectric 에서
 * 세워지지 않아 저장소를 띄운 채로는 이 순서를 고정할 수 없으므로, 판정을 단계 목록으로
 * 뽑아 테스트가 목록 그대로를 확인한다([workerMayEndSession]·`sessionSurvivedForWrite` 와
 * 같은 이유·같은 모양이다).
 *
 * @param signOutInProgress **명시적 로그아웃 창인가**(`AuthSessionStore.signOutInProgress`).
 *   참이면 [SessionExpiryStep.MARK_EXPIRED] 를 건너뛴다 — 로그아웃은 사용자가 끝낸 것이라
 *   그 표시가 남으면 **방금 떼어낸 알람이 로그인 화면 뒤에서 되살아난다**(끌 수도 없다).
 *   세대·토큰 두 문은 이 창에서 아무것도 막지 못한다: 서버 `token_epoch` 가 먼저 오르고
 *   로컬 세대는 마지막 `clear()` 에서야 오르기 때문이다. 세션 정리 자체는 그대로 한다 —
 *   어차피 끝날 세션이고, 멱등이다.
 * @return 밟을 단계들. 비어 있으면 **아무것도 하지 않는다**(끊을 세션이 없거나 이미 굴러간 토큰).
 */
internal fun sessionExpiryPlan(
    usedToken: String,
    storedToken: String?,
    signOutInProgress: Boolean,
    userId: String,
): List<SessionExpiryStep> {
    if (!workerMayEndSession(usedToken, storedToken)) return emptyList()
    val markExpired = !signOutInProgress && userId.isNotBlank()
    return buildList {
        if (markExpired) add(SessionExpiryStep.MARK_EXPIRED)
        add(SessionExpiryStep.INVALIDATE_MANIFEST_TICKETS)
        add(SessionExpiryStep.CLEAR_SESSION)
    }
}

/**
 * 401 을 받은 워커가 **세션을 끝낸다.** 전경의 `MainViewModel.handleUnauthorized` 와 같은
 * 결말이고, 화면이 없는 자리라 그쪽의 UI 정리만 빠진다.
 *
 * ⚠ **문을 두 겹 세운다 — 떠난 계정의 뒤늦은 401 이 새 세션을 끊으면 안 된다.**
 *  - **세대**([AuthSessionStore.runIfGeneration]): 그 사이 로그아웃·탈퇴·다른 계정 로그인이
 *    끼면 세대가 올라 아무것도 쓰지 않는다. 검사와 쓰기가 같은 락 안이라 그 사이에 낀
 *    로그아웃을 되돌리지 않는다.
 *  - **토큰**: 세대만으로는 부족하다. `GET /auth/me` 의 rolling refresh 는 **같은 세션 안에서**
 *    토큰을 갈아 끼우므로 세대가 그대로다 — 옛 토큰으로 이미 날아간 요청이 뒤늦게 401 로
 *    돌아오면 세대 검사를 통과해 **방금 갱신한 멀쩡한 세션을 지운다**(Codex #665 P2 와 같은
 *    모양). 그래서 저장소의 지금 토큰이 **내가 보낸 그 토큰**일 때만 끊는다.
 *
 * ⚠ 끊기 전에 [AuthSessionStore.markSessionExpired] 를 남긴다. '자동으로 끊긴 계정' 이라는
 * 표시가 없으면 업데이트 후 재예약이 복원 대상을 잃어 **이 기기의 알람이 조용히 안 울린다**
 * ([AuthSessionStore.sessionExpiredOwnerUserId]). 소유자 미정 행은 `clear()` 가 남기는
 * `pendingOwnerUserId` 가 받아 준다 — 전경이 하는 `claimUnownedAlarmsFor` 의 안전망과 같다.
 *
 * ⚠ 매니페스트 표도 함께 죽인다(Codex #703 P1). 세션이 끝난 뒤 도착한 앞 계정의 응답이
 * 디스크 매니페스트를 **다시 공개하는 것**을 막는다 — 전경의 `clearSessionKeepingAlarms`
 * 가 같은 이유로 같은 일을 한다.
 *
 * ⚠ **세 번째 문: 명시적 로그아웃 창.** 위 두 문은 로그아웃 도중에는 아무것도 막지 못한다 —
 * 서버 `token_epoch` 가 먼저 오르는데 로컬 세대·토큰은 마지막 `clear()` 까지 그대로라,
 * 그 사이 떠 있던 요청의 401 이 두 문을 **정상적으로** 통과한다. 그때 만료 표시를 남기면
 * 방금 떼어낸 알람이 다음 재예약에서 되살아난다(로그인 화면 뒤라 끌 수도 없다). 그래서
 * `AuthSessionStore.signOutInProgress` 를 보고 표시만 건너뛴다 — 무엇을 밟을지는
 * [sessionExpiryPlan] 이 정하고, 이 함수는 그 목록을 그대로 실행한다.
 *
 * 알람 예약은 건드리지 않는다. 자동 401 은 '같은 사람이 다시 로그인하면 되는' 상황인데,
 * 여기서 예약을 취소하면 사용자가 안내를 못 본 사이 알람이 조용히 안 울린다.
 *
 * @param usedToken 401 을 받은 요청이 **실제로 보낸** 토큰.
 * @param userId 그 토큰을 발급받은 계정.
 * @return 실제로 끊었으면 true.
 */
internal fun endSessionAfterWorkerUnauthorized(
    sessionStore: AuthSessionStore,
    expectedGeneration: Long,
    usedToken: String,
    userId: String,
    workerName: String,
): Boolean {
    var ended = false
    var markedExpired = false
    runCatching {
        sessionStore.runIfGeneration(expectedGeneration) {
            // 세대가 같아도 토큰이 굴러갔으면 그 401 은 이미 지나간 토큰의 것이다.
            // 로그아웃 창이면 만료 표시만 빠진다 — 판정은 전부 [sessionExpiryPlan] 에 있다.
            val plan = sessionExpiryPlan(
                usedToken = usedToken,
                storedToken = sessionStore.read()?.token,
                signOutInProgress = sessionStore.signOutInProgress(),
                userId = userId,
            )
            if (plan.isEmpty()) return@runIfGeneration
            plan.forEach { step ->
                when (step) {
                    SessionExpiryStep.MARK_EXPIRED -> {
                        sessionStore.markSessionExpired(userId)
                        markedExpired = true
                    }
                    SessionExpiryStep.INVALIDATE_MANIFEST_TICKETS ->
                        StockClipManifestStore.invalidateOutstandingTickets()
                    SessionExpiryStep.CLEAR_SESSION -> sessionStore.clear()
                }
            }
            ended = true
        }
    }.onFailure { error ->
        AlarmTalkLog.reportError("Session expiry from $workerName failed", error)
    }
    // 세 결말을 **구분해서** 남긴다. "끊었다" 하나로 뭉치면, 알람이 되살아나지 않은 이유가
    // 로그아웃 창이었는지 표시 쓰기가 빠진 것인지 나중에 되짚을 수 없다.
    Log.i(
        TAG,
        when {
            ended && markedExpired -> "$workerName ended the expired session"
            ended -> "$workerName ended the session during an explicit sign-out (no expiry marker)"
            else -> "$workerName ignored a 401 from a superseded session"
        },
    )
    return ended
}
