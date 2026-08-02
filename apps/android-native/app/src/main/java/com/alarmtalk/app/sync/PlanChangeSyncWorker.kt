package com.alarmtalk.app.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.alarmtalk.app.AccessSnapshotStore
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.hasCoupleOrFamilyAccess
import com.alarmtalk.app.hasPaidVoiceAccess
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AuthTokenResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 서버 plan_changed 푸시(구독 만료 → 무료 강등) 처리 워커. FCM 서비스가 즉시 리턴한 뒤 프로세스가
 * 죽어도 살아남게 WorkManager 로 돌린다(가족 알람 pull 과 동일 패턴, 네트워크 제약). 구독·플랜·가족을
 * 재조회해 '진짜 무료'(유료구독 없음 + 가족/커플 아님 + user.plan=free)면 유료 목소리 알람을 기본
 * 알람으로 변환한다(강등 '시점'에 반영). 유료/가족/애매하면 변환하지 않아 오변환이 없다. 놓쳐도
 * 다음 앱 시작·울림 시점 게이트가 폴백. 조회 실패는 retry(네트워크 연결 시 재시도).
 */
class PlanChangeSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val sessionStore = AuthSessionStore(applicationContext)
        val session = sessionStore.read() ?: return Result.success()
        // 시작 시점의 세션 세대 — 결과를 쓰기 전에 같은 세션인지 대조한다.
        val startGeneration = sessionStore.sessionGeneration()
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val auth = AlarmTalkApiClient.bearer(session.token)

            // 최신 구독·플랜·가족 재조회(강등 확정 확인). 서버측 plan=free 는 /auth/me 로만 관찰
            // 가능하므로 billing·me 는 필수 — 둘 중 하나라도 실패하면 확정할 수 없으니 throw 시켜
            // outer runCatching 이 Result.retry() 로 처리한다(성공으로 조용히 끝내지 않는다). 가족은 보조.
            val billing = withContext(Dispatchers.IO) { api.getSubscription(auth) }
            // 응답 전체를 들고 있는다 — /auth/me 는 새 토큰도 함께 준다(rolling refresh).
            // user 만 꺼내 버리면 이 워커가 만료 직전 유일한 호출자일 때 갱신된 토큰이 버려지고,
            // 세션이 그대로 만료돼 재로그인을 강요한다(Codex #665 P2).
            val me = withContext(Dispatchers.IO) { api.me(auth) }
            val freshUser = me.user
            val familyGroup = runCatching { withContext(Dispatchers.IO) { api.getFamilyGroup(auth) } }.getOrNull()

            // 네트워크 왕복 중 로그아웃/계정전환이 일어났을 수 있다 — 결과를 쓰기 전에 현재 세션이 아직
            // **같은 계정**인지 재확인한다. 바뀌었으면 옛 세션을 부활시키거나 새 세션을 덮어쓰지
            // 않도록 이 결과를 버린다(성공 처리, 재시도 불요). (FCM 토큰 등록 레이스 가드와 동일 패턴.)
            //
            // 판정 기준은 **세션 세대**다. 토큰으로 보면 rolling refresh 도 '전환' 으로 오판하고,
            // 계정 id 로 보면 로그아웃 후 같은 계정 재로그인을 통과시켜 폐기된 옛 토큰을
            // 되살려 쓴다(Codex #665 P1·P2). 세대는 세션이 끝날 때만 바뀐다.
            val current = sessionStore.read()
            if (current == null ||
                current.user.id != session.user.id ||
                sessionStore.sessionGeneration() != startGeneration
            ) {
                return@runCatching Result.success()
            }

            // 로컬 영속 반영 — 울림 시점 게이트·다음 앱 오픈 UI 가 최신 상태를 쓰게 한다.
            val userId = session.user.id
            val snapshotStore = AccessSnapshotStore(applicationContext)
            snapshotStore.updateSubscription(userId, billing)
            snapshotStore.updateFamilyGroup(userId, familyGroup)
            // 토큰 우선순위: **이 요청이 방금 받은 새 토큰 → 지금 저장소의 토큰**. 시작 시점에
            // 잡아 둔 session.token 은 쓰지 않는다 — 그 사이 굴러간 토큰을 옛 것으로 되돌린다.
            val response = AuthTokenResponse(
                token = me.token?.takeIf { it.isNotBlank() } ?: current.token,
                user = freshUser,
            )
            if (session.provider == AuthSessionStore.PROVIDER_GOOGLE) {
                sessionStore.saveGoogleSession(response)
            } else {
                sessionStore.saveAppSession(response)
            }

            // '진짜 무료'만 변환: 유료 구독 없음 + 가족/커플 접근 없음 + user.plan 무료.
            val plan = freshUser.plan
            val genuinelyFree = !hasPaidVoiceAccess(billing) &&
                !hasCoupleOrFamilyAccess(billing, familyGroup) &&
                (plan.isBlank() || plan == "free")
            if (genuinelyFree) {
                AlarmAppContainer.repository(applicationContext).lockPaidAlarmTalks()
            }
            Result.success()
        }.getOrElse { error ->
            AlarmTalkLog.reportError("plan_changed conversion worker failed", error)
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "plan_changed_conversion"

        private val networkConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** plan_changed 푸시 수신 시 호출. 프로세스가 죽어도 살아남는 1회성 WorkManager 작업으로 큐잉. */
        fun runOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<PlanChangeSyncWorker>()
                .setConstraints(networkConstraints)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
