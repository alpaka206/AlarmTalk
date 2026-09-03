package com.alarmtalk.app.sync

import android.content.Context
import android.util.Base64
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.toPromptPreferences
import com.alarmtalk.app.data.StockClipManifestStore
import com.alarmtalk.app.data.appVoiceLanguageOf
import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.AccessSnapshotStore
import com.alarmtalk.app.AccessTicket
import com.alarmtalk.app.EntitlementWrite
import com.alarmtalk.app.EntitlementWriter
import com.alarmtalk.app.isEntitledOptimistic
import com.alarmtalk.app.resolvePaidVoiceAccess
import com.alarmtalk.app.storeSignalStillValid
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.StockClip
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext

/**
 * 기본(시스템) 목소리 알람 클립을 기기에 내려받는 워커.
 *
 * ViewModel 스코프에서 돌리던 것을 WorkManager 로 옮겼다. 예전에는 "이 화면을 닫아도
 * 백그라운드에서 계속돼요"라고 안내하면서 실제로는 앱을 종료하면 끊겼다 — 화면 스코프에
 * 묶여 있었기 때문이다. 이제 진짜로 계속되고, 실패하면 네트워크가 돌아왔을 때 재시도한다.
 *
 * 이어받기: 이미 캐시된 클립은 건너뛰므로 몇 번을 다시 돌려도 빠진 것만 받는다. 완료 판정도
 * **로컬 파일 존재**로 한다 — 계정이 아니라 기기에 종속된 캐시라서, 로그아웃 후 다시
 * 로그인하면 재다운로드하지 않고 다른 기기로 로그인하면 그 기기가 새로 받는다.
 */
class StockClipPrefetchWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    /**
     * 받는 동안 **진행률을 폰에서 바로 보이게** 한다.
     *
     * ⚠ 소리 없는 낮은 중요도 채널이다 — 사용자가 요청한 알림이 아니라 표시일 뿐이라
     * 소리를 내면 방해가 된다. iOS 는 갱신되는 진행률 알림이 없어 Live Activity 로 같은
     * 일을 한다(docs/spec/voice-and-message.md).
     */
    private fun progressNotification(done: Int, total: Int): androidx.core.app.NotificationCompat.Builder {
        val percent = if (total > 0) (done * 100 / total).coerceIn(0, 100) else 0
        return androidx.core.app.NotificationCompat.Builder(
            applicationContext,
            com.alarmtalk.app.alarm.NotificationChannels.CLIP_PREFETCH_CHANNEL_ID,
        )
            .setSmallIcon(com.alarmtalk.app.R.drawable.ic_alarm_24)
            .setContentTitle(applicationContext.getString(com.alarmtalk.app.R.string.clip_prefetch_notification_title))
            .setContentText("$percent%")
            .setProgress(100, percent, total <= 0)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_LOW)
    }

    private fun foregroundInfo(done: Int, total: Int): androidx.work.ForegroundInfo =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            androidx.work.ForegroundInfo(
                CLIP_PREFETCH_NOTIFICATION_ID,
                progressNotification(done, total).build(),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            androidx.work.ForegroundInfo(CLIP_PREFETCH_NOTIFICATION_ID, progressNotification(done, total).build())
        }

    override suspend fun getForegroundInfo(): androidx.work.ForegroundInfo = foregroundInfo(0, 0)

    /**
     * 진행률을 알림에도 반영한다. 실패해도 다운로드는 계속한다 — 알림 권한이 없거나
     * 포그라운드 승격이 막혀도(백그라운드 제한) **받는 일 자체를 멈추면 안 된다.**
     */
    private suspend fun publishProgress(done: Int, total: Int) {
        setProgress(progressData(done = done, total = total))
        runCatching { setForeground(foregroundInfo(done, total)) }
    }

    override suspend fun doWork(): Result = try {
        StockReplacementStatus.setWorking(true)
        runWork()
    } finally {
        StockReplacementStatus.setWorking(false)
    }

    private suspend fun runWork(): Result {
        val sessionStore = AuthSessionStore(applicationContext)
        // ⚠ **세대를 세션보다 먼저 읽는다**(2026-09-01 리뷰). 순서가 반대면 두 줄 사이의
        // A→B 전환에서 **세션은 A, 세대는 B** 가 잡혀, 나중의 `saveTokenIfGeneration` 이
        // 통과해 **B 의 토큰을 A 것으로 갈아 끼운다** — 화면은 B 인데 요청은 A 로 나가는
        // 섞인 세션이 된다. 이 순서면 반대로 세대가 옛것이라 저장이 거부돼 안전하게 실패한다.
        val startGeneration = sessionStore.sessionGeneration()
        val session = sessionStore.read() ?: return Result.success()
        // 권한 스냅샷은 문 하나로만 쓴다(`EntitlementWriter`).
        val entitlement = EntitlementWriter(applicationContext)
        val ticket = AccessTicket(session.user.id, startGeneration)
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val auth = AlarmTalkApiClient.bearer(session.token)
            val language = deviceVoiceLanguage()
            val audioStore = AlarmAudioStore(applicationContext)

            // ⚠ **받은 매니페스트를 먼저 공개한다**(Codex #703 P1). 캐시 쓰기 경로는 디스크
            // 매니페스트를 '지금 무엇이 맞는가' 의 기준으로 삼는데(뒤처진 응답이 새 세대를
            // 덮지 못하게 하는 가드), 이 워커가 새 매니페스트를 받아 놓고 공개하지 않으면
            // 그 기준이 **옛 주소**로 남는다 — 방금 받은 새 바이트가 '지나간 응답' 으로 판정돼
            // 버려지고, 워커는 성공으로 끝나 교체 표식이 확정된다. 결과는 회수된 목소리가
            // 그대로 남는 것이다.
            // 표를 **요청 전에** 뽑는다 — 그래야 늦게 끝난 옛 요청이 거절된다.
            val manifestTicket = StockClipManifestStore.beginFetch()
            val manifest = withContext(Dispatchers.IO) { api.getStockClips(auth) }
            when (StockClipManifestStore.save(applicationContext, manifest, manifestTicket, session.user.id)) {
                // 더 새 매니페스트가 이미 나왔다 — 이 회차의 목록으로 캐시를 갈아 끼우면 그
                // 새 세대를 옛 바이트로 덮는다. 물러나면 그쪽이 이어서 한다.
                StockClipManifestStore.PublishResult.SUPERSEDED ->
                    return@runCatching Result.success()
                // ⚠ **디스크 쓰기 실패는 물러날 일이 아니다**(Codex #703 P1). 아무도 새
                // 권위를 공개하지 못한 상태라, 여기서 성공으로 끝내면 완료 푸시를 놓친 기기에
                // 회수된 프리셋을 갈아 끼울 폴백이 남지 않는다. 다시 온다.
                StockClipManifestStore.PublishResult.FAILED -> return@runCatching Result.retry()
                StockClipManifestStore.PublishResult.PUBLISHED -> Unit
            }
            val allClips = manifest.clips
            // **내가 등록한 목소리의 사전렌더 프리셋도 미리 받는다.** 등록은 서버 생성 +
            // 다운로드가 끝나야 끝난 것이고, 그래야 알람을 만들 때 라이브 생성이 필요 없다.
            // 목록을 못 받으면(네트워크 실패) 기본 목소리분만 받고 다음 회차가 보충한다.
            // ⚠ **공유받은 목소리는 넣지 않는다** — 그룹원 수만큼 곱해지는데 실제로 쓰는 것은
            // 보통 하나다. 그건 알람에서 고르는 순간 받는다.
            // ⚠ **무료면 내 클론 클립은 아예 요청하지 않는다**(2026-08-31 실기기 재현).
            // 무료 계정에도 예전에 만든 클론의 프리셋 클립이 매니페스트에 남아 있는데, 서버는
            // 그걸 403 으로 막는다(유료 전용). 요청해 봐야 못 받을 뿐 아니라, 그 실패가 같은
            // 배치의 **무료 스톡 클립까지 끌고 죽었다** — 날씨·약 클립이 안 받아져 알람이
            // 라이브 생성으로 넘어가고, 사용자는 "유료 이용권에서 사용할 수 있어요" 를 봤다.
            // (배치 격리는 아래에서 따로 고쳤지만, 애초에 보내지 않는 게 맞다.)
            // 플랜을 못 읽으면(네트워크 실패) **받는 쪽으로** 둔다 — 유료 사용자가 자기 클립을
            // 못 받는 것이 더 나쁘고, 무료면 그 요청만 403 으로 조용히 걸러진다.
            // ⚠ **구독 행만 보면 보류를 놓친다**(2026-09-01 리뷰). 서버는 결제 보류에서
            // 행을 남긴 채 `users.plan` 만 회수하므로, `hasPaidVoiceAccess`(status·plan key)
            // 만 보면 권한이 없는 사용자의 클론 클립을 그대로 요청한다 — 403
            // (`VOICE_LOCKED_FREE_PLAN`)을 받고 재시도를 소진한 끝에 FAILED 로 끝난다.
            // 울림 게이트와 **같은 판정기**로 판단한다.
            // ⚠ **서버 프로필의 조건 설정을 들고 나온다**(2026-09-03 리뷰 16차).
            //   새로 깐 기기·두 번째 기기에서는 이 값이 서버에만 있고 로컬 저장소는 비어
            //   있다. 바로 아래에서 `/auth/me` 를 받으면서 그걸 버리면, 받은 날씨 알람은
            //   여전히 서버 기본값(서울)으로, 운세는 빈 프로필 해시로 떨어진다.
            var serverPromptSettings: com.alarmtalk.app.network.DynamicPromptSettings? = null
            val paidVoiceAccess = withContext(Dispatchers.IO) {
                runCatching {
                    val subscription = api.getSubscription(auth)
                    // ⚠ **plan 은 캐시가 아니라 서버에서 지금 받는다**(2026-09-01 리뷰).
                    // 회복 방향이 문제다: 보류가 풀려 구독이 살아났는데 스냅샷의 `userPlan` 은
                    // 아직 보류 때 확인한 `free` 다. 이 워커는 콜드 스타트에서 `/auth/me`
                    // 갱신과 경주하므로, 캐시를 읽으면 그 옛 free 가 **살아 있는 구독을 이겨**
                    // 돈 내는 사용자의 클론 클립을 하나도 안 받는다. 게다가 이 작업은
                    // `ExistingWorkPolicy.KEEP` 이라 뒤이은 재큐잉이 버려져 그 회차가 그대로 굳는다.
                    val me = api.me(auth)
                    val plan = me.user.plan
                    serverPromptSettings = me.user.dynamicPromptSettings
                    // ⚠ **굴러온 토큰을 버리지 않는다**(2026-09-01 리뷰). 이 워커는 배경에서
                    // 도는 일이 있어(예: `voice_changed` FCM) 그때는 이 요청이 **그 실행의
                    // 유일한 세션 갱신**이다. 버리면 앱이 전경으로 오기 전에 저장된 JWT 가
                    // 죽고, 이후 프리페치·동기화가 그 옛 토큰으로 401 만 받는다.
                    // **검사와 저장을 한 덩어리로** 한다 — 따로 하면 그 사이 로그아웃이
                    // 끼어들어 비운 저장소에 세션을 되쓴다(`PlanChangeSyncWorker` 와 같은 이유).
                    me.token?.takeIf { it.isNotBlank() }?.let { rolled ->
                        sessionStore.saveTokenIfGeneration(startGeneration, rolled)
                    }
                    val snapshotStore = AccessSnapshotStore(applicationContext)
                    // ⚠ **받았으면 적는다**(2026-09-01 리뷰). 스펙이 "`/auth/me` 로 plan 을
                    // 받아 온 경로는 **전부** 스냅샷에 적는다" 로 못 박은 자리다 — 여기서
                    // 판정에만 쓰고 버리면, 같이 도는 세션 갱신이 실패했을 때 `RingingService`
                    // 가 계속 옛 free 를 읽어 **회복된 유료 사용자의 클론 오디오를 막는다.**
                    // 문이 세대·계정을 함께 본다 — 조회 중 로그아웃·재로그인이 있었으면
                    // 이 값은 옛 회차의 것이라 거절된다.
                    // ⚠ **거절되면 이 회차는 옛 세션의 것이다**(2026-09-02 리뷰). 아래
                    //   판정이 스냅샷이 아니라 **로컬 `plan` 변수**를 그대로 쓰므로, 결과를
                    //   안 보면 문이 버린 값이 그대로 선다운로드 여부를 정한다.
                    //   낙관 기본값으로 물러난다 — 선다운로드는 더 받아도 손해가 없고,
                    //   덜 받으면 오프라인에서 소리가 안 난다.
                    if (entitlement.write(ticket, "prefetch plan") { it.copy(userPlan = plan) }
                        != EntitlementWrite.Applied
                    ) {
                        return@runCatching true
                    }
                    val snapshot = snapshotStore.read(session.user.id)
                    val now = System.currentTimeMillis()
                    resolvePaidVoiceAccess(
                        subscriptionResponse = subscription,
                        familyGroup = snapshot.familyGroup,
                        userPlan = plan,
                        storeEntitled = snapshot.storeSignalStillValid(now),
                        nowMillis = now,
                    ).isEntitledOptimistic()
                }.getOrDefault(true)
            }
            val ownedProfileIds = if (!paidVoiceAccess) {
                emptySet()
            } else {
                withContext(Dispatchers.IO) {
                    runCatching { api.listVoiceProfiles(auth).profiles }
                        .getOrDefault(emptyList())
                        .filterNot { isSystemVoiceId(it.id) }
                        .map { it.id }
                        .toSet()
                }
            }
            val clips = allClips.filter {
                val isDefaultVoiceClip = it.targetsDefaultVoices(language)
                // 클론 사전렌더는 '등록 때 고른 언어' 단일 세트라 기기 언어로 거르지 않는다 —
                // 거르면 일본어로 만든 목소리가 한국어 기기에서 한 개도 안 받아진다.
                val isOwnedCloneClip = it.voiceProfileId in ownedProfileIds
                // ⚠ **무료면 스테일 갱신도 기본 목소리 것만 한다**(2026-08-31 리뷰).
                // `ownedProfileIds` 를 비우는 것만으로는 부족하다 — 강등 전에 받아 둔 클론
                // 클립의 `audio_url` 이 바뀌면 이 갈래가 그 클립을 **도로 끌어온다.** 서버는
                // 무료의 클론 오디오를 403(`VOICE_LOCKED_FREE_PLAN`)으로 막으므로, 쓸 수 있는
                // 시스템 클립을 다 받고도 그 하나 때문에 재시도를 소진하고 FAILED 로 끝난다.
                val staleNeedsRefresh = (paidVoiceAccess || isDefaultVoiceClip) &&
                    AlarmAudioStore.messageCacheKeys(it.messageId).any { key ->
                        audioStore.isCachedAudioStale(key, it.audioUrl)
                    }
                isDefaultVoiceClip || isOwnedCloneClip || staleNeedsRefresh
            }

            // 이미 저장한 테마 알람이 옛 언어에 묶여 있으면 지금 언어로 다시 묶는다.
            // ⚠ **성공 경로 전부에서 돌아야 한다** — 받을 게 없어 일찍 끝나는 회차(언어를
            // 바꾼 다음 실행)에도 재바인딩은 남아 있을 수 있다.
            // ⚠ **한 번만 만들어 아래 두 곳이 같은 답을 보게 한다.** 재바인딩과 정리가
            //   서로 다른 힌트로 판정하면, 정리가 "갈아탈 것이 없다" 로 읽고 아직 옛 클립을
            //   문 알람의 파일을 지운다 — 그 알람은 무음이 된다.
            val legacyHints = manifest.legacyBucketHints
                .associate { hint -> hint.messageId to hint.category }
            // 받는 사람의 지역·사주. 조건형 버킷(날씨·운세)을 묶을 때 빈 자리에만 채운다 —
            // 받은 알람은 그 값이 전부 비어 있어서, 안 채우면 날씨는 서버 기본값(서울),
            // 운세는 빈 프로필 해시로 떨어진다.
            //
            // ⚠ **서버가 먼저, 로컬은 폴백이다**(리뷰 16차). 새로 깐 기기·두 번째 기기는
            //   로컬 저장소가 비어 있고 값이 서버에만 있다. 편집기의 `savedPromptPreferences`
            //   (iOS)와 **같은 순서**다 — 한쪽만 서버를 보면 기기마다 답이 달라진다.
            val localPrompts = com.alarmtalk.app.data.DynamicPromptPreferenceStore(applicationContext)
                .read(session.user.id)
            val serverPrompts = serverPromptSettings?.toPromptPreferences()
            val conditionInputs = when {
                serverPrompts == null -> localPrompts
                serverPrompts == com.alarmtalk.app.data.DynamicPromptPreferences() -> localPrompts
                else -> serverPrompts
            }

            suspend fun rebind() {
                runCatching {
                    StockClipLanguageRebinder.rebindIfLanguageChanged(
                        context = applicationContext,
                        api = api,
                        auth = auth,
                        clips = allClips,
                        language = language,
                        // 부분 세트로 갈아타지 않도록 완전성 판정에 쓴다.
                        expectedVariants = manifest.expectedVariants,
                        legacyHints = legacyHints,
                        conditionInputs = conditionInputs,
                        callerUserId = session.user.id,
                    )
                }.onFailure { AlarmTalkLog.reportError("Stock clip language rebind failed", it) }
                // 라이브 랜덤 생성으로 저장된 옛 알람을 테마 클립으로 옮긴다.
                // ⚠ **위와 따로 잡는다** — 언어 재바인딩이 실패해도 이건 돌아야 한다.
                // 둘 다 멱등이라 매 회차 돌아도 안전하고, 묶을 클립이 없으면 아무 일도
                // 하지 않고 다음 회차에 다시 시도한다.
                runCatching {
                    StockClipLanguageRebinder.rebindLiveGenerationRows(
                        context = applicationContext,
                        api = api,
                        auth = auth,
                        clips = allClips,
                        language = language,
                        expectedVariants = manifest.expectedVariants,
                        callerUserId = session.user.id,
                    )
                }.onFailure { AlarmTalkLog.reportError("Legacy live-generation rebind failed", it) }
                // ⚠ **지우는 것은 언제나 맨 마지막이다**(2026-09-03 지시).
                //   위 두 재바인딩이 끝난 **뒤에만** 옛 스톡 클립 파일을 정리한다. 아직
                //   갈아탈 알람이 남아 있으면 함수가 스스로 0을 돌려주고 미룬다 —
                //   중간에 멈추면 지운 것이 없으므로 잃는 것도 없고, 다음 회차가 처음부터
                //   다시 판단한다(멱등).
                runCatching {
                    StockClipLanguageRebinder.pruneReplacedStockAudio(
                        context = applicationContext,
                        clips = allClips,
                        language = language,
                        expectedVariants = manifest.expectedVariants,
                        // ⚠ **재바인딩과 같은 힌트를 넘긴다.** 여기만 힌트 없이 물으면
                        //   아직 갈아타지 않은 알람을 두고 파일을 지운다.
                        legacyHints = legacyHints,
                        callerUserId = session.user.id,
                    )
                }.onFailure { AlarmTalkLog.reportError("Replaced stock audio prune failed", it) }
                // ⚠ **삭제 결과는 보지 않는다**(2026-09-03 지시). 여기까지 왔으면 받기와
                //   묶기는 끝났고, 파일 정리가 실패해도 서비스는 정상이다 — 그걸로 화면을
                //   막으면 지울 것이 없는 사용자를 이유 없이 가둔다.
                runCatching {
                    // ⚠⚠ **이 회차가 아직 '지금 계정' 의 것인지 확인하고 적는다**
                    //   (2026-09-03 리뷰 18차). 이 작업은 `WORK_NAME` 하나에 `KEEP` 이라,
                    //   A 의 실행 중에 B 가 로그인하면 **B 의 enqueue 가 버려진다.** 그런데
                    //   이 실행은 계속 A 로 스코프돼 있고 상태는 **프로세스 전역**이다 —
                    //   A 의 결과로 B 를 가두거나(true), B 의 옛 알람을 갈아타지도 못한 채
                    //   문을 열어 준다(false).
                    //   계정이 바뀌었으면 **적지 않고**, B 를 위해 다시 큐에 넣는다.
                    val current = AuthSessionStore(applicationContext).read()
                    val stillSameAccount = current?.user?.id == session.user.id &&
                        sessionStore.sessionGeneration() == startGeneration
                    if (stillSameAccount) {
                        StockReplacementStatus.report(
                            userId = session.user.id,
                            pending = StockClipLanguageRebinder.hasPendingReplacement(
                                context = applicationContext,
                                clips = allClips,
                                language = language,
                                // 이 자리는 매니페스트를 **받은 뒤**다 — 비어 있어도 그건
                                // '성공적으로 빈 카탈로그'(은퇴 직후 게시 전)라 미완료다.
                                manifestFetched = true,
                                legacyHints = legacyHints,
                                callerUserId = session.user.id,
                            ),
                            // 못 받았으면 앞 판정을 지킨다 — `report` 가 스스로 막는다.
                            manifestFetched = true,
                        )
                    } else {
                        // 이 실행이 끝나야 유니크 작업 자리가 비므로, 여기서 넣으면
                        // 새 계정의 회차가 확실히 잡힌다.
                        enqueue(applicationContext)
                    }
                }.onFailure { AlarmTalkLog.reportError("Stock replacement status probe failed", it) }
            }

            if (clips.isEmpty()) {
                rebind()
                return@runCatching Result.success()
            }

            val missing = clips.mapNotNull { clip ->
                val prefetchStock = clip.targetsDefaultVoices(language) || clip.voiceProfileId in ownedProfileIds
                val keys = AlarmAudioStore.messageCacheKeys(clip.messageId).filter { key ->
                    audioStore.isCachedAudioStale(key, clip.audioUrl) ||
                        (prefetchStock && key == cacheKeyFor(clip) &&
                            audioStore.getCachedAudio(key, clip.audioUrl) == null)
                }
                keys.takeIf { it.isNotEmpty() }?.let { clip to it }
            }
            publishProgress(done = clips.size - missing.size, total = clips.size)
            if (missing.isEmpty()) {
                rebind()
                return@runCatching Result.success()
            }

            var done = clips.size - missing.size
            // ⚠ **격리는 하되 실패를 삼키지는 않는다**(2026-08-31 리뷰). 클립별로 예외를 잡아
            // 형제 요청을 살리는 것과, 그 회차를 '성공' 으로 보고하는 것은 다른 문제다.
            // 성공으로 끝내면 WorkManager 가 백오프 재시도를 걸지 않아, 약전파에서 한두 개를
            // 놓친 채 **완료로 굳는다** — 준비 화면은 100% 를 보여주는데 오프라인 음원은 없다.
            val failures = java.util.concurrent.atomic.AtomicInteger(0)
            // 그중 **다시 해 볼 만한** 실패 수. 0 이면 재시도가 의미 없다(위 when 참조).
            val transientFailures = java.util.concurrent.atomic.AtomicInteger(0)
            // 클립당 HTTP 왕복 1회다. 44개를 순차로 받으면 약전파에서 1분을 넘기므로 소량 병렬로
            // 겹친다(서버·기기 부담을 감안해 4로 제한).
            missing.chunked(PARALLELISM).forEach { batch ->
                coroutineScope {
                    batch.map { (clip, cacheKeys) ->
                        async(Dispatchers.IO) {
                            // ⚠ **한 클립의 실패가 배치를 죽이지 않게 한다**(2026-08-31).
                            // 예전에는 여기서 던진 예외가 `coroutineScope` 를 취소해 **같은
                            // 배치의 나머지 요청까지 Canceled** 로 끝났다. 접근 권한이 없는
                            // 클립 하나(무료 계정에 남은 클론 프리셋 → 403) 때문에 날씨·약
                            // 스톡 클립이 통째로 안 받아졌다. 못 받은 것은 다음 회차가 보충한다.
                            runCatching {
                                val response = api.getTtsMessageAudio(auth, clip.messageId)
                                val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                                cacheKeys.forEach { key ->
                                    audioStore.cacheGeneratedAudio(
                                        bytes = bytes,
                                        format = response.audioFormat,
                                        rawAudioUri = response.audioUrl,
                                        displayName = key,
                                        cacheKey = key,
                                        messageId = clip.messageId,
                                    )
                                }
                            }.onFailure { error ->
                                failures.incrementAndGet()
                                // ⚠ **영구 실패는 종류까지 기억한다**(2026-09-01 리뷰). 개수만
                                // 세면 404 같은 재시도 불가 실패도 아래에서 `retry` 로 나가,
                                // 될 리 없는 요청을 15분쯤 반복하는 동안 준비 화면이 계속
                                // '받는 중' 으로 남고 '다시 시도' 는 끝내 안 뜬다.
                                // (바깥 catch 는 이미 `isPermanent()` 로 가르고 있었는데,
                                // 클립별로 삼키면서 그 분류에 닿지 못했다.)
                                if (!error.isPermanent()) transientFailures.incrementAndGet()
                                AlarmTalkLog.reportError(
                                    "Stock clip download failed messageId=${clip.messageId}",
                                    error,
                                )
                            }
                        }
                    }.awaitAll()
                }
                done += batch.size
                publishProgress(done = done, total = clips.size)
            }
            rebind()
            // 하나라도 못 받았으면 이 회차는 끝난 것이 아니다 — 다음 회차가 나머지만 받는다
            // (이미 받은 파일은 캐시에 남아 `missing` 계산에서 빠진다).
            //
            // ⚠ **재시도를 다 쓰면 `success` 가 아니라 `failure` 다**(2026-08-31 리뷰).
            // `done` 은 실패한 클립까지 세므로 성공으로 끝내면 WorkManager 가 **100%
            // SUCCEEDED** 를 내보낸다 — 준비 화면은 캐시가 하나라도 있으면 닫히고, FAILED
            // 상태에서만 뜨는 '다시 시도' 를 영영 못 보여준다. 못 받은 클립은 다른 계기가
            // 큐를 다시 넣을 때까지 빈 채로 남는다. 아래 catch 의 종료 규칙과 같은 결론이다.
            when {
                failures.get() == 0 -> Result.success()
                // 실패가 **전부 영구**면 재시도해 봐야 같은 결과다 — 곧바로 FAILED 로 끝내
                // 준비 화면이 '다시 시도' 를 띄우게 한다.
                transientFailures.get() == 0 -> Result.failure()
                runAttemptCount < MAX_RUN_ATTEMPTS -> Result.retry()
                else -> Result.failure()
            }
        }.getOrElse { error ->
            // 부분 성공은 그대로 남는다(이미 받은 파일은 캐시에 있다) — 재시도가 나머지만 받는다.
            AlarmTalkLog.reportError("Stock clip prefetch failed", error)
            // 영구 실패(스테일 매니페스트가 없는 메시지를 가리킴, 재시도 불가 4xx 등)까지
            // retry 로 돌리면 유니크 작업이 큐에 영원히 남아 네트워크만 먹고, 다운로드 화면이
            // 기다리는 FAILED 상태가 끝내 오지 않아 '다시 시도' 버튼도 뜨지 않는다.
            when {
                error.isPermanent() -> Result.failure()
                runAttemptCount >= MAX_RUN_ATTEMPTS -> Result.failure()
                else -> Result.retry()
            }
        }
    }

    /**
     * 다시 시도해도 결과가 같은 실패인지. 4xx 는 요청·상태 자체가 잘못된 것이라 재시도가
     * 의미 없다(단 408 요청시간초과·429 요청과다는 시간이 지나면 풀리므로 제외).
     * 파싱/디코딩 실패도 같은 응답을 다시 받아봐야 같은 결과다.
     */
    /**
     * 재시도해도 소용없는 실패인가.
     *
     * 403 은 예외다. 로그인 직후에는 아직 동의 전이라 서버가 모든 데이터 라우트를
     * CONSENT_REQUIRED(403) 로 막는데, 이건 사용자가 동의를 마치면 곧 풀리는 **일시적**
     * 상태다. 영구 실패로 보면 워커가 즉시 포기해, 동의를 마치고 목소리 준비 화면에
     * 도착한 사용자에게 '목소리를 받지 못했어요' 만 남는다(네트워크는 멀쩡한데도).
     */
    private fun Throwable.isPermanent(): Boolean = when (this) {
        is retrofit2.HttpException ->
            code() in 400..499 && code() != 403 && code() != 408 && code() != 429
        is IllegalArgumentException -> true // Base64.decode 등 응답 형식 오류
        else -> false
    }

    private fun deviceVoiceLanguage(): String {
        val locales = applicationContext.resources.configuration.locales
        return appVoiceLanguageOf((if (!locales.isEmpty) locales[0] else null)?.language)
    }

    /**
     * 받을 대상: 기본 목소리 × 기기 언어 × 무료 버킷 카테고리.
     *  - 언어를 하나로 좁힌다. 3개 언어를 다 받으면 약 3배(≈30MB)인데 앱은 한 번에 한 언어만
     *    쓰고, 언어를 바꾸면 이 워커가 다시 돌아 부족분을 채운다.
     *  - **고를 수 있는 카테고리를 전부 받는다**(2026-09-02). 기본 목소리도 운세·사랑을
     *    고를 수 있게 되면서(`docs/spec/voice-and-message.md` §2), 안 받는 종류가 있으면
     *    **고를 수는 있는데 오프라인에서 소리가 안 나는** 알람이 생긴다.
     *  - greeting 은 받지 않는다 — 알람 테마가 아니고(§2), 미리듣기용은 APK 에 내장돼 있다.
     */
    private fun StockClip.targetsDefaultVoices(language: String): Boolean =
        isSystemVoiceId(voiceProfileId) &&
            (this.language ?: "ko") == language &&
            category in FREE_BUCKET_CATEGORIES

    companion object {
        private const val WORK_NAME = "stock_clip_prefetch"
        private const val PARALLELISM = 4

        /**
         * 일시적 실패로 보고 다시 시도할 최대 횟수. BackoffPolicy.LINEAR 30초 기준으로
         * 30s → 60s → ... 대략 15분 안에 6번 시도하고 포기한다. 포기해도 잃는 것은 없다 —
         * 앱을 다시 열거나 언어를 바꾸면 enqueue 가 다시 걸리고, 편집기의 온디맨드
         * 다운로드가 폴백으로 남는다.
         */
        private const val MAX_RUN_ATTEMPTS = 6

        const val KEY_DONE = "done"
        const val KEY_TOTAL = "total"

        /**
         * 선다운로드 대상 카테고리.
         *
         * ⚠ **손으로 적지 않는다**(2026-09-02). 여기가 `setOf("weather","medication")` 로
         * 박혀 있어서, 편집기 목록에 카테고리를 더해도 **그 클립만 안 받는** 상태가 됐다 —
         * 고를 수는 있는데 오프라인에서 소리가 안 나는 종류가 생긴다. 목록이 늘면 받는
         * 것도 같이 늘어야 하므로 [FreeBucketOrder] 하나에서 유도한다.
         */
        private val FREE_BUCKET_CATEGORIES: Set<String> =
            com.alarmtalk.app.FreeBucketOrder.toSet()

        private fun cacheKeyFor(clip: StockClip): String =
            "${AlarmAudioStore.STOCK_CACHE_KEY_PREFIX}${clip.messageId}"

        private fun progressData(done: Int, total: Int) = workDataOf(KEY_DONE to done, KEY_TOTAL to total)

        /** 진행률 알림 id. 알람 알림들과 겹치지 않는 고정값. */
        private const val CLIP_PREFETCH_NOTIFICATION_ID = 7311

        private val networkConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /**
         * 다운로드를 큐잉한다. 이미 돌고 있으면 그대로 두고(KEEP) 새로 만들지 않는다 —
         * 화면을 나갔다 다시 들어와도 진행이 끊기거나 처음부터 다시 받지 않게.
         */
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<StockClipPrefetchWorker>()
                .setConstraints(networkConstraints)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }

        /**
         * 진행 상황 구독 — 다운로드 화면이 이 값으로 로딩을 그린다.
         *
         * 유니크 작업 '이력'이 오므로 실패 후 재시도를 걸면 끝난 예전 항목과 새 항목이
         * 같이 들어온다. 목록을 그대로 넘기면 화면이 firstOrNull() 로 옛 FAILED 를 붙잡아
         * 재시도가 도는 중에도 실패 화면에 머물 수 있어, 여기서 하나로 줄여 넘긴다.
         */
        fun observe(context: Context): Flow<WorkInfo?> =
            WorkManager.getInstance(context.applicationContext)
                .getWorkInfosForUniqueWorkFlow(WORK_NAME)
                .map { infos -> pickCurrent(infos) { it.state } }

        /**
         * 이력 중 '지금 화면이 봐야 할' 하나를 고른다.
         *  1) 아직 안 끝난 것(RUNNING/ENQUEUED/BLOCKED) — 재시도가 돌고 있으면 그게 현재다.
         *  2) 없으면 **가장 최근에 끝난 것**. 성공이든 실패든 그게 지금 상태다.
         *
         * ⚠ **'성공이 하나라도 있으면 성공'** 으로 두지 말 것(2026-09-01 리뷰). 매니페스트가
         * 바뀌어 영구 실패(404)가 생기면 **옛 성공이 그 실패를 영영 가린다** — 준비 화면은
         * 닫히거나 성공으로 남고, 그 실패를 위해 만든 '다시 시도' 가 끝내 뜨지 않는다.
         * 옛 FAILED 가 새 실행을 가리는 문제는 1)이 이미 막는다(재시도는 안 끝난 상태다).
         *
         * WorkInfo 는 유닛 테스트에서 만들기 어려워 상태 추출을 인자로 받는다.
         */
        internal fun <T> pickCurrent(items: List<T>, state: (T) -> WorkInfo.State): T? =
            items.firstOrNull { !state(it).isFinished }
                ?: items.lastOrNull()
    }
}
