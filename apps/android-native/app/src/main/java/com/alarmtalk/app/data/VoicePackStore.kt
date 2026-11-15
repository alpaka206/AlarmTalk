package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.network.WithdrawnVoicePack
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * 이 계정이 **받은 추가 팩** 목록(`docs/spec/voice-packs.md` §7). 계정별 키(`held_<userId>`)라 다른 계정의 목록은 안 보인다.
 * 파일은 기기 캐시(`pack_<clipId>`)에 있고 여기는 상세(클립 목록·해시)와 상태만 든다.
 *
 * 선다운로드 워커(`StockClipPrefetchWorker` 의 `VoicePackDownloader`)와 화면이 같이 쓰므로 쓰기는 한 잠금 안에서
 * `commit()` 한다. 화면은 [changes] 를 보고 다시 읽는다 — 워커는 같은 프로세스에서 돈다(WorkManager 기본).
 *
 * iOS 짝은 `VoicePackStore.swift`.
 */
class VoicePackStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun held(userId: String?): List<HeldVoicePack> {
        val key = keyFor(userId) ?: return emptyList()
        return parse(prefs.getString(key, null))
    }

    /**
     * 이 기기에 적힌 **모든 계정**의 받은 팩이 쥔 클립 캐시 키(`pack_<clipId>`).
     *
     * 일반 알람 정리(알람 삭제·강등이 놓은 클립)는 이 키를 지우지 않는다 — 지우면 팩은 '받음' 으로 남는데 파일이 없어 오프라인
     * 저장이 실패한다(코덱스 #960). 팩 파일을 놓는 것은 팩 지우기·개정 정리·기한 대체뿐이고, 그때는 목록에서 먼저 뺀다.
     * 다른 계정이 같은 팩을 받아 두었으면 그 계정의 목록이 쥐고 있으니 남긴다.
     */
    fun heldClipCacheKeysOnDevice(): Set<String> =
        prefs.all.entries
            .filter { it.key.startsWith(KEY_PREFIX) }
            .flatMap { entry -> parse(entry.value as? String).flatMap { pack -> pack.clipList.map { voicePackCacheKey(it.clipId) } } }
            .toSet()

    private fun parse(json: String?): List<HeldVoicePack> {
        if (json == null) return emptyList()
        return runCatching { gson.fromJson<List<HeldVoicePack>>(json, listType) }
            .getOrNull()
            .orEmpty()
            // Gson 은 null 을 그대로 넣을 수 있다 — 필수 값이 빈 행은 버린다.
            .filter { it.packId.isNotBlank() && isVoicePackVoiceId(it.voiceId) }
    }

    fun find(userId: String?, packId: String): HeldVoicePack? = held(userId).firstOrNull { it.packId == packId }

    /** 목록을 고친다. 반환값이 새 목록이고, 바뀌었으면 [changes] 가 오른다. */
    fun update(userId: String?, transform: (List<HeldVoicePack>) -> List<HeldVoicePack>): List<HeldVoicePack> {
        val key = keyFor(userId) ?: return emptyList()
        synchronized(lock) {
            val before = held(userId)
            val after = transform(before)
            if (after != before) {
                prefs.edit().putString(key, gson.toJson(after)).commit()
                bump()
            }
            return after
        }
    }

    fun upsert(userId: String?, pack: HeldVoicePack) {
        update(userId) { list -> list.filterNot { it.packId == pack.packId } + pack }
    }

    fun remove(userId: String?, packId: String) {
        update(userId) { list -> list.filterNot { it.packId == packId } }
        clearProgress(packId)
    }

    /**
     * 카탈로그 응답을 받아 둔 팩에 반영한다 — 게시가 끝난 팩에는 기한을 적고, 다시 게시돼 목록에 돌아온 팩은 기한을 지운다.
     * 목록 어디에도 없는 팩(빌드·지역으로 안 보이는 팩)은 **건드리지 않는다**(스펙 §5-5).
     */
    fun applyCatalog(userId: String?, listedPackIds: Set<String>, withdrawn: List<WithdrawnVoicePack>) {
        val until = withdrawn.associate { it.packId to parseVoicePackInstant(it.playbackUntil) }
        update(userId) { list ->
            list.map { pack ->
                when {
                    pack.packId in until -> until[pack.packId]?.let { pack.copy(withdrawnPlaybackUntilMillis = it) } ?: pack
                    pack.packId in listedPackIds && pack.withdrawn -> pack.copy(withdrawnPlaybackUntilMillis = null)
                    else -> pack
                }
            }
        }
    }

    companion object {
        private const val PREFS = "voice_packs"
        private val gson = Gson()
        private val listType = object : TypeToken<List<HeldVoicePack>>() {}.type
        private val lock = Any()

        private const val KEY_PREFIX = "held_"

        private fun keyFor(userId: String?): String? = userId?.trim()?.takeIf { it.isNotEmpty() }?.let { "$KEY_PREFIX$it" }

        private val _changes = MutableStateFlow(0)

        /** 받은 팩 목록이 바뀔 때마다 오른다 — 화면이 다시 읽는 신호다. */
        val changes: StateFlow<Int> = _changes.asStateFlow()

        private fun bump() = _changes.update { it + 1 }

        private val _progress = MutableStateFlow<Map<String, Int>>(emptyMap())

        /** 받는 중인 팩의 퍼센트(packId → 0..100). 프로세스 안에서만 산다 — 다시 켜면 캐시를 세어 다시 채운다. */
        val progress: StateFlow<Map<String, Int>> = _progress.asStateFlow()

        fun reportProgress(packId: String, done: Int, total: Int) {
            val percent = if (total <= 0) 0 else (done * 100 / total).coerceIn(0, 100)
            _progress.update { it + (packId to percent) }
        }

        fun clearProgress(packId: String) {
            _progress.update { it - packId }
        }
    }
}
