package com.alarmtalk.app.data

import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.VoicePackClip
import com.alarmtalk.app.network.VoicePackSummary
import com.alarmtalk.app.network.VoiceProfile
import java.security.MessageDigest

/*
 * 추가 음성팩 — 규칙의 유일 출처는 `docs/spec/voice-packs.md` 다. 여기는 판정만 모은 순수 함수들이다.
 *
 * 팩 목소리는 **목소리 프로필이 아니다**(스펙 §1). 서버 `GET /voice` 에 없고, 직접 입력 합성·목소리 등록이 그 목소리를
 * 모른다. 그래서 자리마다 팩을 어떻게 볼지 정해 둔다:
 *  - 편집기·클립 관문·무료 판정 → **기본 목소리처럼**([isFreeFixedVoiceId]) — 같은 테마 구조를 갖춰야 게시되고(§2) 무료다.
 *  - 목소리 접근권 대조(`AlarmRepository.degradeAlarmsWithInaccessibleVoice`)·언어 재바인딩·기본 4종 관문·대체 목소리 고르기
 *    (`pickDefaultSystemVoiceId`) → **팩이 아니다**([isSystemVoiceId] 그대로). 목록에 없다고 팩 알람을 강등하면 안 된다.
 *
 * iOS 짝은 `VoicePacks.swift` — 한쪽만 고치지 말 것.
 */

/**
 * **추가 음성팩을 화면에 내보이는가**(2026-10-27 오너 — 권리·음원이 없어 아직 숨긴다). 끄면 목소리 탭의 '추가 팩' 칸을 그리지
 * 않고, 받아 둔 팩이 없으면 카탈로그도 묻지 않는다. 코드는 남긴다 — 켜면 그대로 돌아온다. iOS 짝 `VoicePacks.isVisible`.
 */
const val VOICE_PACKS_VISIBLE = false

/** 팩 목소리 id 의 대역 — 서버 `VOICE_PACK_VOICE_ID_PREFIX` 와 같다. 기본 목소리(`…-9000-`)와 겹치지 않는다. */
const val VOICE_PACK_VOICE_ID_PREFIX = "70000000-0000-4000-9100-"

/** 팩 클립의 캐시 키 앞머리. 기본 목소리 `stock_` 과 따로 둔다 — 그쪽 정리(`pruneReplacedStockAudio`)가 팩 파일을 지우지 않게. */
const val VOICE_PACK_CACHE_KEY_PREFIX = "pack_"

fun isVoicePackVoiceId(id: String?): Boolean = id?.startsWith(VOICE_PACK_VOICE_ID_PREFIX) == true

/** **기본 목소리처럼 다루는 고정 목소리**인가 — 기본 4종 또는 추가 팩. 무료로 쓰고, 같은 테마 클립 구조다. */
fun isFreeFixedVoiceId(id: String?): Boolean = isSystemVoiceId(id) || isVoicePackVoiceId(id)

fun voicePackCacheKey(clipId: String): String = "$VOICE_PACK_CACHE_KEY_PREFIX$clipId"

/**
 * 캐시 메타에 적는 원격 식별자. 해시가 들어 있어 클립 내용이 바뀌면(같은 id 는 바뀌지 않지만, 혹시라도) 낡은 것으로 읽힌다.
 * 원격 주소가 아니다 — `RemoteAlarmMapper.isRemoteAudioUrl` 에 걸리지 않는 스킴이다.
 */
fun voicePackRemoteIdentity(packId: String, clipId: String, sha256: String): String =
    "voice-pack://$packId/$clipId?sha256=${sha256.lowercase()}"

/** 스톡 클립 목록의 한 줄이 쓰는 캐시 키 — 팩 클립이면 `pack_`, 아니면 기본 `stock_`. 편집기 묶기가 이것 하나로 고른다. */
fun StockClip.clipCacheKey(): String =
    if (isVoicePackVoiceId(voiceProfileId)) voicePackCacheKey(messageId) else "${AlarmAudioStore.STOCK_CACHE_KEY_PREFIX}$messageId"

fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** 받은 바이트가 상세의 해시·크기와 맞는가. 하나라도 다르면 캐시에 넣지 않는다(스펙 §7). */
fun voicePackBytesMatch(bytes: ByteArray, clip: VoicePackClip): Boolean =
    bytes.isNotEmpty() &&
        (clip.sizeBytes <= 0L || bytes.size.toLong() == clip.sizeBytes) &&
        sha256Hex(bytes).equals(clip.sha256, ignoreCase = true)

/** 서버 ISO 시각 → 밀리초. 못 읽으면 null(대체하지 않는다 — 모르는 기한으로 알람을 바꾸지 않는다). */
fun parseVoicePackInstant(value: String?): Long? =
    value?.takeIf { it.isNotBlank() }?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }

