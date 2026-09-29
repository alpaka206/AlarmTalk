package com.alarmtalk.app.data

import com.alarmtalk.app.FreeBucketOrder
import com.alarmtalk.app.clonePrerenderBucketCategoryFor
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.randomPromptContextForBucket
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName

/*
 * 유료 목소리를 못 쓰게 된 알람의 **기본 목소리 대체** — 판정만 모은 순수 함수들이다.
 *
 * 규칙의 유일 출처는 `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면 — 기본 목소리로
 * 울고, 절대 조용하지 않다」다. 울림 쪽 약속은 `docs/spec/alarm-ringing.md` §4.
 *
 * 2026-09-29 dev 리허설(SM-A325N): 기간 한정 개인 플랜이 끝난 뒤 클론 목소리 알람이 **아무 소리
 * 없이** 울렸다. 잠금이 그 알람을 '알람' 모드로 내렸고, '알람' 모드는 목소리 알람이라 한 번도
 * 쓰이지 않던 알람음 스위치(꺼짐)를 봤다. 그래서 이제 잠금·울림 강등은 '알람' 모드가 아니라
 * **기본 목소리**로 간다.
 *
 * iOS 짝은 `DefaultVoiceSubstitute.swift` — 한쪽만 고치지 말 것.
 */

/**
 * 대체할 **기본(시스템) 목소리**를 고른다.
 *
 *  1. 알람이 이미 기본 목소리면 그 목소리(목소리를 바꿀 이유가 없다).
 *  2. 그 계정이 마지막에 쓴 목소리가 기본 목소리면 그것(`DefaultVoicePreferenceStore` —
 *     클론이면 건너뛴다. 그 목소리를 못 쓰게 돼서 여기 왔다).
 *  3. 둘 다 아니면 기본 목소리 목록의 첫 값.
 */
fun pickDefaultSystemVoiceId(alarmVoiceId: String?, lastUsedVoiceId: String?): String =
    alarmVoiceId?.takeIf { isSystemVoiceId(it) }
        ?: lastUsedVoiceId?.takeIf { isSystemVoiceId(it) }
        ?: bundledSystemVoiceProfiles().first().id

/**
 * 기본 목소리로 틀 **무료 테마(버킷)** — 알람이 고른 문구 종류에서 유도한다.
 *
 * 테마가 붙어 있으면 그 테마가 답이다(울릴 때 무엇이 나올지 정하는 것은 `bucketId` 다 —
 * 옛 이름 `love` 는 `cheer` 로 접는다). 없으면 문구 종류를 테마로 옮긴다
 * ([clonePrerenderBucketCategoryFor]). 기본 목소리에 그 종류의 클립이 **없으면** null —
 * 기본 인사말(`greeting`)·직접 입력이 그렇다. 그때 울림은 내장 인사말로 간다.
 */
fun defaultVoiceBucketFor(bucketId: String?, voiceRandomContext: String?): String? {
    val fromBucket = bucketId?.trim()?.takeIf { it.isNotEmpty() }?.let { if (it == "love") "cheer" else it }
    val candidate = fromBucket ?: clonePrerenderBucketCategoryFor(voiceRandomContext)
    return candidate?.takeIf { it in FreeBucketOrder }
}

/** 기본 목소리 클립 한 개 — 캐시에 **있는** 것만 만든다. */
data class DefaultVoiceClip(
    val messageId: String,
    val cacheKey: String,
    val text: String,
    val localAudioUri: String,
    val rawAudioUri: String?,
)

/**
 * (목소리 · 테마 · 언어)의 클립을 **variant 순으로** — 정렬·중복 제거는 편집기와 같다
 * (`sortedBy { variant }.distinctBy { variant }`). 세트가 완전한지는 보지 않는다.
 */
fun orderedDefaultVoiceClips(
    clips: List<StockClip>,
    voiceProfileId: String,
    bucket: String,
    language: String,
): List<StockClip> =
    clips
        .filter { it.voiceProfileId == voiceProfileId && it.category == bucket && (it.language ?: "ko") == language }
        .sortedBy { it.variant }
        .distinctBy { it.variant }

