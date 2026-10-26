package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.network.StockClip
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName

/**
 * 응원 테마의 **다양하게 / 이 문구로 고정** — 규칙의 단일 출처는 `docs/spec/voice-and-message.md` §5-4.
 *
 * 요약:
 *  - 후보 = 그 알람의 목소리·언어로 매니페스트에 있고(테마 `cheer`), 새로 고를 수 있고(`selectable`), **폰에 받아 둔**
 *    응원 클립. 후보가 없으면 고르지 않는다 — 묶어 둔 옛 응원의 순차 회전(§5)이 그대로 운다(안전 응원).
 *  - 다양하게 = 이력의 마지막 [CHEER_RECENT_EXCLUSION]개를 빼고 남은 후보 중 회차 키로 정해지는 자리. 남은 것이
 *    없으면 후보 중 가장 오래전에 고른 것(고른 적 없는 것이 가장 오래됐다, 동률은 목록 순서).
 *  - 고정 = 고른 문구가 후보에 있으면 그것, 없으면 이번 회차는 다양하게(고정값은 지우지 않는다).
 *  - 선택은 **회차(예정 발사 시각)** 에 묶는다. 같은 회차로 다시 준비하면 그대로 쓰고 이력을 더하지 않는다.
 *  - 이력은 **준비·예약한** 문구다(들었다는 기록이 아니다). 기기 로컬이고 서버로 가지 않는다.
 *
 * iOS 짝은 `CheerVariety.swift` — **셈(특히 [cheerSeedIndex])이 글자 그대로 같아야 한다.**
 */
object CheerModes {
    const val VARY = "vary"
    const val PINNED = "pinned"

    /** 저장값 읽기 — 모르는 값·없음은 다양하게. */
    fun normalize(raw: String?): String = if (raw == PINNED) PINNED else VARY
}

/** 응원 테마의 버킷 id. */
const val CHEER_BUCKET_ID = "cheer"

/** 다양하게 — 새로 고를 때 빼는 최근 이력 수(지시서 v1.3 12.1). */
const val CHEER_RECENT_EXCLUSION = 7

/** 이력 상한 — 후보(지금 14개)보다 넉넉하게. 오래된 것부터 버린다. */
const val CHEER_HISTORY_LIMIT = 32

/** 고를 수 있는 응원 문구 하나. [cacheKey] 는 `stock_<messageId>`. */
data class CheerCandidate(
    val contentId: String,
    val cacheKey: String,
    val text: String,
)

/** 지금 회차의 선택. [occurrence] = 그 회차의 예정 발사 시각(회차 키). */
data class CheerSelection(
    val occurrence: Long,
    val contentId: String,
    val cacheKey: String,
    val text: String,
    val language: String,
)

/** 매니페스트 클립이 속한 테마. 옛 서버(필드 없음)는 카테고리 그대로다. */
val StockClip.bucketTheme: String? get() = theme ?: category

/**
 * 매니페스트 → 이 목소리·언어의 응원 후보(목록 순서 = 카테고리·자리 순). 받아 두지 않은 것은 뺀다.
 *
 * 옛 응원(`selectable = false`)과 표지가 없는 클립(옛 서버 — `content_id` 없음)은 후보가 아니다 — 그 알람은 묶어 둔
 * 회전으로 운다.
 */
fun cheerCandidatesFrom(
    clips: List<StockClip>,
    voiceProfileId: String,
    language: String,
    isCached: (cacheKey: String, audioUrl: String?) -> Boolean,
): List<CheerCandidate> =
    cheerPhrasesFrom(clips, voiceProfileId, language)
        .filter { (clip, _) -> isCached("stock_${clip.messageId}", clip.audioUrl) }
        .map { (_, candidate) -> candidate }

/**
 * 고정 목록에 보일 문구 — 매니페스트에 있는 것(서버가 다 만들어 공개한 것). 받기는 선다운로드가 한다.
 * 화면은 이걸 그리고, 실제 선택은 [cheerCandidatesFrom](받아 둔 것만)이 한다.
 */
