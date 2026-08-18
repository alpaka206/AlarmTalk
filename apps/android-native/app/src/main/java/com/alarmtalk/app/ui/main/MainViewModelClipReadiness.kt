package com.alarmtalk.app

import android.app.Application
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.ClipReadiness
import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.network.AlarmTalkApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 준비 페이지와 편집기 관문이 볼 **상태**. 계산은 [ClipReadiness] 가 하고, 여기서는 그
 * 계산에 넣을 입력(매니페스트·캐시·렌더 상태)을 모은다.
 *
 * iOS `ClipReadinessModel.swift` 와 같은 역할이고 같은 규칙이다.
 *
 * ⚠ **이 값으로 알람 만들기를 막지 말 것.** 100% 가 아니어도 알람은 만들 수 있어야 한다
 * (오프라인에서 내일 알람을 못 맞추면 안 된다 — docs/spec/voice-and-message.md).
 * 막는 것은 목소리 등록과, 아직 못 받은 **그 목소리를 고르는 것**뿐이다.
 */
internal suspend fun MainViewModel.refreshClipReadiness() {
    val session = authSession ?: return
    val auth = AlarmTalkApiClient.bearer(session.token)

    val response = runCatching { withContext(Dispatchers.IO) { api.getStockClips(auth) } }
        .getOrElse {
            // 못 물어봤다고 '준비 안 됨' 으로 뒤집지 않는다 — 이미 계산해 둔 값을 유지한다.
            AlarmTalkLog.reportError("Clip manifest unavailable; keeping the previous readiness", it)
            return
        }
    val clips = response.clips
    stockClips = clips
    response.expectedVariants?.let { expectedVariants = it }

    val owned = voiceProfiles.map { it.id }.filterNot { isSystemVoiceId(it) }

    // 클론은 서버가 아직 만드는 중일 수 있다. 매니페스트에는 없지만 **기다려야 하는 몫**이라
    // 진행률에 반영해야 한다 — 빼면 '0개 중 0개' 라 100% 로 보인다.
    val renderStates = owned.associateWith { voiceId ->
        val status = runCatching {
            withContext(Dispatchers.IO) { api.getVoicePrerenderStatus(auth, voiceId) }
        }.getOrNull()?.status
        when (status) {
            "pending" -> true to false
            "failed" -> false to true
            else -> false to false
        }
    }

    val audioStore = AlarmAudioStore(getApplication<Application>())
    val systemVoiceIds = clips.map { it.voiceProfileId }.filter { isSystemVoiceId(it) }.distinct().sorted()
    // 카테고리도 매니페스트에서 나온다 — 앱에 목록을 박으면 운영이 카테고리를 추가했을 때
    // 그 몫이 진행률에서 통째로 빠진다.
    val categoriesByVoice = clips.groupBy { it.voiceProfileId }
        .mapValues { (_, list) -> list.mapNotNull { it.category }.distinct().sorted() }

    clipReadiness = withContext(Dispatchers.IO) {
        ClipReadiness.evaluate(
            voiceProfileIds = systemVoiceIds + owned.sorted(),
            clips = clips,
            expectedVariants = expectedVariants,
            isSystemVoice = { isSystemVoiceId(it) },
            categoriesFor = { voiceId ->
                val all = categoriesByVoice[voiceId].orEmpty()
                // 기본 목소리는 무료 테마만 쓴다(greeting 은 미리듣기 전용이라 알람에 안 쓴다).
                if (isSystemVoiceId(voiceId)) all.filter { it in FREE_BUCKET_CATEGORIES } else all
            },
            renderState = { renderStates[it] ?: (false to false) },
            isCached = { clip ->
                audioStore.getCachedAudio("${AlarmAudioStore.STOCK_CACHE_KEY_PREFIX}${clip.messageId}") != null
            },
        )
    }
}

/**
 * 서버 생성이 실패한 목소리를 다시 큐에 올린다. 다운로드 실패는 선다운로드가 다음 회차에
 * 부족분만 다시 받으므로 별도 처리가 필요 없다.
 */
internal suspend fun MainViewModel.retryFailedClipRenders() {
    val session = authSession ?: return
    val auth = AlarmTalkApiClient.bearer(session.token)
    clipReadiness.filter { it.renderFailed }.forEach { voice ->
        runCatching { withContext(Dispatchers.IO) { api.retryVoicePrerender(auth, voice.voiceProfileId) } }
    }
    refreshClipReadiness()
}

/** 기본 목소리가 알람에 쓰는 테마. `StockClipPrefetchWorker.FREE_BUCKET_CATEGORIES` 와 같아야 한다. */
private val FREE_BUCKET_CATEGORIES = setOf("weather", "medication")