/**
 * (목소리 · 테마 · 언어)의 클립 — **세트가 완전할 때만**(variant 0..N-1 이 빠짐없이). 아니면 null.
 *
 * ⚠ **매니페스트에 온 것을 그대로 완전한 세트로 읽지 말 것**(Codex #820). 날씨·운세는 자리 번호가
 * 곧 조건이라(`keys[i]` = variant i), 가운데 variant 하나가 빠진 목록을 순서대로 묶으면 뒤 자리가
 * 통째로 밀려 **다른 조건의 문구**를 튼다 — 운세는 세트 크기로 자리를 계산하므로 크기만 달라도
 * 엉뚱한 자리가 나온다. 그래서 편집기(`freeBucketsFor`)·재바인더(`replacementIsComplete`)와 같이
 * 서버의 `expected_variants` 로 N 을 정한다. 서버가 개수를 모르면(옛 서버) 받은 개수를 N 으로 보되
 * **0 부터 빈틈없이** 이어져야 한다 — 빈틈을 알아챌 수 있는 것은 거르고, 꼬리가 잘린 것은 알 길이 없다.
 */
fun completeDefaultVoiceClips(
    clips: List<StockClip>,
    voiceProfileId: String,
    bucket: String,
    language: String,
    expectedVariants: ExpectedVariantCounts?,
): List<StockClip>? {
    val ordered = orderedDefaultVoiceClips(clips, voiceProfileId, bucket, language)
    if (ordered.isEmpty()) return null
    val expected = expectedVariants
        ?.countFor(bucket, isSystemVoice = isSystemVoiceId(voiceProfileId))
        ?.takeIf { it > 0 }
        ?: ordered.size
    return ordered.takeIf { set -> set.map { it.variant } == (0 until expected).toList() }
}

/**
 * (목소리 · 테마 · 언어)의 클립을 **variant 순으로, 세트가 완전하고 전부 캐시에 있을 때만** 모은다.
 *
 * ⚠ **하나라도 빠지면 null 이다 — 있는 것만 모으지 말 것.** 날씨·운세는 자리 번호가 곧
 * 조건이라(`keys[i]` = variant i), 빠진 클립을 건너뛰어 묶으면 뒤 자리가 통째로 밀려 **맑은
 * 날에 우산 얘기**를 한다. 편집기(`bindStockBucketClips`)가 빠진 것을 받아서라도 전부 묶는
 * 것과 같은 계약이다 — 여기서는 네트워크를 부르지 않으므로 못 받은 것이 있으면 묶지 않는다.
 * 매니페스트 자체가 모자란 경우는 [completeDefaultVoiceClips] 가 거른다.
 */
fun defaultVoiceClipSet(
    clips: List<StockClip>,
    voiceProfileId: String,
    bucket: String,
    language: String,
    expectedVariants: ExpectedVariantCounts?,
    cached: (cacheKey: String, audioUrl: String?) -> CachedAlarmAudio?,
): List<DefaultVoiceClip>? {
    val complete = completeDefaultVoiceClips(clips, voiceProfileId, bucket, language, expectedVariants)
        ?: return null
    return complete.map { clip ->
        val key = AlarmAudioStore.STOCK_CACHE_KEY_PREFIX + clip.messageId
        val audio = cached(key, clip.audioUrl) ?: return null
        DefaultVoiceClip(
            messageId = clip.messageId,
            cacheKey = audio.cacheKey ?: key,
            text = clip.text,
            localAudioUri = audio.localAudioUri,
            rawAudioUri = audio.rawAudioUri,
        )
    }
}

/**
 * **울릴 때 쓸 기본 목소리 클립 자리** — 알람에 이미 적힌 값으로 고른다(네트워크 없음).
 *
 * 클론과 기본 목소리는 테마마다 variant 축이 같다(백엔드 `STOCK_CLIP_PRESETS` ↔
 * `CLONE_CLIP_SEEDS` — 날씨 9·운세 5). 그래서 알람의 날씨 조건 인덱스·사주·회전 자리를
 * 그대로 기본 목소리 클립 목록에 대면 된다 — [bucketVariantIndex] 를 그대로 쓴다.
 */