fun cheerPhrasesFrom(
    clips: List<StockClip>,
    voiceProfileId: String,
    language: String,
): List<Pair<StockClip, CheerCandidate>> =
    clips.asSequence()
        .filter { clip ->
            clip.voiceProfileId == voiceProfileId &&
                (clip.language ?: "ko") == language &&
                clip.bucketTheme == CHEER_BUCKET_ID &&
                clip.selectable != false &&
                !clip.contentId.isNullOrBlank()
        }
        .sortedWith(compareBy({ it.category.orEmpty() }, { it.variant }))
        .distinctBy { it.contentId }
        .map { clip -> clip to CheerCandidate(clip.contentId!!, "stock_${clip.messageId}", clip.text) }
        .toList()

/**
 * 회차 키 → 자리. 32비트 곱셈 해시라 두 앱이 같은 값을 낸다(iOS `CheerVariety.seedIndex`).
 * 분 단위로 자른다 — 같은 회차를 밀리초가 다른 두 값으로 계산해도 같은 자리가 나온다.
 */
fun cheerSeedIndex(occurrence: Long, count: Int): Int {
    if (count <= 0) return 0
    val minutes = Math.floorDiv(occurrence, 60_000L)
    val hash = (minutes * 2_654_435_761L) and 0xFFFF_FFFFL
    return (hash % count).toInt()
}

/**
 * **다양하게** — 최근 [CHEER_RECENT_EXCLUSION]개를 빼고 고른다. 후보가 없으면 null.
 *
 * @param candidates 후보 ID(목록 순서).
 * @param history 준비한 문구 ID 이력(오래된 것 → 최근, 겹치지 않는다).
 */
fun pickCheerContent(candidates: List<String>, history: List<String>, occurrence: Long): String? {
    if (candidates.isEmpty()) return null
    val recent = history.takeLast(CHEER_RECENT_EXCLUSION).toSet()
    val eligible = candidates.filter { it !in recent }
    if (eligible.isNotEmpty()) return eligible[cheerSeedIndex(occurrence, eligible.size)]
    // 후보가 모자라다 — 가장 오래전에 고른 것부터 허용한다(고른 적 없는 것은 -1 이라 가장 오래됐다).
    return candidates.minByOrNull { history.indexOf(it) }
}

/** 이력에 더한다 — 같은 ID 는 끝으로 옮기고, [CHEER_HISTORY_LIMIT] 를 넘으면 오래된 것부터 버린다. */
fun appendCheerHistory(history: List<String>, contentId: String): List<String> =
    (history.filter { it != contentId } + contentId).takeLast(CHEER_HISTORY_LIMIT)

// 직렬화는 Gson 이다 — 울림·저장 경로가 같은 모양을 읽고, JVM 단위 테스트에서도 돈다(org.json 은 안드로이드 스텁이다).
private val cheerGson = Gson()

/** 선택의 저장 모양. 칸 이름이 짧은 것은 행에 여러 번 실리기 때문이다 — 바꾸면 옛 행을 못 읽는다. */
private data class StoredCheerSelection(
    @SerializedName("o") val occurrence: Long? = null,
    @SerializedName("id") val contentId: String? = null,
    @SerializedName("key") val cacheKey: String? = null,
    @SerializedName("text") val text: String? = null,
    @SerializedName("lang") val language: String? = null,
)

fun encodeCheerHistory(history: List<String>): String? =
    if (history.isEmpty()) null else cheerGson.toJson(history)

fun decodeCheerHistory(json: String?): List<String> {
    if (json.isNullOrBlank()) return emptyList()
    return runCatching { cheerGson.fromJson(json, Array<String>::class.java)?.filterNotNull().orEmpty() }
        .getOrDefault(emptyList())
}

fun encodeCheerSelection(selection: CheerSelection?): String? = selection?.let {
    cheerGson.toJson(StoredCheerSelection(it.occurrence, it.contentId, it.cacheKey, it.text, it.language))
}

fun decodeCheerSelection(json: String?): CheerSelection? {
    if (json.isNullOrBlank()) return null
    val stored = runCatching { cheerGson.fromJson(json, StoredCheerSelection::class.java) }.getOrNull() ?: return null
    return CheerSelection(
        occurrence = stored.occurrence ?: return null,
        contentId = stored.contentId?.takeIf { it.isNotBlank() } ?: return null,
        cacheKey = stored.cacheKey?.takeIf { it.isNotBlank() } ?: return null,
        text = stored.text.orEmpty(),
        language = stored.language ?: "ko",
    )
}

