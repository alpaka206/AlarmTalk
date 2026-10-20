package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.VoiceProfile

/*
 * **받았던 알람을 내 목소리로 올린다**(커플·가족 이용권 폐지, 2026-10-20).
 *
 * 받은 알람은 업데이트하며 기본 목소리 미나의 내 알람이 됐다(1단계 — `AlarmDatabase` 의
 * `ReceivedAlarmConversionMigration`). 여기는 2단계다: 그 계정이 **지금 쓸 수 있는 자기 클론**이 있고
 * 그 클론의 기본 인사말(greeting) 클립이 **기기에 다 있으면** 그 클론 + 기본 인사말로 바꾼다 —
 * 편집기에서 그 목소리와 '기본 인사말' 을 골라 저장한 것과 같은 모양이다. 하나라도 모자라면 미나로 둔다.
 * **조용히 울리는 알람을 만들지 않는다** — 묶을 클립이 다 없으면 바꾸지 않는다.
 *
 * 규칙: `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」, `docs/spec/plan-gates.md` 「커플·가족 이용권 — 폐지」.
 * 회귀 테스트: `FormerReceivedPromotionTest`.
 */

/**
 * 1단계에서 바꾼 알람 id — 계정별(SharedPreferences). 2단계가 끝내면(올렸거나 미나로 확정했거나 사용자가
 * 고쳤으면) 지운다. 명시적 로그아웃·탈퇴도 그 계정 것을 지운다.
 */
class FormerReceivedAlarmStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** 1단계가 바꾼 알람을 계정별로 적는다. 마이그레이션 안에서 불리므로 곧바로 디스크에 쓴다. */
    fun recordConverted(alarmIdsByOwner: Map<String, Set<String>>) {
        val editor = prefs.edit()
        alarmIdsByOwner.forEach { (owner, ids) ->
            val key = keyFor(owner) ?: return@forEach
            editor.putStringSet(key, pending(owner) + ids)
        }
        editor.commit()
    }

    fun pending(userId: String?): Set<String> {
        val key = keyFor(userId) ?: return emptySet()
        return prefs.getStringSet(key, null)?.toSet().orEmpty()
    }

    /** 2단계가 끝낸 알람을 지운다. */
    fun settle(userId: String?, alarmIds: Collection<String>) {
        val key = keyFor(userId) ?: return
        val left = pending(userId) - alarmIds.toSet()
        prefs.edit().apply { if (left.isEmpty()) remove(key) else putStringSet(key, left) }.apply()
    }

    fun clear(userId: String?) {
        val key = keyFor(userId) ?: return
        prefs.edit().remove(key).apply()
    }

    private companion object {
        const val PREFS_NAME = "voice_alarm_former_received_alarms"

        fun keyFor(userId: String?): String? =
            userId?.trim()?.takeIf { it.isNotEmpty() }?.let { "pending_$it" }
    }
}

/** 2단계 판정 한 건의 답. */
internal sealed interface FormerReceivedPromotion {
    /** 이 클론 + 기본 인사말로 바꾼다. 기록을 지운다. */
    data class Promote(val greeting: PromotionGreeting) : FormerReceivedPromotion

    /** 미나 그대로 확정한다(쓸 수 있는 자기 클론이 없거나 '알람' 모드다). 기록을 지운다. */
    data object KeepDefaultVoice : FormerReceivedPromotion

    /** 아직 정할 수 없다(이용권 판정 전·클론 정리 중·클립이 덜 받아짐). 기록을 남겨 다음 신선 새로고침에 다시 본다. */
    data object Retry : FormerReceivedPromotion

    /** 사용자가 고쳤거나 지웠다 — 손대지 않는다. 기록을 지운다. */
    data object UserChanged : FormerReceivedPromotion
}

/** 올릴 클론의 기본 인사말 한 벌 — 세트가 완전하고 **전부 기기에 있다**. */
internal data class PromotionGreeting(
    val voiceProfileId: String,
    val language: String,
    val clips: List<DefaultVoiceClip>,
)

/**
 * **이 행이 아직 1단계 모양 그대로인가** — 미나의 오디오 없는 내 알람이고 문구·테마·클립·잠금 표시가 하나도 없다.
 * 편집기로 저장한 행은 이 모양이 깨진다(목소리 모드는 문구를 골라야 저장되고, '알람' 모드는 목소리를 비운다).
 */
internal fun AlarmEntity.keepsReceivedConversionShape(): Boolean =
    origin == AlarmOrigins.LOCAL_OWNED &&
        voiceSource == VoiceSources.TTS_PROFILE &&
        voiceProfileId == SUBSTITUTE_SYSTEM_VOICE_ID &&
        !voiceRandomPrompt &&
        listOf(
            localAudioUri, audioCacheKey, rawAudioUri, ttsMessageId, voiceText, voiceCategory, voiceListenerTitle,
            voiceRandomContext, bucketId, bucketClipKeysJson, bucketClipTextsJson, preLockPlayMode, preLockVoiceJson,
        ).all { it.isNullOrBlank() }

/**
 * 올릴 **자기 클론** 하나 — 준비를 마친(삭제 중·만드는 중·초안이 아닌) 내 목소리다. 기본 목소리는 아니다.
 * 여럿이면 마지막에 쓴 목소리가 그중 하나면 그것, 아니면 가장 최근에 만든 것이다. 만든 시각은 서버의
 * `created_at`(SQLite `datetime`)이고, 못 읽거나 같으면 목록 앞의 것이다 — 서버가 내 목소리를 최신순으로 준다.
 * 교체 정리 중인 목소리도 여기서는 고른다 — 정리가 끝날 때까지 기다리는 것은 판정([decideFormerReceivedPromotion])이다.
 */