fun AlarmEntity.defaultVoiceVariantIndex(bucket: String, clipKeys: List<String>): Int? =
    copy(bucketId = bucket, bucketClipKeysJson = encodeBucketClipKeys(clipKeys)).bucketVariantIndex()

/**
 * 잠그기 전의 **유료 목소리 필드** — 잠금 보관본([AlarmEntity.preLockVoiceJson])의 모양.
 *
 * 재생 방식은 여기 없다 — 예전처럼 [AlarmEntity.preLockPlayMode] 에 둔다.
 * Gson 이 코틀린 기본값을 적용하지 않으므로(리플렉션 생성) 전부 nullable 로 둔다.
 *
 * ⚠ **필드마다 `@SerializedName` 으로 키를 못 박는다 — 빼지 말 것.** 이 JSON 은 Room 컬럼에
 * 남아 **앱 업데이트를 건너서** 읽힌다. release 는 R8 이 필드 이름을 줄이므로(`{"a":…}`),
 * 키가 없으면 매핑이 바뀐 다음 빌드가 보관본을 null 이나 **엉뚱한 필드**로 읽는다 — 재결제한
 * 사용자의 알람이 목소리 없이 되돌아가 서버에까지 올라간다. `proguard-rules.pro` 가
 * `@SerializedName` 필드를 지킨다(로보렉트릭은 R8 을 거치지 않아 이 사고를 못 잡는다).
 * 키 이름을 바꾸면 이미 잠긴 행을 못 읽는다 — 바꾸지 말고 새 키를 더한다.
 */
data class LockedPaidVoice(
    @SerializedName("voiceSource") val voiceSource: String? = null,
    @SerializedName("voiceProfileId") val voiceProfileId: String? = null,
    @SerializedName("voiceListenerTitle") val voiceListenerTitle: String? = null,
    @SerializedName("voiceText") val voiceText: String? = null,
    @SerializedName("voiceCategory") val voiceCategory: String? = null,
    @SerializedName("voiceLanguage") val voiceLanguage: String? = null,
    @SerializedName("voiceRandomPrompt") val voiceRandomPrompt: Boolean? = null,
    @SerializedName("voiceRandomContext") val voiceRandomContext: String? = null,
    @SerializedName("localAudioUri") val localAudioUri: String? = null,
    @SerializedName("audioCacheKey") val audioCacheKey: String? = null,
    @SerializedName("rawAudioUri") val rawAudioUri: String? = null,
    @SerializedName("ttsMessageId") val ttsMessageId: String? = null,
    @SerializedName("bucketId") val bucketId: String? = null,
    @SerializedName("bucketRotationIndex") val bucketRotationIndex: Int? = null,
    @SerializedName("bucketClipKeysJson") val bucketClipKeysJson: String? = null,
    @SerializedName("bucketClipTextsJson") val bucketClipTextsJson: String? = null,
    @SerializedName("contextVariantIndex") val contextVariantIndex: Int? = null,
    @SerializedName("contextResolvedAtMillis") val contextResolvedAtMillis: Long? = null,
    @SerializedName("dynamicVoicePreparedForFireAtMillis") val dynamicVoicePreparedForFireAtMillis: Long? = null,
) {
    /** 이 보관본이 붙들고 있는 캐시 키 — 캐시 정리가 지우지 않게 참조로 센다. */
    fun referencedCacheKeys(): List<String> =
        listOfNotNull(audioCacheKey?.takeIf { it.isNotBlank() }) + decodeBucketClipKeys(bucketClipKeysJson)

    companion object {
        private val gson = Gson()

        fun of(alarm: AlarmEntity) = LockedPaidVoice(
            voiceSource = alarm.voiceSource,
            voiceProfileId = alarm.voiceProfileId,
            voiceListenerTitle = alarm.voiceListenerTitle,
            voiceText = alarm.voiceText,
            voiceCategory = alarm.voiceCategory,
            voiceLanguage = alarm.voiceLanguage,
            voiceRandomPrompt = alarm.voiceRandomPrompt,
            voiceRandomContext = alarm.voiceRandomContext,
            localAudioUri = alarm.localAudioUri,
            audioCacheKey = alarm.audioCacheKey,
            rawAudioUri = alarm.rawAudioUri,
            ttsMessageId = alarm.ttsMessageId,
            bucketId = alarm.bucketId,
            bucketRotationIndex = alarm.bucketRotationIndex,
            bucketClipKeysJson = alarm.bucketClipKeysJson,
            bucketClipTextsJson = alarm.bucketClipTextsJson,
            contextVariantIndex = alarm.contextVariantIndex,
            contextResolvedAtMillis = alarm.contextResolvedAtMillis,
            dynamicVoicePreparedForFireAtMillis = alarm.dynamicVoicePreparedForFireAtMillis,
        )

        fun encode(value: LockedPaidVoice): String = gson.toJson(value)

        /** 깨진 값은 null — 보관본 하나 때문에 알람을 못 읽으면 안 된다. */
        fun decode(json: String?): LockedPaidVoice? =
            json?.takeIf { it.isNotBlank() }?.let {
                runCatching { gson.fromJson(it, LockedPaidVoice::class.java) }.getOrNull()
            }
    }
}

