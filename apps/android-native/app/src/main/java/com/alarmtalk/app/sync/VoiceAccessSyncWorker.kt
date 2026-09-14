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
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.StockClipManifestStore
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

            // ⚠ **서버가 프리셋을 아직 다시 굽지 않았을 수 있다**(Codex #703 P1). 제자리
            // 교체는 세대 표식을 **먼저** 커밋하고 프리셋 재렌더는 큐에만 넣는다 — 굽는 것은
            // cron 이 나중에 한다. 그 사이에 이 워커가 표식을 확정해 버리면, 재렌더가 끝나도
            // 다음 회차들이 그 세대를 건너뛰어 **프리셋 알람이 회수된 목소리로 계속 운다.**
            // 매니페스트가 클립마다 '지금 목소리로 구웠는가' 를 알려 주므로, 아직인 프로필은
            // 이 회차에서 **확정하지 않고**(강등은 한다) 아래에서 retry 로 다시 온다.
            // ⚠ **못 물어본 것을 '다 준비됨' 으로 읽지 말 것**(Codex #703 P1). 조회가 실패했는데
            // 빈 집합으로 떨어뜨리면 그 회차가 세대를 **확정**해 버리고, 그 뒤에 큐잉된
            // 프리페치 워커가 아직 옛 매니페스트를 읽어 '낡은 것 없음' 으로 성공한다 —
            // 완료 FCM 을 놓치면 다음 폴백은 확정된 표식 때문에 다시 시도하지도 않는다.
            // null 은 **모른다**는 뜻이고, 모르면 확정하지 않고 retry 한다.
            //
            // ⚠ **서버가 다 구웠다고 끝이 아니다 — 이 기기의 캐시도 갈려 있어야 한다**
            // (Codex #703 P1). 확정한 뒤에는 다음 회차들이 그 세대를 건너뛰므로, 캐시가 아직
            // 옛 바이트인 채로 확정하면 그 알람은 회수된 목소리로 운다(프리페치가 재시도
            // 한도에 걸려 죽어도 되짚을 근거가 없다). 그래서 **매니페스트의 주소와 로컬
            // 캐시가 일치하는지**까지 본다 — 일치할 때까지는 확정하지 않고 retry 한다.
            val notReadyVoiceIds: Set<String>? = runCatching {
                // ⚠ **이 조회도 권위를 통해 공개한다**(Codex #703 P1). 그냥 읽고 버리면
                // 수위선이 오르지 않아, 교체 **전에** 출발한 프리페치의 옛 응답이 나중에
                // 통과해 디스크를 되돌린다 — 그 사이 이 판정은 '준비됨' 으로 확정해 버린다.
                val ticket = StockClipManifestStore.beginFetch()
                val manifest = withContext(Dispatchers.IO) { api.getStockClips(auth) }
                val published = StockClipManifestStore.save(
                    applicationContext,
                    manifest,
                    ticket,
                    session.user.id,
                )
                // 더 새 매니페스트가 이미 나왔거나 디스크에 못 남겼으면 **판단하지 않는다**
                // (null = 모른다 → 확정하지 않고 retry).
                if (published != StockClipManifestStore.PublishResult.PUBLISHED) {
                    throw IllegalStateException("manifest not published: $published")
                }
                val clips = manifest.clips
                val store = AlarmAudioStore(applicationContext)
                clips.filter { clip ->
                    !clip.isRendered ||
                        AlarmAudioStore.messageCacheKeys(clip.messageId).any { key ->
                            store.isCachedAudioStale(key, clip.audioUrl) ||
                                store.cachedAudioNeedsRevisionRefresh(key, clip.audioUrl)
                        }
                }.map { it.voiceProfileId }.toSet()
            }.getOrNull()
            // 확정해도 되는가 — 모르면(null) 안 된다.
            fun prerenderReady(voiceProfileId: String): Boolean =
                notReadyVoiceIds?.contains(voiceProfileId) == false

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
            // ⚠ 판정·강등·확정은 저장소가 **한 임계구역**에서 돈다. 여기서 미리 판정해 두면
            // 그 사이 더 새 세대가 강등·확정되고 사용자가 새 목소리로 만든 알람을, 뒤늦게
            // 깨어난 옛 회차가 지운다(계정 재확인도 강등 직후에 그 안에서 한다).
            val markers = VoiceReplacementMarkerStore(applicationContext)
            var replacedCount = 0
            // 교체 세대를 하나라도 집었으면 프리셋 캐시(매니페스트 + 바이트)도 다시 받아야 한다.
            var presetCacheNeedsRefresh = false
            // 표식을 디스크에 남기지 못한 회차가 하나라도 있으면 이 회차는 **끝난 것이 아니다.**
            var markerPersistFailed = false
            // ⚠ **두 루프의 판정을 합쳐 마지막에 한 번만 쓴다**(Codex #703 P1).
            // 예전에는 각 루프가 그 자리에서 `setSettling` 을 불렀는데, 푸시 루프가 올린
            // 표시를 **바로 아래 목록 루프가 같은 프로필에서 내렸다** — 그 회차는 이미
            // 반영된 세대라 건너뛰며 '성공' 을 돌려주기 때문이다. 결과적으로 확정되지 않은
            // 교체 목소리가 그 즉시 다시 고를 수 있게 됐다.
            val touchedProfiles = mutableSetOf<String>()
            val unpersistedProfiles = mutableSetOf<String>()
            // ① 푸시가 실어 준 id(즉시성). 세대가 함께 왔고 이미 반영했으면 건너뛴다 —
            //    늦게 도착한 푸시가 그 사이 **새 목소리로** 만든 알람까지 지우면 안 된다.
            val replacedVoiceId = inputData.getString(INPUT_REPLACED_VOICE_ID)?.takeIf { it.isNotBlank() }
            val replacedGeneration = inputData.getString(INPUT_REPLACED_GENERATION)?.takeIf { it.isNotBlank() }
            if (replacedVoiceId != null) {
                // ⚠ 확정을 미루더라도 **이미 내린 것은 세어 안내한다** — 강등은 이미 일어났고
                // 그 이유를 말해 줄 곳이 여기뿐이다(다음 회차는 대상이 0이라 셀 것이 없다).
                var degradedNow = 0
                val pushResult = markers.applyIfNotApplied(
                    session.user.id,
                    replacedVoiceId,
                    replacedGeneration,
                ) {
                    degradedNow = repository.degradeCustomMessageAlarmsUsingVoiceProfile(
                        replacedVoiceId,
                        session.user.id,
                        // 아래 목록 경로와 같은 이유 — 제자리 교체는 기본 목소리도 대상이다.
                        allowSystemVoice = true,
                        // 표식보다 나중에 만든 오디오는 이미 새 목소리다 — 깎지 않는다.
                        invalidatedBeforeMillis = com.alarmtalk.app.data
                            .parseVoiceMarkerMillis(replacedGeneration),
                    )
                    // 프리셋이 아직 안 구워졌거나 물어보지 못했으면 강등만 하고 **확정하지 않는다**.
                    // ⚠ **서버가 다 구웠다고 해도 이 기기의 캐시는 아직 옛 바이트다**
                    // (Codex #703 P1). 확정은 프리페치가 실제로 갈아 끼운 **다음 회차**에
                    // 맡긴다 — 여기서 확정해 버리면 그 사이 울리는 알람이 회수된 목소리를
                    // 쓰고, 프리페치가 재시도 한도에 걸려 죽어도 되짚을 근거가 없다.
                    if (stillSameSession() && prerenderReady(replacedVoiceId)) {
                        degradedNow
                    } else {
                        null
                    }
                }
                // ⚠ **확정 실패는 여기서도 끝난 일이 아니다**(Codex #703 P1). 워커에는
                // 화면 상태가 없어 표시를 메모리에 둘 수 없다 — 디스크에 남겨 편집기가 보게
                // 하고, 이 회차는 **완료로 보고하지 않는다**(WorkManager 가 다시 부른다).
                touchedProfiles += replacedVoiceId
                if (pushResult.changed) presetCacheNeedsRefresh = true
                if (!pushResult.persisted) {
                    unpersistedProfiles += replacedVoiceId
                    markerPersistFailed = true
                }
                replacedCount += degradedNow
            }
            // ② 방금 받은 목록의 표식(정확성) — 푸시를 놓쳤어도 여기서 수렴한다.
            //    하루 주기 폴백이 이 경로를 그대로 탄다.
            //    ⚠ **공유받은 목소리도 함께 본다** — 그 목소리로 만든 내 직접 입력 알람도
            //    같이 무효가 되는데, 내 목록만 보면 그 기기는 영영 모른다.
            val markerCandidates = myVoices.map { it.id to it.customAudioInvalidatedAt } +
                sharedVoices.map { it.id to it.customAudioInvalidatedAt }
            for ((profileId, invalidatedAt) in markerCandidates) {
                // ⚠ `break` 다 — 아래 대기표 기록까지 건너뛰면 이미 강등된 알람의 이유를
                // 사용자가 영영 못 듣는다(iOS 도 같은 자리에서 멈춘다).
                if (!stillSameSession()) break
                var degradedNow = 0
                val listResult = markers.applyIfChanged(session.user.id, profileId, invalidatedAt) {
                    degradedNow = repository.degradeCustomMessageAlarmsUsingVoiceProfile(
                        profileId,
                        session.user.id,
                        // ⚠ **표식 경로에서는 기본 목소리도 대상이다**(2026-09-03 리뷰 21차).
                        //   제자리 교체(`#111`)는 프로필 id 를 그대로 두고 provider 만 바꾸므로,
                        //   그 목소리로 만든 직접 입력 알람은 **이름만 새 목소리**이고 소리는
                        //   옛것이다. 재바인더 두 갈래 어디에도 안 걸리는 형태라 여기서만 잡힌다.
                        allowSystemVoice = true,
                        // 표식보다 나중에 만든 오디오는 이미 새 목소리다 — 깎지 않는다.
                        invalidatedBeforeMillis = com.alarmtalk.app.data
                            .parseVoiceMarkerMillis(invalidatedAt),
                    )
                    // 위와 같은 이유 — 프리셋 재렌더가 끝나고 **이 기기 캐시까지 갈아 끼운 뒤**
                    // 확정한다(그 확정은 프리페치가 끝난 다음 회차가 한다).
                    if (stillSameSession() && prerenderReady(profileId)) {
                        degradedNow
                    } else {
                        null
                    }
                }
                touchedProfiles += profileId
                if (!listResult.persisted) {
                    unpersistedProfiles += profileId
                    markerPersistFailed = true
                }
                // ⚠ **프리셋 캐시도 다시 받아야 한다**(Codex #703 P1). 이 워커는 교체 푸시를
                // 놓쳤을 때의 **유일한 폴백**인데, 예전에는 커스텀 문구 알람만 강등하고
                // 매니페스트·프리셋 바이트는 건드리지 않았다. 그 목소리를 **프리셋 알람만**
                // 쓰고 있으면 `degradedNow` 가 0 인데 표식은 확정돼, 다음 회차부터 그 세대를
                // 건너뛴다 — 사용자가 앱을 열 때까지 회수된 목소리로 계속 운다.
                // 판정은 `degraded` 가 아니라 `changed` 다(같은 이유로 0 이 나올 수 있다).
                if (listResult.changed) presetCacheNeedsRefresh = true
                // 확정을 미뤘어도 이미 내린 것은 센다 — 안내는 여기서만 남길 수 있다.
                replacedCount += degradedNow
            }
            // 매니페스트와 낡은 프리셋 바이트는 이 워커가 직접 받지 않고 전용 워커에 맡긴다
            // (FCM `voice_share_changed` 도 같은 워커를 큐잉한다 — `AlarmTalkMessagingService`).
            if (presetCacheNeedsRefresh) {
                StockClipPrefetchWorker.enqueue(applicationContext)
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
            // 두 루프를 마친 뒤 프로필마다 **한 번만** 쓴다 — 확정을 못 한 것만 올리고
            // 나머지는 내린다. 디스크 쓰기가 실패하면 그것도 미완료로 센다.
            touchedProfiles.forEach { profileId ->
                val settling = profileId in unpersistedProfiles
                if (!markers.setSettling(session.user.id, profileId, settling)) {
                    markerPersistFailed = true
                }
            }
            // ⚠ **확정 실패는 완료로 보고하지 않는다**(Codex #703 P1). 안내는 이미 남겼고
            // 강등도 되돌리지 않는다 — 다시 부르면 대상이 0이라 같은 안내가 반복되지도
            // 않는다. WorkManager 가 백오프로 다시 부르게 두는 편이, 확정 없이 끝나 그
            // 목소리가 고를 수 있게 되는 것보다 안전하다.
            // 아직 안 구워진 프리셋이 있거나 **물어보지 못했으면** 이 회차는 끝난 것이 아니다 —
            // WorkManager 가 다시 부르게 한다. 그때 준비돼 있으면 그 세대를 확정한다.
            if (markerPersistFailed || notReadyVoiceIds?.isNotEmpty() != false) {
                Result.retry()
            } else {
                Result.success()
            }
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
            // ⚠ **교체 신호는 프로필마다 다른 이름으로 큐잉한다**(Codex #703 P1).
            // 하나의 `voice_replaced_sync` 이름에 `REPLACE` 로 넣으면, 두 목소리의 교체 푸시가
            // 잇달아 올 때 **뒤엣것이 앞엣것을 취소**하고 자기 프로필 id 만 들고 돈다.
            // 살아남은 회차가 앞 프로필을 목록에서 되짚어 주지도 못한다 — 그 프로필에 표식
            // 기준선이 없으면 첫 조회로 **이미 교체된 세대를 그대로 시드**하고 강등을 건너뛴다.
            // 그러면 앞 목소리의 직접 입력 알람이 회수된 목소리를 문 채 남는다.
            val uniqueName = when {
                replacedVoiceProfileId.isNullOrBlank() -> WORK_NAME
                else -> "$REPLACED_WORK_NAME:$replacedVoiceProfileId"
            }
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                uniqueName,
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
