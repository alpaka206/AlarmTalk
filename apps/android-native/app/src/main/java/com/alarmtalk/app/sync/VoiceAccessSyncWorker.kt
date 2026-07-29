package com.alarmtalk.app.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.AuthSessionStore
import kotlinx.coroutines.Dispatchers
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
 *  - 울림 시점에 동의를 다시 보는 게이트는 없다. 그래서 앱을 열 때까지(refreshSocial)
 *    지워진 녹음이 계속 울린다.
 *
 * 판단 기준은 화면 경로와 같다: 내 목소리 + 공유받은 목소리를 **신선하게** 다시 받아, 그 목록에
 * 없는 목소리를 쓰는 내 알람만 강등한다(degradeAlarmsWithInaccessibleVoice). 한쪽이라도 조회에
 * 실패하면 목록을 믿을 수 없으므로 강등하지 않고 retry 한다 — 오강등이 미강등보다 나쁘다.
 * 놓쳐도 다음 앱 시작의 refreshSocial 이 폴백.
 */
class VoiceAccessSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val session = AuthSessionStore(applicationContext).read() ?: return Result.success()
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val auth = AlarmTalkApiClient.bearer(session.token)
            // 둘 다 성공해야 판단한다 — 하나라도 실패하면 throw 시켜 아래 retry 로 넘긴다.
            val myVoices = withContext(Dispatchers.IO) { api.listVoiceProfiles(auth).profiles }
            val sharedVoices =
                withContext(Dispatchers.IO) { api.listFamilyVoiceProfiles(auth).profiles }

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
    }
}
