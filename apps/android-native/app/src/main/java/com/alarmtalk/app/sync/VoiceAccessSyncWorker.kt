package com.alarmtalk.app.sync

import com.alarmtalk.app.data.DowngradeNoticeStore
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
import com.alarmtalk.app.data.VoiceReplacementMarkerStore
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
 * ⚠ **제자리 목소리 교체는 그 대조로 절대 안 걸린다.** 교체는 프로필 행을 **재사용**하므로
 * id 가 목록에 그대로 있다. 그래서 서버가 [INPUT_REPLACED_VOICE_ID] 로 "이 목소리의 직접 입력
 * 음원이 무효가 됐다" 를 실어 보내고, 그 경우에만 해당 프로필의 custom 알람을 함께 내린다
 * (프리셋 알람은 새 목소리로 다시 만들어지므로 살린다).
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
        // 시작 시점의 세션 세대 — 결과를 쓰기 전에 같은 세션인지 대조한다.
        val startGeneration = sessionStore.sessionGeneration()
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val auth = AlarmTalkApiClient.bearer(session.token)
            // 둘 다 성공해야 판단한다 — 하나라도 실패하면 throw 시켜 아래 retry 로 넘긴다.
            val myVoices = withContext(Dispatchers.IO) { api.listVoiceProfiles(auth).profiles }
            val sharedVoices =
                withContext(Dispatchers.IO) { api.listFamilyVoiceProfiles(auth).profiles }

            // 네트워크 왕복 중 로그아웃/계정전환이 일어났을 수 있다. 쓰기 직전에 현재 세션이
            // 아직 이 세션(같은 토큰)인지 재확인한다 — 재확인이 없으면 방금 받은 '옛 계정의'
            // 접근 가능 목록을 새 계정 기준으로 적용해, 새 계정 알람의 목소리를 영구히 벗긴다.
            // (PlanChangeSyncWorker 와 같은 가드.)
            //
            // 반대 방향(같은 기기에 남아 있는 앞 계정 알람을 이 계정 목록으로 벗기는 것)은
            // degradeAlarmsWithInaccessibleVoice 안의 소유자 게이트가 막는다 — 이 재확인은
            // 요청 중의 계정 전환만 잡으므로 둘 다 필요하다(Codex #646 P1).
            // 판정 기준은 **세션 세대**다. 토큰으로 비교하면 GET /auth/me 의 rolling refresh 가
            // 토큰만 갈아 끼운 것도 '계정이 바뀌었다' 로 오판해 결과를 버리고(콜드스타트마다
            // 갱신이 돌아 흔하다), 계정 id 로만 보면 로그아웃 후 같은 계정 재로그인을 통과시킨다
            // (Codex #665 P1·P2). 세대는 세션이 끝날 때만 바뀐다.
            val current = sessionStore.read()
            if (current == null ||
                current.user.id != session.user.id ||
                sessionStore.sessionGeneration() != startGeneration
            ) {
                return@runCatching Result.success()
            }

            val accessibleVoiceIds = (myVoices.map { it.id } + sharedVoices.map { it.id }).toSet()
            val repository = AlarmAppContainer.repository(applicationContext)
            val lostAccess = repository
                .degradeAlarmsWithInaccessibleVoice(accessibleVoiceIds, session.user.id)
            // ⚠ **표식을 확정하기 전에 계정이 그대로인지 다시 본다.** 강등은 저장소 락과 DB
            // 쓰기를 기다리는 사이 계정이 바뀔 수 있고, 그때 저장소는 소유자 불일치로 0을
            // 돌려준다 — 그 0을 '처리 완료' 로 적으면 그 사람이 다시 로그인했을 때 표식이
            // 맞아떨어져 **영영 재시도하지 않는다.**
            val stillSameSession = {
                val now = sessionStore.read()
                now != null && now.user.id == session.user.id &&
                    sessionStore.sessionGeneration() == startGeneration
            }
            // 교체된 목소리의 직접 입력 알람 — 위 대조는 못 잡는다(id 가 그대로 살아 있다).
            val markers = VoiceReplacementMarkerStore(applicationContext)
            var replacedCount = 0
            // ① 푸시가 실어 준 id(즉시성). 세대가 함께 왔고 이미 반영했으면 건너뛴다 —
            //    늦게 도착한 푸시가 그 사이 **새 목소리로** 만든 알람까지 지우면 안 된다.
            val replacedVoiceId = inputData.getString(INPUT_REPLACED_VOICE_ID)?.takeIf { it.isNotBlank() }
            val replacedGeneration = inputData.getString(INPUT_REPLACED_GENERATION)?.takeIf { it.isNotBlank() }
            if (replacedVoiceId != null &&
                !markers.hasApplied(session.user.id, replacedVoiceId, replacedGeneration)
            ) {
                replacedCount += repository.degradeCustomMessageAlarmsUsingVoiceProfile(
                    replacedVoiceId,
                    session.user.id,
                )
                if (replacedGeneration != null && stillSameSession()) {
                    markers.commit(session.user.id, replacedVoiceId, replacedGeneration)
                }
            }
            // ② 방금 받은 목록의 표식(정확성) — 푸시를 놓쳤어도 여기서 수렴한다.
            //    하루 주기 폴백이 이 경로를 그대로 탄다.
            //    ⚠ **공유받은 목소리도 함께 본다** — 그 목소리로 만든 내 직접 입력 알람도
            //    같이 무효가 되는데, 내 목록만 보면 그 기기는 영영 모른다.
            val markerCandidates = myVoices.map { it.id to it.customAudioInvalidatedAt } +
                sharedVoices.map { it.id to it.customAudioInvalidatedAt }
            for ((profileId, invalidatedAt) in markerCandidates) {
                if (!markers.changed(session.user.id, profileId, invalidatedAt)) continue
                replacedCount += repository.degradeCustomMessageAlarmsUsingVoiceProfile(
                    profileId,
                    session.user.id,
                )
                // 강등이 실제로 끝난 뒤에만 '봤다' 로 적는다 — 먼저 적으면 실패한 회차가
                // 신호를 삼켜 다시는 시도하지 않는다.
                // ⚠ `break` 다 — 아래 대기표 기록까지 건너뛰면 이미 강등된 알람의 이유를
                // 사용자가 영영 못 듣는다(iOS 도 같은 자리에서 break 한다).
                if (!stillSameSession()) break
                markers.commit(session.user.id, profileId, invalidatedAt)
            }
            // ⚠ **여기는 화면이 없다.** 강등만 하고 말면 사용자는 목소리가 사라진 이유를
            // 영영 모른다 — 대기표에 적어 두면 다음에 앱을 열 때 모달이 알려 준다.
            // 원인별로 따로 적는다 — 대기표가 우선순위로 합친다(안내할 액션이 있는 쪽이 이긴다).
            val notices = DowngradeNoticeStore(applicationContext)
            notices.record(session.user.id, DowngradeNoticeStore.Cause.SHARED_RELEASED, lostAccess)
            notices.record(session.user.id, DowngradeNoticeStore.Cause.VOICE_REPLACED, replacedCount)
            val degraded = lostAccess + replacedCount
            if (degraded > 0) {
                Log.i(TAG, "Degraded $degraded alarm(s): access=$lostAccess replaced=$replacedCount")
            }
            Result.success()
        }.getOrElse { error ->
            AlarmTalkLog.reportError("voice_access_revoked handling failed", error)
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "voice_access_revoked_sync"
        // ⚠ **교체 신호는 이름을 따로 쓴다.** 같은 이름이면 `REPLACE` 정책이 서로를 밀어내
        // 접근권 철회와 교체가 겹칠 때 한쪽이 조용히 사라진다. 교체 쪽은 폴백이 없다
        // (하루 주기 워커는 접근 가능 목록만 대조한다).
        private const val REPLACED_WORK_NAME = "voice_replaced_sync"
        private const val PERIODIC_WORK_NAME = "voice_access_periodic_sync"

        /** 제자리 교체로 직접 입력 음원이 무효가 된 프로필 id(푸시 payload 의 `voiceProfileId`). */
        const val INPUT_REPLACED_VOICE_ID = "replaced_voice_profile_id"

        /** 그 교체의 세대(푸시 payload 의 `invalidatedAt`). 이미 반영했으면 건너뛰는 기준. */
        const val INPUT_REPLACED_GENERATION = "replaced_voice_generation"

        private val networkConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /**
         * voice_access_revoked 푸시 수신 시 호출. 프로세스가 죽어도 살아남게 WorkManager 로 큐잉.
         *
         * @param replacedVoiceProfileId 제자리 교체 신호일 때만. 그 목소리의 직접 입력 알람을
         *   함께 내린다 — 접근 가능 목록 대조로는 잡히지 않기 때문이다.
         * @param replacedGeneration 그 교체의 세대. 이미 반영한 세대면 건너뛴다 — 늦게 온
         *   푸시가 그 사이 새 목소리로 만든 알람까지 지우지 않게 한다.
         */
        fun runOnce(
            context: Context,
            replacedVoiceProfileId: String? = null,
            replacedGeneration: String? = null,
        ) {
            val request = OneTimeWorkRequestBuilder<VoiceAccessSyncWorker>()
                .setConstraints(networkConstraints)
                .setInputData(
                    androidx.work.Data.Builder()
                        .putString(INPUT_REPLACED_VOICE_ID, replacedVoiceProfileId.orEmpty())
                        .putString(INPUT_REPLACED_GENERATION, replacedGeneration.orEmpty())
                        .build(),
                )
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                if (replacedVoiceProfileId.isNullOrBlank()) WORK_NAME else REPLACED_WORK_NAME,
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