/** 새 모양(기본 목소리로 고쳐 쓰고 원래 목소리를 보관)으로 잠긴 행인가. */
fun AlarmEntity.hasLockedPaidVoice(): Boolean = !preLockVoiceJson.isNullOrBlank()

fun AlarmEntity.lockedPaidVoice(): LockedPaidVoice? = LockedPaidVoice.decode(preLockVoiceJson)

/**
 * **이 행을 말하게 할 유료 목소리 자원이 있는가** — 재생 방식은 보지 않는다.
 *
 * `AlarmRepository.lockPaidAlarmTalks` 의 `usesVoice` 와 `RingingService` 의 판정이 쓰는
 * 같은 식이다(재생 방식만으로 '유료 목소리' 라고 하지 말 것 — 2026-08-18).
 */
fun AlarmEntity.hasVoiceResources(): Boolean =
    !localAudioUri.isNullOrBlank() ||
        !rawAudioUri.isNullOrBlank() ||
        !voiceProfileId.isNullOrBlank() ||
        !ttsMessageId.isNullOrBlank()

/**
 * **이 버전 전에 잠긴 옛 모양**인가 — `alarm_only` 로 내리고 원래 모드를 `preLockPlayMode` 에
 * 담았지만 보관본은 없고, 클론 참조가 행에 그대로 남아 있다.
 *
 * 목소리 삭제 강등(`degradeMatchingLocalOwnedVoiceAlarms`)도 같은 표시를 남기지만 그쪽은
 * 목소리 참조를 **비운다** — 그래서 [hasVoiceResources] 로 갈린다. 다음 잠금 실행이 이 모양을
 * 새 모양으로 옮기고, 그 전에 울리면 울림 경로가 기본 목소리로 대신한다.
 */
fun AlarmEntity.isLegacyPlanLock(): Boolean =
    origin == AlarmOrigins.LOCAL_OWNED &&
        !hasLockedPaidVoice() &&
        wasVoiceAlarmConvertedBySystem() &&
        hasVoiceResources() &&
        // 옛 규칙(직접 녹음 = 유료)으로 잠긴 녹음·기본 목소리 알람은 유료가 아니다 — 잠금
        // 실행이 그 행을 풀어 준다(`lockPaidAlarmTalks` 의 되돌리기 갈래).
        !copy(playMode = AlarmPlayModes.normalize(preLockPlayMode)).usesFreeSystemVoiceAlarm()

/**
 * **시스템이 목소리 알람을 '알람' 모드로 바꿔 둔 행**인가 — 목소리 삭제·공유 해제 강등이
 * 남긴 표시(`preLockPlayMode` 가 목소리 모드)나 옛 모양 잠금.
 *
 * 이런 행의 알람음 스위치는 목소리 알람 시절에 한 번도 쓰이지 않던 값이라, 꺼져 있어도
 * **사용자가 고른 무음이 아니다** — 울릴 때 알람음을 강제한다(alarm-ringing.md §4).
 */