internal fun pickPromotionClone(
    voiceProfiles: List<VoiceProfile>,
    lastUsedVoiceId: String?,
): VoiceProfile? {
    val usable = voiceProfiles.filter {
        it.isSystem != true &&
            !isSystemVoiceId(it.id) &&
            it.isDraft != true &&
            (it.status == null || it.status == "ready")
    }
    return usable.firstOrNull { it.id == lastUsedVoiceId }
        ?: usable.maxByOrNull { profile -> parseCreatedAtMillis(profile.createdAt) ?: Long.MIN_VALUE }
}

private fun parseCreatedAtMillis(value: String?): Long? =
    parseVoiceMarkerMillis(value)
        ?: value?.trim()?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }

/**
 * 그 클론의 기본 인사말 한 벌 — 서버가 다 만들었고(`expected_variants`) 기기에 **전부** 받아 둔 것만. 언어는
 * 편집기와 같다(`ClipGate.bucketClipLanguageFor` — 앱 언어 클립이 있으면 그 언어, 없으면 그 클론의 언어).
 * 하나라도 빠지면 null 이다.
 */
internal fun completeGreetingFor(
    voiceProfileId: String,
    clips: List<StockClip>,
    expectedVariants: ExpectedVariantCounts?,
    appVoiceLanguage: String,
    cached: (cacheKey: String, audioUrl: String?) -> CachedAlarmAudio?,
): PromotionGreeting? {
    // 서버가 개수를 안 알려 주면 완전한지 단정할 수 없다 — 편집기 관문(`hasCompleteCloneBucket`)과 같다.
    if (expectedVariants == null) return null
    val languages = clips.asSequence()
        .filter { it.voiceProfileId == voiceProfileId && it.category == STOCK_GREETING_CATEGORY }
        .map { it.language ?: "ko" }
        .toSet()
    val language = if (appVoiceLanguage in languages) appVoiceLanguage else languages.firstOrNull() ?: return null
    val set = defaultVoiceClipSet(clips, voiceProfileId, STOCK_GREETING_CATEGORY, language, expectedVariants, cached)
        ?: return null
    return PromotionGreeting(voiceProfileId, language, set)
}

/**
 * 2단계 판정(순수). 순서가 규칙이다.
 *
 * @param alarm 지금의 행(지워졌으면 null).
 * @param clone [pickPromotionClone] 이 **신선한 내 목소리 목록**에서 고른 클론(없으면 null).
 * @param cloneSettling 그 클론이 교체 정리 중인가(`VoiceReplacementMarkerStore` — 편집기도 그동안 못 고른다).
 * @param cloneEntitled 그 계정이 유료 목소리를 쓸 수 있는가. null 이면 **아직 모른다** — 이번 실행에서 서버로 받은 답이
 *   아직 없다(저장해 둔 판정으로는 미나를 확정하지 않는다).
 * @param greeting 그 클론의 기본 인사말 한 벌([completeGreetingFor]). 덜 받아졌으면 null.
 */
internal fun decideFormerReceivedPromotion(
    alarm: AlarmEntity?,
    clone: VoiceProfile?,
    cloneSettling: Boolean,
    cloneEntitled: Boolean?,
    greeting: PromotionGreeting?,
): FormerReceivedPromotion = when {
    alarm == null || !alarm.keepsReceivedConversionShape() -> FormerReceivedPromotion.UserChanged
    // '알람' 모드는 목소리를 쓰지 않는다 — 편집기도 이 모드에서는 목소리를 저장하지 않는다.
    AlarmPlayModes.normalize(alarm.playMode) == AlarmPlayModes.ALARM_ONLY -> FormerReceivedPromotion.KeepDefaultVoice
    // 클론이 없으면 이용권과 상관없이 미나다 — 판정을 기다릴 것이 없다.
    clone == null || cloneEntitled == false -> FormerReceivedPromotion.KeepDefaultVoice
    cloneEntitled == null || cloneSettling -> FormerReceivedPromotion.Retry
    greeting == null || greeting.voiceProfileId != clone.id -> FormerReceivedPromotion.Retry
    else -> FormerReceivedPromotion.Promote(greeting)
}

/**
 * 1단계 모양의 행을 그 클론 + 기본 인사말로 바꾼다(순수 — 쓰는 것은 호출부). 편집기가 그 목소리와 '기본 인사말' 을
 * 골라 저장한 모양(`AlarmEditorState.setBucketAudio` → `toDraft` → `AlarmRepository.updateAlarm`)과 같다.
 */
internal fun AlarmEntity.promotedToCloneGreeting(greeting: PromotionGreeting, nowMillis: Long): AlarmEntity {
    val first = greeting.clips.first()
    return copy(
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = greeting.voiceProfileId,
        voiceListenerTitle = null,
        voiceText = first.text,
        voiceCategory = "custom",
        voiceLanguage = appVoiceLanguageOf(greeting.language),
        voiceRandomPrompt = false,
        voiceRandomContext = "preset",
        localAudioUri = first.localAudioUri,
        audioCacheKey = first.cacheKey,
        rawAudioUri = first.rawAudioUri,
        ttsMessageId = first.messageId,
        bucketId = STOCK_GREETING_CATEGORY,
        bucketRotationIndex = 0,
        bucketClipKeysJson = encodeBucketClipKeys(greeting.clips.map { it.cacheKey }),
        bucketClipTextsJson = encodeBucketClipKeys(greeting.clips.map { it.text }),
        contextVariantIndex = null,
        contextResolvedAtMillis = null,
        voiceRepeat = true,
        syncState = nextLocalSyncState(),
        updatedAtMillis = nowMillis,
    )
}
