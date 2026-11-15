package com.alarmtalk.app.sync

import android.content.Context
import com.alarmtalk.app.network.StockClip

/**
 * 기본 목소리 받기의 **순서** — 필요한 것부터 받는다(`docs/spec/voice-and-message.md` 「알람마다 필요한 목소리만 본다」).
 *
 * 받는 대상은 그대로다(기본 목소리 4종 × 기기 언어 × 무료 테마, 내 목소리 사전렌더). 바뀌는 것은 줄 세우는 법뿐이다:
 *  0. 저장된 켜진 알람이 쓰는 목소리 × 테마 — 다음에 울릴 알람부터.
 *  1. 지금 고르려는 목소리 × 테마([request] — 편집기·관문이 적는다).
 *  2. 고르려는 목소리의 나머지 테마.
 *  3. 저장된 알람 목소리의 나머지 테마.
 *  4. 그 밖(다른 기본 목소리 등) — 계속 받는다. 고른 하나만 받고 멈추지 않는다.
 *
 * 같은 칸 안에서는 매니페스트 순서를 지킨다(안정 정렬). 워커는 배치마다 다시 줄 세우므로, 받는 도중 다른 목소리를
 * 고르면 다음 배치부터 그 목소리가 먼저다 — 앞서 고른 것의 남은 몫이 새 선택을 앞지르지 않는다.
 *
 * iOS 짝은 `StockClipPrefetcher.prioritized`.
 */
internal data class PrefetchTarget(val voiceId: String, val category: String?)

internal object StockClipPrefetchPriority {
    private const val PREFS = "stock_clip_prefetch_priority"

    /**
     * 지금 고르려는 목소리(와 테마)를 적는다. 계정별이고 마지막 하나만 남는다 — 다음에 다른 것을 고르면 덮인다.
     * 다 받은 목소리가 남아 있어도 해가 없다(받을 몫이 없으니 순서에 영향이 없다).
     */
    fun request(context: Context, userId: String?, target: PrefetchTarget) {
        val key = keyFor(userId) ?: return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(key, "${target.voiceId}|${target.category.orEmpty()}")
            .apply()
    }

    fun requested(context: Context, userId: String?): PrefetchTarget? {
        val key = keyFor(userId) ?: return null
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, null) ?: return null
        val voiceId = raw.substringBefore('|').takeIf { it.isNotBlank() } ?: return null
        return PrefetchTarget(voiceId, raw.substringAfter('|', "").takeIf { it.isNotBlank() })
    }

    fun clear(context: Context, userId: String?) {
        val key = keyFor(userId) ?: return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(key).apply()
    }

    /** 몇 번째 칸인가(작을수록 먼저). 칸 안의 차례는 저장된 알람의 순번이다. */
    internal fun rank(clip: StockClip, saved: List<PrefetchTarget>, requested: PrefetchTarget?): Int {
        val exactSaved = saved.indexOfFirst { it.voiceId == clip.voiceProfileId && it.category == clip.category }
        if (exactSaved >= 0) return exactSaved
        val base = saved.size
        if (requested != null && requested.voiceId == clip.voiceProfileId) {
            return if (requested.category != null && requested.category == clip.category) base else base + 1
        }
        val savedVoice = saved.indexOfFirst { it.voiceId == clip.voiceProfileId }
        if (savedVoice >= 0) return base + 2 + savedVoice
        return base + 2 + saved.size
    }

    /** [items] 를 받을 순서로 다시 세운다. [clipOf] 는 항목에서 클립을 꺼낸다. */
    fun <T> order(
        items: List<T>,
        saved: List<PrefetchTarget>,
        requested: PrefetchTarget?,
        clipOf: (T) -> StockClip,
    ): List<T> = items.withIndex()
        .sortedWith(compareBy({ rank(clipOf(it.value), saved, requested) }, { it.index }))
        .map { it.value }

    private fun keyFor(userId: String?): String? = userId?.trim()?.takeIf { it.isNotEmpty() }?.let { "requested_$it" }
}
