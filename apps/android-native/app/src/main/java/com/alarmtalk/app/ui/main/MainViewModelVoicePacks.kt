package com.alarmtalk.app

import android.app.Application
import android.util.Base64
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.HeldVoicePack
import com.alarmtalk.app.data.sha256Hex
import com.alarmtalk.app.data.voicePackCacheKey
import com.alarmtalk.app.data.voicePackRemoteIdentity
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.VoicePackSummary
import com.alarmtalk.app.sync.StockClipPrefetchWorker
import com.alarmtalk.app.sync.VoicePackDownloader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * 추가 음성팩 — 목소리 탭·편집기 쪽(`docs/spec/voice-packs.md` §5·§7). 받는 일은 선다운로드 워커의 팩 칸
 * (`VoicePackDownloader`)이 하고, 여기는 목록·받기 시작·지우기·미리듣기 샘플·기한 지난 팩 대체를 부른다.
 */

/** 받은 팩 목록을 저장소에서 다시 읽는다 — 저장소 변화 신호(`VoicePackStore.changes`)·계정 전환 때. */
internal fun MainViewModel.refreshHeldVoicePacks() {
    heldVoicePacks = voicePackStore.held(authSession?.user?.id)
}

/**
 * 카탈로그를 받는다 — 앱 시작(동의 정착 뒤)·목소리 탭 진입. 받으면 받아 둔 팩에 게시 끝 기한을 적고, 기한 지난 팩을 대체하고,
 * 다 받지 못한 팩이 있으면 선다운로드를 깨운다. 못 받아도 저장된 기한으로 대체는 한다(네트워크 없이).
 */
internal fun MainViewModel.loadVoicePackCatalog() {
    val session = authSession ?: return
    val owner = session.user.id
    val generation = authSessionStore.sessionGeneration()
    viewModelScope.launch {
        val response = runCatching {
            withContext(Dispatchers.IO) { api.listVoicePacks(AlarmTalkApiClient.bearer(session.token)) }
        }.onFailure { AlarmTalkLog.reportError("Voice pack catalog load failed", it) }.getOrNull()
        if (!responseStillBelongsToRequester(owner, generation)) return@launch
        if (response != null) {
            val packs = response.packs.orEmpty()
            voicePackCatalog = packs
            voicePackCatalogFailed = false
            withContext(Dispatchers.IO) {
                voicePackStore.applyCatalog(owner, packs.map { it.packId }.toSet(), response.withdrawn.orEmpty())
            }
        } else {
            voicePackCatalogFailed = true
        }
        voicePackCatalogLoaded = true
        withContext(Dispatchers.IO) {
            VoicePackDownloader.retireDuePacks(getApplication(), owner, System.currentTimeMillis())
        }
        refreshHeldVoicePacks()
        // 다 받지 못한 팩(앱이 받는 도중 꺼졌다·캐시를 지웠다)은 워커가 이어 받는다. 카탈로그에서 개정이 바뀐 팩도 같다.
        val listedRevisions = voicePackCatalog.associate { it.packId to it.contentRevision }
        val needsWork = heldVoicePacks.any { pack ->
            !pack.withdrawn && (!pack.ready || listedRevisions[pack.packId]?.let { it != pack.contentRevision } == true)
        }
        if (needsWork) StockClipPrefetchWorker.enqueue(getApplication())
    }
}

/**
 * '받기' — 상세를 받아 받은 팩 목록에 넣고 선다운로드를 깨운다. 실제 클립은 워커가 기본 목소리 다음에 받는다(스펙 §7).
 */
internal fun MainViewModel.downloadVoicePack(packId: String) {
    val session = authSession ?: return
    val owner = session.user.id
    val generation = authSessionStore.sessionGeneration()
    viewModelScope.launch {
        runCatching {
            withContext(Dispatchers.IO) { api.getVoicePack(AlarmTalkApiClient.bearer(session.token), packId).pack }
        }.onSuccess { detail ->
            if (!responseStillBelongsToRequester(owner, generation)) return@onSuccess
            withContext(Dispatchers.IO) {
                voicePackStore.upsert(owner, HeldVoicePack.fromDetail(detail, previous = voicePackStore.find(owner, packId)))
            }
            refreshHeldVoicePacks()
            StockClipPrefetchWorker.enqueue(getApplication())
        }.onFailure { error ->
            AlarmTalkLog.reportError("Voice pack download start failed", error)
            if (responseStillBelongsToRequester(owner, generation)) {
                message = userFacingError(error, getApplication<Application>().getString(R.string.voice_pack_download_failed))
            }
        }
    }
}

/** 이 팩 목소리를 쓰는 지금 계정의 알람 수 — 지우기 확인 알럿의 숫자. */
internal suspend fun MainViewModel.countAlarmsUsingVoicePack(voiceId: String): Int =
    withContext(Dispatchers.IO) { repository.countAlarmsUsingVoice(voiceId, authSession?.user?.id) }

