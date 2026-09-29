package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.StockClipListResponse

/**
 * 기본 목소리 대체에 쓸 **기기 안의** 소리를 찾는다 — 매니페스트·오디오 캐시·APK 내장 인사말만
 * 읽고 네트워크는 부르지 않는다(울림 경로에서 네트워크 금지 — CLAUDE.md).
 *
 * 판정은 `data/DefaultVoiceFallback.kt` 의 순수 함수에 있고, 여기는 그 함수들에 기기의 값을 대 준다.
 * 잠금(`AlarmRepository.lockPaidAlarmTalks`)과 울림(`RingingService`)이 같은 규칙을 쓴다.
 * 규칙: `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」.
 */
class DefaultVoiceClipSource(
    private val context: Context,
    /** 캐시에 있는 클립만 돌려준다(`AlarmAudioStore.getCachedAudio`). 테스트가 갈아 끼운다. */
    private val cachedAudio: (cacheKey: String, audioUrl: String?) -> CachedAlarmAudio?,
    /** 받아 둔 매니페스트 — 클립과 함께 세트 크기(`expected_variants`)를 쓴다. 테스트가 갈아 끼운다. */
    private val manifest: (userId: String?) -> StockClipListResponse? = { userId ->
        StockClipManifestStore.load(context, userId)
    },
    private val deviceVoiceLanguage: () -> String = {
        val locales = context.resources.configuration.locales
        appVoiceLanguageOf((if (!locales.isEmpty) locales[0] else null)?.language)
    },
) {
    constructor(context: Context, audioStore: AlarmAudioStore) :
        this(context, { key, url -> audioStore.getCachedAudio(key, url) })

    /** 잠금이 행에 묶을 클립 한 벌. */
    data class Binding(val bucket: String, val language: String, val clips: List<DefaultVoiceClip>)

    /** 이 알람을 대신할 기본 목소리 id — 이미 기본 목소리면 그 목소리, 아니면 미나([pickDefaultSystemVoiceId]). */
    fun voiceIdFor(alarm: AlarmEntity): String = pickDefaultSystemVoiceId(alarm.voiceProfileId)

    /**
     * 잠금이 행에 묶을 클립 — 알람의 테마로 (목소리 · 언어)의 세트가 **완전하고 전부** 캐시에 있을 때만.
     * 기본 인사말·직접 입력처럼 기본 목소리 테마가 없거나, 세트가 모자라거나, 하나라도 못 받아
     * 뒀으면 null(`defaultVoiceClipSet`).
     */
    fun lockBinding(alarm: AlarmEntity, voiceId: String, userId: String?): Binding? {
        val bucket = defaultVoiceBucketFor(alarm.bucketId, alarm.voiceRandomContext) ?: return null
        val loaded = runCatching { manifest(userId) }.getOrNull() ?: return null
        for (language in languagesFor(alarm)) {
            val set = defaultVoiceClipSet(loaded.clips, voiceId, bucket, language, loaded.expectedVariants, cachedAudio)
            if (set != null) return Binding(bucket, language, set)
        }
        return null
    }

    /**
     * 울릴 때 이 알람 대신 틀 **기본 목소리 소리의 URI**. 없으면 null(→ 알람음 강제).
     *
     *  1. 알람의 테마로 기본 목소리 클립 — 알람에 적힌 자리([defaultVoiceVariantIndex]).
     *     날씨·운세는 세트가 완전할 때 그 자리만 쓴다(다른 자리는 다른 조건이라 엉뚱한 말을 한다 —
     *     [completeDefaultVoiceClips]). 회전 테마는
     *     그 자리가 없으면 받아 둔 아무 클립이나 쓴다(`resolveBucketClipSelection` 과 같은 폴백).
     *  2. 그 목소리의 **내장 인사말**(APK `res/raw/voice_greeting_*`) — 네트워크 없이 언제나 있다.
     *     새 기본 목소리라 내장본이 없으면 대체 목소리(미나 — [SUBSTITUTE_SYSTEM_VOICE_ID])의 인사말.
     */
    fun ringUri(alarm: AlarmEntity, userId: String?): String? {
        val voiceId = voiceIdFor(alarm)
        val languages = languagesFor(alarm)
        val bucket = defaultVoiceBucketFor(alarm.bucketId, alarm.voiceRandomContext)
        if (bucket != null) {
            val loaded = runCatching { manifest(userId) }.getOrNull()
            for (language in languages) {
                clipUriFor(alarm, loaded, voiceId, bucket, language)?.let { return it }
            }
        }
        val language = languages.first()
        return bundledGreetingUri(voiceId, language)
            ?: bundledGreetingUri(SUBSTITUTE_SYSTEM_VOICE_ID, language)
    }

    private fun clipUriFor(
        alarm: AlarmEntity,
        loaded: StockClipListResponse?,
        voiceId: String,
        bucket: String,
        language: String,
    ): String? {
        val clips = loaded?.clips.orEmpty()
        // 날씨·운세는 자리가 곧 조건이라 **세트가 완전할 때만** 자리를 믿는다(`completeDefaultVoiceClips`) —
        // 가운데가 빠진 목록으로 자리를 세면 다른 조건의 문구를 튼다. 모자라면 내장 인사말로 간다.
        // 회전 테마는 어느 클립이든 같은 종류의 말이라 받아 둔 것을 쓴다.
        val matching: List<StockClip> = if (bucket in MatchingBucketIds) {
            completeDefaultVoiceClips(clips, voiceId, bucket, language, loaded?.expectedVariants) ?: return null
        } else {
            orderedDefaultVoiceClips(clips, voiceId, bucket, language)
        }
        if (matching.isEmpty()) return null
        val keys = matching.map { AlarmAudioStore.STOCK_CACHE_KEY_PREFIX + it.messageId }
        val preferred = alarm.defaultVoiceVariantIndex(bucket, keys)
        val order = when {
            bucket in MatchingBucketIds -> listOfNotNull(preferred)
            preferred != null -> listOf(preferred) + keys.indices.filter { it != preferred }
            else -> keys.indices.toList()
        }
        for (index in order) {
            cachedAudio(keys[index], matching[index].audioUrl)?.let { return it.localAudioUri }
        }
        return null
    }

    private fun bundledGreetingUri(voiceId: String, language: String): String? =
        bundledSystemGreetingRes(voiceId, language)?.let { resId ->
            "android.resource://${context.packageName}/$resId"
        }

    /** 알람에 적힌 언어가 먼저, 그다음 기기 언어(선다운로드가 받는 언어). */
    private fun languagesFor(alarm: AlarmEntity): List<String> =
        listOfNotNull(
            alarm.voiceLanguage?.takeIf { it.isNotBlank() }?.let { appVoiceLanguageOf(it) },
            runCatching { deviceVoiceLanguage() }.getOrDefault("ko"),
        ).distinct()
}