/**
 * 이 계정이 **받은** 팩 하나 — 기기에 적어 둔 상세다(`VoicePackStore`). 오프라인에서도 편집기가 고를 수 있고, 무엇이 빠졌는지
 * 셀 수 있어야 해서 클립 목록까지 든다.
 *
 * ⚠ Gson 이 만든다 — 코틀린 기본 인자가 적용되지 않는다. 그래서 목록은 nullable 이고 읽는 쪽이 비어 있음으로 접는다.
 */
data class HeldVoicePack(
    val packId: String,
    val voiceId: String,
    val speakerName: String,
    val language: String,
    val description: String? = null,
    val usageNote: String? = null,
    val contentRevision: Int = 0,
    val totalBytes: Long = 0,
    val previewClipId: String? = null,
    val clips: List<VoicePackClip>? = null,
    /** 다 받았는가. 이때부터 편집기에 나온다. */
    val ready: Boolean = false,
    /** 게시가 끝났으면 기존 알람이 이 팩으로 울 수 있는 기한(서버 `withdrawn[].playback_until`). */
    val withdrawnPlaybackUntilMillis: Long? = null,
) {
    val clipList: List<VoicePackClip> get() = clips.orEmpty()

    val withdrawn: Boolean get() = withdrawnPlaybackUntilMillis != null

    /** 기한이 지났는가 — 그러면 그 팩 목소리 알람을 미나로 바꾸고 파일을 지운다(스펙 §5-3). */
    fun retirementDue(nowMillis: Long): Boolean =
        withdrawnPlaybackUntilMillis?.let { nowMillis >= it } == true

    /** 편집기·관문이 보는 스톡 클립 모양. 캐시 키는 [clipCacheKey] 가 `pack_` 으로 고른다. */
    fun toStockClips(): List<StockClip> = clipList.map { clip ->
        StockClip(
            messageId = clip.clipId,
            voiceProfileId = voiceId,
            voiceName = speakerName,
            category = clip.category,
            language = clip.language ?: language,
            variant = clip.variant,
            text = clip.text.orEmpty(),
            audioUrl = voicePackRemoteIdentity(packId, clip.clipId, clip.sha256),
            renderedForCurrentVoice = true,
        )
    }

    /** 편집기 목소리 목록의 한 줄 — 기본 목소리처럼(`isSystem = true`) 테마 클립으로 운다. */
    fun toVoiceProfile(): VoiceProfile =
        VoiceProfile(id = voiceId, name = speakerName, status = "ready", isSystem = true)

    companion object {
        /** 상세 응답으로 받은 팩을 만든다(처음 받기·개정이 바뀌어 다시 받기). 상태는 아직 받는 중이다. */
        fun fromDetail(detail: VoicePackSummary, previous: HeldVoicePack? = null): HeldVoicePack = HeldVoicePack(
            packId = detail.packId,
            voiceId = detail.voiceId,
            speakerName = detail.speakerName,
            language = detail.language ?: "ko",
            description = detail.description,
            usageNote = detail.usageNote,
            contentRevision = detail.contentRevision,
            totalBytes = detail.totalBytes,
            previewClipId = detail.preview?.clipId,
            clips = detail.clips.orEmpty(),
            ready = false,
            withdrawnPlaybackUntilMillis = previous?.withdrawnPlaybackUntilMillis,
        )
    }
}

/**
 * 편집기 목소리 목록에 넣을 팩 — **다 받았고 게시 중인** 팩, 그리고 지금 여는 알람이 이미 쓰는 팩(게시가 끝났어도 기한까지는
 * 그 알람을 목소리를 바꾸지 않고 저장할 수 있어야 한다 — 스펙 §5-1).
 *
 * ⚠ 지금 알람의 팩은 **새 개정을 받는 중이어도**(`ready = false`) 남긴다. 빼면 편집기가 그 목소리를 고를 수 없는 것으로 읽고
 * 다른 목소리로 갈아 끼워, 시각만 고쳐 저장해도 팩 목소리가 바뀐다(코덱스 #960 — iOS `VoicePacks.editorEntries` 짝).
 */
fun editorVoicePacks(held: List<HeldVoicePack>, editingVoiceId: String?): List<HeldVoicePack> =
    held.filter { it.voiceId == editingVoiceId || (it.ready && !it.withdrawn) }

/**
 * 추가 팩 목소리의 클립 언어(팩 하나는 언어 하나 — 스펙 §2). 팩이 아니거나 클립이 없으면 null — 호출부가 앱 언어를 쓴다.
 */
fun voicePackLanguageOf(clips: List<StockClip>, voiceId: String?): String? {
    if (!isVoicePackVoiceId(voiceId)) return null
    return clips.firstOrNull { it.voiceProfileId == voiceId }?.language
}