/** '지우기' — 그 팩 목소리 알람을 미나로 바꾸고 파일을 지운다(스펙 §7, 기한 지난 팩과 같은 길). */
internal fun MainViewModel.removeVoicePack(packId: String) {
    val owner = authSession?.user?.id ?: return
    viewModelScope.launch {
        val pack = voicePackStore.find(owner, packId) ?: return@launch
        withContext(Dispatchers.IO) { VoicePackDownloader.removePack(getApplication(), owner, pack) }
        refreshHeldVoicePacks()
    }
}

/**
 * 미리듣기 샘플 하나를 캐시에 둔다(받기 전에도 — 팩 전체를 받지 않는다). 받아 둔 팩이면 그 상세의 해시로, 아니면 응답이 말한
 * 해시·크기로 대조한다. 같은 클립을 받은 팩이 이미 받아 뒀으면 네트워크를 타지 않는다.
 */
internal suspend fun MainViewModel.ensureVoicePackSample(summary: VoicePackSummary): CachedAlarmAudio {
    val preview = summary.preview ?: error("This voice pack has no preview sample.")
    val owner = authSession?.user?.id
    val held = voicePackStore.find(owner, summary.packId)?.clipList?.firstOrNull { it.clipId == preview.clipId }
    val audioStore = AlarmAudioStore(getApplication())
    val key = voicePackCacheKey(preview.clipId)
    if (held != null) {
        withContext(Dispatchers.IO) {
            audioStore.getCachedAudio(key, voicePackRemoteIdentity(summary.packId, held.clipId, held.sha256))
        }?.let { return it }
    }
    val session = authSession ?: error("Not signed in.")
    val response = withContext(Dispatchers.IO) {
        api.getVoicePackClipAudio(AlarmTalkApiClient.bearer(session.token), summary.packId, preview.clipId)
    }
    return withContext(Dispatchers.IO) {
        val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
        val expectedSha = held?.sha256 ?: response.sha256.orEmpty()
        check(expectedSha.isNotBlank() && sha256Hex(bytes).equals(expectedSha, ignoreCase = true)) {
            "Voice pack sample hash mismatch."
        }
        audioStore.cacheGeneratedAudio(
            bytes = bytes,
            format = response.audioFormat ?: "mp3",
            rawAudioUri = voicePackRemoteIdentity(summary.packId, preview.clipId, expectedSha),
            displayName = key,
            cacheKey = key,
            messageId = null,
        )
    }
}

/**
 * 받은 팩의 클립이면 팩 API 로 받아 [TtsMessageAudioResponse] 모양으로 돌려준다 — 편집기의 캐시 비었을 때 폴백
 * (`bindStockBucketClips`)이 기본 목소리 클립과 같은 길로 부른다. 팩 클립이 아니면 null.
 */
internal suspend fun MainViewModel.downloadVoicePackClipIfHeld(clipId: String): TtsMessageAudioResponse? {
    val owner = authSession?.user?.id ?: return null
    val pack = heldVoicePacks.firstOrNull { held -> held.clipList.any { it.clipId == clipId } }
        ?: voicePackStore.held(owner).firstOrNull { held -> held.clipList.any { it.clipId == clipId } }
        ?: return null
    val clip = pack.clipList.first { it.clipId == clipId }
    val identity = voicePackRemoteIdentity(pack.packId, clipId, clip.sha256)
    // 받아 둔 파일이 있으면 그것을 준다 — 편집기 목소리 미리듣기처럼 매번 부르는 자리가 네트워크를 타지 않게(오프라인 포함).
    withContext(Dispatchers.IO) {
        AlarmAudioStore(getApplication()).getCachedAudioUnmeasured(voicePackCacheKey(clipId), identity)
            ?.localAudioUri
            ?.let { uri -> runCatching { java.io.File(android.net.Uri.parse(uri).path!!).readBytes() }.getOrNull() }
    }?.let { bytes ->
        return TtsMessageAudioResponse(
            messageId = clipId,
            audioBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
            audioFormat = clip.audioFormat ?: "mp3",
            audioUrl = identity,
            text = clip.text.orEmpty(),
            category = clip.category,
            voiceProfileId = pack.voiceId,
        )
    }
    val session = authSession ?: return null
    val response = withContext(Dispatchers.IO) {
        api.getVoicePackClipAudio(AlarmTalkApiClient.bearer(session.token), pack.packId, clipId)
    }
    val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
    check(com.alarmtalk.app.data.voicePackBytesMatch(bytes, clip)) { "Voice pack clip hash mismatch." }
    return TtsMessageAudioResponse(
        messageId = clipId,
        audioBase64 = response.audioBase64,
        audioFormat = response.audioFormat ?: clip.audioFormat ?: "mp3",
        audioUrl = voicePackRemoteIdentity(pack.packId, clipId, clip.sha256),
        text = clip.text.orEmpty(),
        category = clip.category,
        voiceProfileId = pack.voiceId,
    )
}