fun AlarmEntity.wasVoiceAlarmConvertedBySystem(): Boolean =
    !preLockPlayMode.isNullOrBlank() &&
        AlarmPlayModes.normalize(preLockPlayMode) != AlarmPlayModes.ALARM_ONLY &&
        AlarmPlayModes.normalize(playMode) == AlarmPlayModes.ALARM_ONLY

/**
 * 유료 목소리 알람을 **기본 목소리 알람으로 잠근다**(순수 — 행을 쓰는 것은 호출부).
 *
 * - 재생 방식은 원래 값 그대로다(옛 모양이면 `preLockPlayMode` 의 값). 목록·편집기에서
 *   '그냥 기본 알람' 이 되지 않는다 — 2026-09-29 리허설의 지적.
 * - [clips] 가 있으면 편집기가 테마를 붙일 때(`AlarmEditorState.setBucketAudio`)와 같은
 *   모양으로 묶는다. null 이면 오디오 없는 기본 목소리 알람으로 둔다 — 울릴 때
 *   `RingingService` 가 그 목소리의 클립·내장 인사말을 찾는다.
 * - ⚠ **오디오 없이 두어도 테마는 남긴다**(Codex #820). 기본 목소리 테마가 있는 종류(날씨·운세·
 *   응원·약)인데 클립을 다 받아 두지 못했을 때다. 테마를 비우면 편집기가 그 알람의 종류를 잃어
 *   (iOS 는 첫 테마로 바꿔 붙인다) 시각만 고쳐 저장해도 문구가 바뀌고, 날씨 조건 갱신
 *   (`ensureDynamicVoiceRefreshScheduled` 는 `bucketId == "weather"` 만 본다)도 멈춰 울릴 때 대체
 *   클립이 낡은 조건을 고른다. 테마가 남아 있으면 편집기는 저장할 때 그 테마의 클립을 받아 묶는다.
 *   기본 인사말·직접 입력은 기본 목소리 테마가 없으니 비운다(서버가 기본 목소리 + greeting 을 거절한다).
 * - 문구 종류(`voiceRandomContext`)는 그대로 둔다 — 편집기 요약이 고른 종류를 말한다.
 * - 원래 목소리 필드는 [LockedPaidVoice] 로 보관한다. 이미 보관본이 있으면 **덮지 않는다**
 *   (다시 잠그면 원래 값을 잃는다).
 * - 동기 상태는 건드리지 않는다 — 잠금은 예전처럼 로컬만 고친다.
 */
fun AlarmEntity.lockedToDefaultVoice(
    systemVoiceId: String,
    bucket: String?,
    language: String?,
    clips: List<DefaultVoiceClip>?,
    nowMillis: Long,
): AlarmEntity {
    val originalMode = preLockPlayMode?.takeIf { it.isNotBlank() } ?: playMode
    val snapshot = preLockVoiceJson?.takeIf { it.isNotBlank() } ?: LockedPaidVoice.encode(LockedPaidVoice.of(this))
    val bound = clips?.takeIf { bucket != null && it.isNotEmpty() }
    // 묶은 테마가 없으면 알람의 종류에서 유도한 테마(없으면 null — 기본 인사말·직접 입력).
    val theme = bucket ?: defaultVoiceBucketFor(bucketId, voiceRandomContext)
    val base = copy(
        playMode = AlarmPlayModes.normalize(originalMode),
        preLockPlayMode = originalMode,
        preLockVoiceJson = snapshot,
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = systemVoiceId,
        // 호칭은 클론 문구에 녹아 있던 것이라 기본 목소리 클립과 무관하다.
        voiceListenerTitle = null,
        voiceRandomPrompt = false,
        voiceRandomContext = voiceRandomContext ?: randomPromptContextForBucket(theme ?: bucketId),
        updatedAtMillis = nowMillis,
    )
    if (bound == null) {
        return base.copy(
            // 직접 입력은 친 문구를 남긴다(편집기 상세 카드가 보여 준다). 그 밖에는 클론이
            // 읽던 문장이라, 기본 목소리가 다른 말을 하는 동안 잠금화면에 남기지 않는다.
            voiceText = voiceText.takeIf { usesCustomMessageVoice() },
            localAudioUri = null,
            audioCacheKey = null,
            rawAudioUri = null,
            ttsMessageId = null,
            bucketId = theme,
            bucketClipKeysJson = null,
            bucketClipTextsJson = null,
            bucketRotationIndex = if (theme != null && theme == bucketId) bucketRotationIndex else 0,
        )
    }
    val first = bound.first()
    return base.copy(
        voiceText = first.text,
        voiceLanguage = language ?: voiceLanguage,
        localAudioUri = first.localAudioUri,
        audioCacheKey = first.cacheKey,
        rawAudioUri = first.rawAudioUri,
        ttsMessageId = first.messageId,
        bucketId = bucket,
        bucketClipKeysJson = encodeBucketClipKeys(bound.map { it.cacheKey }),
        bucketClipTextsJson = encodeBucketClipKeys(bound.map { it.text }),
        // 같은 테마면 회전 자리를 이어 간다(날씨 조건 인덱스는 variant 축이 같아 그대로 쓴다).
        bucketRotationIndex = if (bucket == bucketId) bucketRotationIndex else 0,
    )
}