fun AlarmEntity.cheerSelection(): CheerSelection? = decodeCheerSelection(cheerSelectionJson)

/**
 * **다음 회차의 응원을 준비한다** — 저장·알람을 끝낼 때 부른다(스펙 §5-4). 울릴 때는 부르지 않는다.
 *
 * @param occurrence 이번에 확정된 회차 키(그 회차의 예정 발사 시각).
 * @param explicitChange 사용자가 모드·고정 문구를 바꿔 저장했는가 — 그때는 같은 회차라도 새로 고른다.
 * @return 바뀐 행(바뀐 것이 없으면 같은 값).
 */
fun AlarmEntity.preparedCheer(
    occurrence: Long,
    candidates: List<CheerCandidate>,
    explicitChange: Boolean,
): AlarmEntity {
    if (bucketId != CHEER_BUCKET_ID) {
        return if (cheerSelectionJson == null) this else copy(cheerSelectionJson = null)
    }
    // 후보가 없으면 고르지 않는다 — 묶어 둔 회전이 운다. 이력은 건드리지 않는다.
    if (candidates.isEmpty()) return if (cheerSelectionJson == null) this else copy(cheerSelectionJson = null)
    val ids = candidates.map { it.contentId }
    val current = cheerSelection()
    if (!explicitChange && current != null && current.occurrence == occurrence && current.contentId in ids) {
        return this
    }
    val history = decodeCheerHistory(cheerHistoryJson)
    val pinned = cheerPinnedContentId?.takeIf { CheerModes.normalize(cheerMode) == CheerModes.PINNED && it in ids }
    val chosenId = pinned ?: pickCheerContent(ids, history, occurrence) ?: return this
    val chosen = candidates.first { it.contentId == chosenId }
    return copy(
        cheerSelectionJson = encodeCheerSelection(
            CheerSelection(
                occurrence = occurrence,
                contentId = chosen.contentId,
                cacheKey = chosen.cacheKey,
                text = chosen.text,
                language = voiceLanguage ?: "ko",
            ),
        ),
        cheerHistoryJson = encodeCheerHistory(appendCheerHistory(history, chosen.contentId)),
    )
}

/**
 * 울릴 때 쓸 선택 — 응원 알람이고 **지금 묶인 언어의 것**일 때만. 언어를 바꿔 다시 묶였으면 null(묶어 둔 회전으로
 * 운다 — 다음 준비가 새 언어로 고른다).
 */
fun AlarmEntity.activeCheerSelection(): CheerSelection? {
    if (bucketId != CHEER_BUCKET_ID) return null
    val selection = cheerSelection() ?: return null
    return selection.takeIf { it.language == (voiceLanguage ?: "ko") }
}

/** 응원 설정을 바꿨는가 — 바꿨으면 같은 회차라도 새로 고른다. */
fun cheerSettingsChanged(before: AlarmEntity?, afterMode: String?, afterPinned: String?): Boolean =
    before == null ||
        CheerModes.normalize(before.cheerMode) != CheerModes.normalize(afterMode) ||
        (CheerModes.normalize(afterMode) == CheerModes.PINNED && before.cheerPinnedContentId != afterPinned)

/**
 * 후보를 디스크에서 읽는다 — 매니페스트(마지막 공개본)와 캐시. 저장·알람 끝냄에서만 부르고 **IO 에서** 돈다
 * (매니페스트는 약 168KB 다). 네트워크는 타지 않는다(울림 경로 원칙).
 */
class CheerVarietySource(
    private val context: Context,
    private val audioStore: AlarmAudioStore,
    private val currentUserIdProvider: () -> String?,
) {
    suspend fun candidates(alarm: AlarmEntity): List<CheerCandidate> {
        if (alarm.bucketId != CHEER_BUCKET_ID) return emptyList()
        val voice = alarm.voiceProfileId?.takeIf { it.isNotBlank() } ?: return emptyList()
        val language = alarm.voiceLanguage ?: "ko"
        return withContext(Dispatchers.IO) {
            val manifest = StockClipManifestStore.load(context, currentUserIdProvider()) ?: return@withContext emptyList()
            cheerCandidatesFrom(manifest.clips, voice, language) { key, url -> audioStore.hasCachedAudio(key, url) }
        }
    }
}
