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
import com.alarmtalk.app.data.appVoiceLanguageOf
import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.network.AlarmTalkApiClient
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

    override suspend fun doWork(): Result {
        val session = AuthSessionStore(applicationContext).read() ?: return Result.success()
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val auth = AlarmTalkApiClient.bearer(session.token)
            val language = deviceVoiceLanguage()
            val audioStore = AlarmAudioStore(applicationContext)

            val allClips = withContext(Dispatchers.IO) { api.getStockClips(auth).clips }
            // **내가 등록한 목소리의 사전렌더 프리셋도 미리 받는다.** 등록은 서버 생성 +
            // 다운로드가 끝나야 끝난 것이고, 그래야 알람을 만들 때 라이브 생성이 필요 없다.
            // 목록을 못 받으면(네트워크 실패) 기본 목소리분만 받고 다음 회차가 보충한다.
            // ⚠ **공유받은 목소리는 넣지 않는다** — 그룹원 수만큼 곱해지는데 실제로 쓰는 것은
            // 보통 하나다. 그건 알람에서 고르는 순간 받는다.
            val ownedProfileIds = withContext(Dispatchers.IO) {
                runCatching { api.listVoiceProfiles(auth).profiles }
                    .getOrDefault(emptyList())
                    .filterNot { isSystemVoiceId(it.id) }
                    .map { it.id }
                    .toSet()
            }
            val clips = allClips.filter {
                // 클론 사전렌더는 '등록 때 고른 언어' 단일 세트라 기기 언어로 거르지 않는다 —
                // 거르면 일본어로 만든 목소리가 한국어 기기에서 한 개도 안 받아진다.
                it.targetsDefaultVoices(language) || it.voiceProfileId in ownedProfileIds
            }

            // 이미 저장한 테마 알람이 옛 언어에 묶여 있으면 지금 언어로 다시 묶는다.
            // ⚠ **성공 경로 전부에서 돌아야 한다** — 받을 게 없어 일찍 끝나는 회차(언어를
            // 바꾼 다음 실행)에도 재바인딩은 남아 있을 수 있다.
            suspend fun rebind() {
                runCatching {
                    StockClipLanguageRebinder.rebindIfLanguageChanged(
                        context = applicationContext,
                        api = api,
                        auth = auth,
                        clips = allClips,
                        language = language,
                    )
                }.onFailure { AlarmTalkLog.reportError("Stock clip language rebind failed", it) }
            }

            if (clips.isEmpty()) {
                rebind()
                return@runCatching Result.success()
            }

            val missing = clips.filter { audioStore.getCachedAudio(cacheKeyFor(it)) == null }
            setProgress(progressData(done = clips.size - missing.size, total = clips.size))
            if (missing.isEmpty()) {
                rebind()
                return@runCatching Result.success()
            }

            var done = clips.size - missing.size
            // 클립당 HTTP 왕복 1회다. 44개를 순차로 받으면 약전파에서 1분을 넘기므로 소량 병렬로
            // 겹친다(서버·기기 부담을 감안해 4로 제한).
            missing.chunked(PARALLELISM).forEach { batch ->
                coroutineScope {
                    batch.map { clip ->
                        async(Dispatchers.IO) {
                            val response = api.getTtsMessageAudio(auth, clip.messageId)
                            audioStore.cacheGeneratedAudio(
                                bytes = Base64.decode(response.audioBase64, Base64.DEFAULT),
                                format = response.audioFormat,
                                rawAudioUri = response.audioUrl,
                                displayName = cacheKeyFor(clip),
                                cacheKey = cacheKeyFor(clip),
                                messageId = clip.messageId,
                            )
                        }
                    }.awaitAll()
                }
                done += batch.size
                setProgress(progressData(done = done, total = clips.size))
            }
            rebind()
            Result.success()
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
     *  - greeting 은 APK 에 내장돼 있어 받지 않는다(res/raw, 4보이스 × 3언어).
     *  - 운세·사랑은 유료 클론 전용이라 기본 목소리로는 쓸 수 없다.
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

        /** 무료 버킷에서 실제로 회전하는 카테고리. */
        private val FREE_BUCKET_CATEGORIES = setOf("weather", "medication")

        private fun cacheKeyFor(clip: StockClip): String =
            "${AlarmAudioStore.STOCK_CACHE_KEY_PREFIX}${clip.messageId}"

        private fun progressData(done: Int, total: Int) = workDataOf(KEY_DONE to done, KEY_TOTAL to total)

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
         *  2) 없으면 성공한 것 — 한 번이라도 받아냈으면 화면을 닫아야 한다.
         *  3) 그것도 없으면 마지막 항목(=실패). 그때만 '다시 시도'를 보여준다.
         *
         * WorkInfo 는 유닛 테스트에서 만들기 어려워 상태 추출을 인자로 받는다.
         */
        internal fun <T> pickCurrent(items: List<T>, state: (T) -> WorkInfo.State): T? =
            items.firstOrNull { !state(it).isFinished }
                ?: items.lastOrNull { state(it) == WorkInfo.State.SUCCEEDED }
                ?: items.lastOrNull()
    }
}