/**
 * 잠금을 풀어 **원래 유료 목소리로 되돌린다**(순수).
 *
 * 보관본이 없는 옛 모양·강등 표시는 예전처럼 재생 방식만 되돌린다. 보관본이 있으면 목소리
 * 필드까지 되돌리고 **동기화 대상으로 올린다** — 잠긴 동안 켜기·끄기가 기본 목소리를 서버에
 * 올렸을 수 있다(`nextLocalSyncState`).
 */
fun AlarmEntity.restoredFromLock(nowMillis: Long): AlarmEntity {
    val mode = preLockPlayMode?.takeIf { it.isNotBlank() } ?: playMode
    val snapshot = lockedPaidVoice()
        ?: return copy(playMode = mode, preLockPlayMode = null, preLockVoiceJson = null, updatedAtMillis = nowMillis)
    return copy(
        playMode = mode,
        preLockPlayMode = null,
        preLockVoiceJson = null,
        voiceSource = snapshot.voiceSource ?: voiceSource,
        voiceProfileId = snapshot.voiceProfileId,
        voiceListenerTitle = snapshot.voiceListenerTitle,
        voiceText = snapshot.voiceText,
        voiceCategory = snapshot.voiceCategory,
        voiceLanguage = snapshot.voiceLanguage,
        voiceRandomPrompt = snapshot.voiceRandomPrompt ?: false,
        voiceRandomContext = snapshot.voiceRandomContext,
        localAudioUri = snapshot.localAudioUri,
        audioCacheKey = snapshot.audioCacheKey,
        rawAudioUri = snapshot.rawAudioUri,
        ttsMessageId = snapshot.ttsMessageId,
        bucketId = snapshot.bucketId,
        bucketRotationIndex = snapshot.bucketRotationIndex ?: 0,
        bucketClipKeysJson = snapshot.bucketClipKeysJson,
        bucketClipTextsJson = snapshot.bucketClipTextsJson,
        contextVariantIndex = snapshot.contextVariantIndex,
        contextResolvedAtMillis = snapshot.contextResolvedAtMillis,
        dynamicVoicePreparedForFireAtMillis = snapshot.dynamicVoicePreparedForFireAtMillis,
        syncState = nextLocalSyncState(),
        updatedAtMillis = nowMillis,
    )
}

/**
 * 잠금을 **확정**한다 — 보관 기간이 지나 원래 목소리가 지워졌다. 보관본과 표시를 버리고
 * 지금의 기본 목소리 알람으로 남긴다. 알람음으로 내리지 않는다.
 */
fun AlarmEntity.finalizedLock(nowMillis: Long): AlarmEntity =
    copy(preLockPlayMode = null, preLockVoiceJson = null, updatedAtMillis = nowMillis)
