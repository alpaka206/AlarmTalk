package com.alarmtalk.app.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.AuthSessionStore
import kotlinx.coroutines.Dispatchers
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.withContext

/**
 * 서버 voice_access_revoked 푸시 처리 워커 — 목소리 접근권을 잃은 '내 소유' 알람을 기본 알람으로
 * 강등한다.
 *
 * 왜 별도 경로가 필요한가:
 *  - family_alarm 푸시는 **받은 알람**만 갱신한다(RemoteAlarmPullSyncService 가 그것만 훑는다).
 *    내 소유 알람은 그 pull 대상이 아니라 서버가 목소리를 지워도 로컬은 그대로 남는다.
 *  - plan_changed 경로(PlanChangeSyncWorker)는 '진짜 무료'일 때만 변환한다. 동의 철회는
 *    users.plan 이 그대로라 그 게이트에 걸리지 않는다.
 *  - 울림 시점에 '이 목소리를 아직 쓸 수 있는가'를 보는 게이트는 없다(유료 권한 게이트는 있다 —
 *    RingingService.isPaidVoiceEntitledFromCache). 그래서 앱을 열 때까지(refreshSocial)
 *    지워진 녹음이 계속 울린다.
 *
 * 판단 기준은 화면 경로와 같다: 내 목소리 + 공유받은 목소리를 **신선하게** 다시 받아, 그 목록에
 * 없는 목소리를 쓰는 내 알람만 강등한다(degradeAlarmsWithInaccessibleVoice). 한쪽이라도 조회에
 * 실패하면 목록을 믿을 수 없으므로 강등하지 않고 retry 한다 — 오강등이 미강등보다 나쁘다.
 *
 * 경로는 셋이고 서로 폴백이다: 푸시([runOnce], 즉시) → 하루 주기([ensurePeriodic], 푸시 유실·앱
 * 미실행 대비) → 앱 시작 refreshSocial. 정확성은 뒤 둘이 보장하고 푸시는 즉시성만 맡는다.
 */
class VoiceAccessSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val sessionStore = AuthSessionStore(applicationContext)
        val session = sessionStore.read() ?: return Result.success()
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val auth = AlarmTalkApiClient.bearer(session.token)
            // 둘 다 성공해야 판단한다 — 하나라도 실패하면 throw 시켜 아래 retry 로 넘긴다.
            val myVoices = withContext(Dispatchers.IO) { api.listVoiceProfiles(auth).profiles }
            val sharedVoices =
                withContext(Dispatchers.IO) { api.listFamilyVoiceProfiles(auth).profiles }

            // 네트워크 왕복 중 로그아웃/계정전환이 일어났을 수 있다. 쓰기 직전에 현재 세션이
            // 아직 이 세션(같은 토큰)인지 재확인한다 — degradeAlarmsWithInaccessibleVoice 는
            // 소유자 필터 없이 LOCAL_OWNED 전체를 훑으므로, 옛 계정의 목록을 그대로 적용하면
            // 새 계정 알람의 목소리를 영구히 벗긴다. (PlanChangeSyncWorker 와 같은 가드.)
            val current = sessionStore.read()
            if (current == null || current.token != session.token) {
                return@runCatching Result.success()
            }

            val accessibleVoiceIds = (myVoices.map { it.id } + sharedVoices.map { it.id }).toSet()
            val degraded = AlarmAppContainer.repository(applicationContext)
                .degradeAlarmsWithInaccessibleVoice(accessibleVoiceIds)
            if (degraded > 0) {
                Log.i(TAG, "Degraded $degraded alarm(s) after voice access was revoked")
            }
            Result.success()
        }.getOrElse { error ->
            AlarmTalkLog.reportError("voice_access_revoked handling failed", error)
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "voice_access_revoked_sync"
        private const val PERIODIC_WORK_NAME = "voice_access_periodic_sync"

        private val networkConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** voice_access_revoked 푸시 수신 시 호출. 프로세스가 죽어도 살아남게 WorkManager 로 큐잉. */
        fun runOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<VoiceAccessSyncWorker>()
                .setConstraints(networkConstraints)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }

        /**
         * FCM 과 무관한 주기 폴백. 푸시가 유실되고 사용자가 앱을 안 열면 refreshSocial 도 안 돌아,
         * 접근권을 잃은 목소리가 그대로 남는다(발사는 로컬이라 서버가 막을 수 없다). 하루 한 번
         * 조용히 맞춰 둔다 — 즉시성은 푸시가, 정확성은 이 폴백이 맡는 구조(AGENTS.md).
         *
         * 하루 주기인 이유: 목소리 목록 두 번을 부르는 작업이라 짧은 주기는 쿼터·배터리만 쓴다.
         * 즉시 반영이 필요한 경우는 푸시가 이미 [runOnce] 로 처리한다.
         */
        fun ensurePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<VoiceAccessSyncWorker>(1, TimeUnit.DAYS)
                .setConstraints(networkConstraints)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
