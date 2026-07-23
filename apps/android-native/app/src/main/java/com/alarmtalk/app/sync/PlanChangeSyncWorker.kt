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
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val auth = AlarmTalkApiClient.bearer(session.token)

            // 최신 구독·플랜·가족 재조회(강등 확정 확인).
            val billing = withContext(Dispatchers.IO) { api.getSubscription(auth) }
            val freshUser = runCatching { withContext(Dispatchers.IO) { api.me(auth).user } }.getOrNull()
            val familyGroup = runCatching { withContext(Dispatchers.IO) { api.getFamilyGroup(auth) } }.getOrNull()

            // 로컬 영속 반영 — 울림 시점 게이트·다음 앱 오픈 UI 가 최신 상태를 쓰게 한다.
            val userId = session.user.id
            val snapshotStore = AccessSnapshotStore(applicationContext)
            snapshotStore.updateSubscription(userId, billing)
            snapshotStore.updateFamilyGroup(userId, familyGroup)
            if (freshUser != null) {
                val response = AuthTokenResponse(token = session.token, user = freshUser)
                if (session.provider == AuthSessionStore.PROVIDER_GOOGLE) {
                    sessionStore.saveGoogleSession(response)
                } else {
                    sessionStore.saveAppSession(response)
                }
            }

            // '진짜 무료'만 변환: 유료 구독 없음 + 가족/커플 접근 없음 + user.plan 무료.
            val plan = freshUser?.plan ?: session.user.plan
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
