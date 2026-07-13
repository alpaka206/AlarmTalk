package com.alarmtalk.app

import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.network.TtsMessage
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

internal fun hour12(hour: Int): Int = when (val value = floorMod(hour, 12)) {
    0 -> 12
    else -> value
}

internal fun timeUntilAlarmLabel(context: android.content.Context, fireAtMillis: Long): String {
    val millisUntilFire = (fireAtMillis - System.currentTimeMillis()).coerceAtLeast(60_000L)
    val duration = java.time.Duration.ofMillis(millisUntilFire)
    val days = duration.toDays()
    val hours = duration.minusDays(days).toHours()
    val minutes = duration.minusDays(days).minusHours(hours).toMinutes()
    return when {
        days > 0L && hours == 0L -> context.getString(R.string.r3ed_time_until_days, days)
        days > 0L -> context.getString(R.string.r3ed_time_until_days_hours, days, hours)
        hours == 0L -> context.getString(R.string.r3ed_time_until_minutes, minutes.coerceAtLeast(1))
        minutes == 0L -> context.getString(R.string.r3ed_time_until_hours, hours)
        else -> context.getString(R.string.r3ed_time_until_hours_minutes, hours, minutes)
    }
}

internal fun googleSignInErrorMessage(context: android.content.Context, statusCode: Int): String = when (statusCode) {
    10 -> context.getString(R.string.r3ed_google_signin_error_config)
    7 -> context.getString(R.string.r3ed_google_signin_error_network)
    12500 -> context.getString(R.string.r3ed_google_signin_error_failed)
    12501 -> context.getString(R.string.r3ed_google_signin_error_canceled)
    12502 -> context.getString(R.string.r3ed_google_signin_error_in_progress)
    else -> context.getString(R.string.r3ed_google_signin_error_failed_status, statusCode)
}

internal fun supportedAppVoiceLanguage(language: String?): String = when (language) {
    "en" -> "en"
    "ja" -> "ja"
    else -> "ko"
}

internal class AlarmEditorState(
    label: String,
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    holidayOff: Boolean,
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    snoozeRepeatLimit: Int,
    vibrationPattern: String,
    playMode: String,
    localAudioUri: String?,
    audioCacheKey: String?,
    rawAudioUri: String?,
    voiceSource: String,
    voiceProfileId: String?,
    voiceListenerTitle: String?,
    voiceText: String?,
    voiceCategory: String?,
    voiceLanguage: String?,
    voiceRandomPrompt: Boolean,
    voiceRandomContext: String?,
    voiceWeatherCountry: String?,
    voiceWeatherCity: String?,
    voiceWeatherLatitude: Double? = null,
    voiceWeatherLongitude: Double? = null,
    voiceFortuneGender: String?,
    voiceFortuneBirthDate: String?,
    voiceFortuneBirthTime: String?,
    voiceRepeat: Boolean,
    voiceVolumePercent: Int,
    ttsMessageId: String?,
    alarmVolumePercent: Int,
    alarmSoundUri: String?,
    alarmSoundLabel: String?,
    bucketId: String? = null,
    bucketClipKeysJson: String? = null,
) {
    var label by mutableStateOf(label)
    var hour by mutableIntStateOf(hour)
    var minute by mutableIntStateOf(minute)
    var repeatDaysMask by mutableIntStateOf(repeatDaysMask)
    var holidayOff by mutableStateOf(holidayOff)
    var snoozeEnabled by mutableStateOf(snoozeEnabled)
    var snoozeMinutes by mutableIntStateOf(snoozeMinutes)
    var snoozeRepeatLimit by mutableIntStateOf(snoozeRepeatLimit)
    var vibrationPattern by mutableStateOf(vibrationPattern)
    var playMode by mutableStateOf(playMode)
    var localAudioUri by mutableStateOf(localAudioUri)
    var audioCacheKey by mutableStateOf(audioCacheKey)
    var rawAudioUri by mutableStateOf(rawAudioUri)
    var voiceSource by mutableStateOf(voiceSource)
    var voiceProfileId by mutableStateOf(voiceProfileId)
    // 알람별 호칭 덮어쓰기. 비어 있으면 선택한 목소리 프로필의 호칭(listener_title)을 그대로 쓴다.
    // (DB 저장 없이 편집 세션 동안만 유지 — TTS 생성 요청의 listenerTitle 로만 전달)
    var voiceListenerTitleOverride by mutableStateOf(voiceListenerTitle ?: "")
    var voiceText by mutableStateOf(voiceText ?: "")
    var voiceCategory by mutableStateOf(normalizedTtsCategory(voiceCategory ?: "morning"))
    var voiceLanguage by mutableStateOf(supportedAppVoiceLanguage(voiceLanguage))
    var voiceRandomPrompt by mutableStateOf(voiceRandomPrompt)
    var voiceRandomContext by mutableStateOf(normalizedRandomPromptContext(voiceRandomContext ?: DefaultRandomPromptContext))
    var voiceWeatherCountry by mutableStateOf(voiceWeatherCountry ?: "")
    var voiceWeatherCity by mutableStateOf(voiceWeatherCity ?: "")
    var voiceWeatherLatitude by mutableStateOf(voiceWeatherLatitude)
    var voiceWeatherLongitude by mutableStateOf(voiceWeatherLongitude)
    var voiceFortuneGender by mutableStateOf(voiceFortuneGender ?: "")
    var voiceFortuneBirthDate by mutableStateOf(voiceFortuneBirthDate ?: "")
    var voiceFortuneBirthTime by mutableStateOf(voiceFortuneBirthTime ?: "")
    var voiceTranslationEnabled by mutableStateOf(!voiceRandomPrompt && (voiceLanguage ?: "ko") != "ko")
    var voiceRepeat by mutableStateOf(voiceRepeat)
    var voiceVolumePercent by mutableIntStateOf(voiceVolumePercent.coerceIn(MinVoiceVolumePercent, 100))
    var ttsMessageId by mutableStateOf(ttsMessageId)
    var alarmVolumePercent by mutableIntStateOf(alarmVolumePercent.coerceIn(0, 100))
    var alarmSoundUri by mutableStateOf(alarmSoundUri)
    var alarmSoundLabel by mutableStateOf(alarmSoundLabel)
    // 무료 버킷 회전: 선택한 버킷 카테고리, 미리 캐시한 N개 클립의 cacheKey JSON,
    // 그리고 그 클립이 어떤 보이스로 캐시됐는지(보이스 변경 시 재선택 판단용, 영속 안 함).
    var selectedBucket by mutableStateOf(bucketId)
    var bucketClipKeysJson by mutableStateOf(bucketClipKeysJson)
    var bucketResolvedForProfileId by mutableStateOf(if (bucketId != null) voiceProfileId else null)
    private var generatedTtsKey by mutableStateOf(
        ttsMessageId?.let {
            buildTtsKey(
                profileId = voiceProfileId.orEmpty(),
                text = voiceText.orEmpty(),
                category = if (voiceRandomPrompt) ttsCategoryForRandomContext(voiceRandomContext) else "custom",
                language = supportedAppVoiceLanguage(voiceLanguage),
                listenerTitle = voiceListenerTitle,
            )
        },
    )

    fun toDraft(): AlarmDraft {
        val alarmOnly = playMode == AlarmPlayModes.ALARM_ONLY
        return AlarmDraft(
            label = label,
            hour = hour,
            minute = minute,
            repeatDaysMask = repeatDaysMask,
            holidayOff = holidayOff,
            snoozeEnabled = snoozeEnabled,
            snoozeMinutes = snoozeMinutes,
            snoozeRepeatLimit = snoozeRepeatLimit,
            vibrationPattern = vibrationPattern,
            playMode = playMode,
            localAudioUri = if (alarmOnly) null else localAudioUri,
            audioCacheKey = if (alarmOnly) null else audioCacheKey,
            rawAudioUri = if (alarmOnly) null else rawAudioUri,
            voiceSource = if (alarmOnly) VoiceSources.LOCAL_AUDIO else voiceSource,
            voiceProfileId = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else voiceProfileId,
            voiceListenerTitle = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) {
                null
            } else {
                voiceListenerTitleOverride.trim().takeIf { it.isNotBlank() }
            },
            voiceText = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else ttsTextForSave(),
            voiceCategory = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else activeVoiceCategory(),
            voiceLanguage = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else activeVoiceLanguage(),
            voiceRandomPrompt = !alarmOnly && voiceSource != VoiceSources.LOCAL_AUDIO && voiceRandomPrompt,
            voiceRandomContext = if (
                alarmOnly ||
                voiceSource == VoiceSources.LOCAL_AUDIO ||
                !voiceRandomPrompt
            ) {
                null
            } else {
                normalizedRandomPromptContext(voiceRandomContext)
            },
            voiceWeatherCountry = if (voiceRandomPrompt && randomContextUsesWeather(voiceRandomContext)) {
                voiceWeatherCountry.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceWeatherCity = if (voiceRandomPrompt && randomContextUsesWeather(voiceRandomContext)) {
                voiceWeatherCity.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceFortuneGender = if (voiceRandomPrompt && normalizedRandomPromptContext(voiceRandomContext) == "wake_fortune") {
                voiceFortuneGender.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceFortuneBirthDate = if (voiceRandomPrompt && normalizedRandomPromptContext(voiceRandomContext) == "wake_fortune") {
                voiceFortuneBirthDate.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceFortuneBirthTime = if (voiceRandomPrompt && normalizedRandomPromptContext(voiceRandomContext) == "wake_fortune") {
                voiceFortuneBirthTime.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceRepeat = if (alarmOnly) true else voiceRepeat,
            voiceVolumePercent = if (alarmOnly) 100 else voiceVolumePercent.coerceIn(MinVoiceVolumePercent, 100),
            ttsMessageId = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else ttsMessageId?.takeIf { it.isNotBlank() },
            // 실제 버킷 회전 알람일 때만 저장 — 유료가 기존 버킷 알람을 일반/랜덤 TTS 로 바꾸면
            // 남아 있던 selectedBucket/clipKeys 를 persist 하지 않도록(울림 시 옛 버킷 오디오 방지).
            bucketId = if (isActiveBucketAlarm()) selectedBucket else null,
            bucketClipKeysJson = if (isActiveBucketAlarm()) bucketClipKeysJson else null,
            alarmVolumePercent = alarmVolumePercent.coerceIn(0, 100),
            alarmSoundUri = alarmSoundUri,
            alarmSoundLabel = alarmSoundLabel,
        )
    }

    fun setCachedAudio(audio: CachedAlarmAudio) {
        voiceSource = VoiceSources.LOCAL_AUDIO
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        rawAudioUri = audio.rawAudioUri
        clearBucketSelection()
        clearTtsMeta()
    }

    fun clearAudio() {
        localAudioUri = null
        audioCacheKey = null
        rawAudioUri = null
    }

    fun clearTtsMeta() {
        ttsMessageId = null
        generatedTtsKey = null
    }

    /** 현재 편집 상태가 실제 버킷 회전 알람인지 — 대표 클립이 버킷 클립 목록에 포함될 때만 true. */
    private fun isActiveBucketAlarm(): Boolean {
        if (playMode == AlarmPlayModes.ALARM_ONLY || voiceSource == VoiceSources.LOCAL_AUDIO) return false
        if (selectedBucket == null) return false
        val keys = com.alarmtalk.app.data.decodeBucketClipKeys(bucketClipKeysJson)
        return keys.isNotEmpty() && audioCacheKey != null && keys.contains(audioCacheKey)
    }

    /** 버킷(회전) 메타데이터를 비운다. 일반/생성/녹음 등 비-버킷 경로로 전환할 때 호출. */
    private fun clearBucketSelection() {
        selectedBucket = null
        bucketClipKeysJson = null
        bucketResolvedForProfileId = null
    }

    fun selectVoiceProfile(profileId: String?) {
        if (voiceProfileId != profileId) {
            voiceListenerTitleOverride = ""
        }
        voiceProfileId = profileId
        clearTtsMeta()
    }

    fun ttsTextForSave(): String = if (voiceRandomPrompt) "" else voiceText.trim()

    fun hasFreshTtsAudio(profileId: String, text: String, listenerTitle: String? = null): Boolean {
        val listenerTitleForKey = listenerTitle?.trim()?.takeIf { it.isNotBlank() }
            ?: voiceListenerTitleOverride.trim().takeIf { it.isNotBlank() }
        return !localAudioUri.isNullOrBlank() && (
            generatedTtsKey == buildTtsKey(
                profileId = profileId,
                text = text,
                category = activeVoiceCategory(),
                language = activeVoiceLanguage(),
                listenerTitle = listenerTitleForKey,
            ) ||
                (listenerTitleForKey.isNullOrBlank() && audioCacheKey == AlarmAudioStore.ttsCacheKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage()))
            )
    }

    fun hasSelectedStockClipAudio(profileId: String, text: String): Boolean =
        !localAudioUri.isNullOrBlank() &&
            audioCacheKey?.startsWith("stock_") == true &&
            generatedTtsKey == buildTtsKey(
                profileId = profileId,
                text = text,
                category = activeVoiceCategory(),
                language = activeVoiceLanguage(),
            )

    fun setGeneratedTtsAudio(
        audio: CachedAlarmAudio,
        profileId: String,
        text: String,
        messageId: String,
        rawAudioUri: String?,
        listenerTitle: String? = null,
    ) {
        voiceSource = VoiceSources.TTS_PROFILE
        voiceProfileId = profileId
        // 생성 TTS 로 전환 — 버킷 메타를 비워 activeVoiceLanguage/저장이 옛 버킷에 끌리지 않게.
        clearBucketSelection()
        voiceText = text
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        this.rawAudioUri = rawAudioUri ?: audio.rawAudioUri
        ttsMessageId = messageId.takeIf { it.isNotBlank() }
        generatedTtsKey = buildTtsKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage(), listenerTitle)
    }

    fun setStockClipAudio(
        audio: CachedAlarmAudio,
        profileId: String,
        messageId: String,
        text: String,
    ) {
        voiceSource = VoiceSources.TTS_PROFILE
        voiceProfileId = profileId
        voiceListenerTitleOverride = ""
        voiceRandomPrompt = false
        voiceTranslationEnabled = false
        clearBucketSelection()
        voiceText = text
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        rawAudioUri = audio.rawAudioUri
        ttsMessageId = messageId.takeIf { it.isNotBlank() }
        generatedTtsKey = buildTtsKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage())
    }

    /**
     * 무료 버킷 선택 결과를 상태에 반영한다. 대표(변형0) 클립을 단일 재생 폴백으로 박고,
     * 회전용 N개 클립의 cacheKey 목록을 저장한다. 랜덤 문구 생성과는 무관(voiceRandomPrompt=false).
     */
    fun setBucketAudio(
        audio: CachedAlarmAudio,
        profileId: String,
        messageId: String,
        text: String,
        language: String,
        bucket: String,
        clipKeys: List<String>,
    ) {
        voiceSource = VoiceSources.TTS_PROFILE
        voiceProfileId = profileId
        voiceListenerTitleOverride = ""
        voiceRandomPrompt = false
        voiceTranslationEnabled = false
        voiceText = text
        voiceLanguage = language
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        rawAudioUri = audio.rawAudioUri
        ttsMessageId = messageId.takeIf { it.isNotBlank() }
        selectedBucket = bucket
        bucketClipKeysJson = com.alarmtalk.app.data.encodeBucketClipKeys(clipKeys)
        bucketResolvedForProfileId = profileId
        generatedTtsKey = buildTtsKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage())
    }

    fun activeVoiceLanguage(): String = supportedAppVoiceLanguage(voiceLanguage)

    fun activeVoiceCategory(): String =
        if (voiceRandomPrompt) ttsCategoryForRandomContext(voiceRandomContext) else "custom"

    fun shouldTranslateVoiceText(): Boolean =
        !voiceRandomPrompt && activeVoiceLanguage() != "ko"

    companion object {
        fun from(
            alarm: AlarmEntity?,
            defaultPlayMode: String = AlarmPlayModes.ALARM_ONLY,
        ): AlarmEditorState {
            val defaultTime = java.time.LocalTime.of(6, 0)
            return AlarmEditorState(
                label = alarm?.label ?: "",
                hour = alarm?.hour ?: defaultTime.hour,
                minute = alarm?.minute ?: defaultTime.minute,
                repeatDaysMask = alarm?.repeatDaysMask ?: 0,
                holidayOff = alarm?.holidayOff ?: false,
                snoozeEnabled = alarm?.snoozeEnabled ?: true,
                snoozeMinutes = alarm?.snoozeMinutes ?: 5,
                snoozeRepeatLimit = alarm?.snoozeRepeatLimit ?: SnoozeRepeatLimits.THREE,
                vibrationPattern = alarm?.vibrationPattern ?: VibrationPatterns.DEFAULT,
                playMode = alarm?.playMode ?: defaultPlayMode,
                localAudioUri = alarm?.localAudioUri,
                audioCacheKey = alarm?.audioCacheKey,
                rawAudioUri = alarm?.rawAudioUri,
                voiceSource = alarm?.voiceSource ?: VoiceSources.TTS_PROFILE,
                voiceProfileId = alarm?.voiceProfileId,
                voiceListenerTitle = alarm?.voiceListenerTitle,
                voiceText = alarm?.voiceText,
                voiceCategory = alarm?.voiceCategory ?: "morning",
                voiceLanguage = alarm?.voiceLanguage ?: "ko",
                // 새 알람은 랜덤(기본 문구) ON — 목소리만 고르면 추가 입력 없이 저장 가능.
                voiceRandomPrompt = alarm?.voiceRandomPrompt ?: alarm?.let {
                    it.voiceSource == VoiceSources.TTS_PROFILE && it.voiceText.isNullOrBlank()
                } ?: true,
                voiceRandomContext = alarm?.voiceRandomContext ?: DefaultRandomPromptContext,
                voiceWeatherCountry = alarm?.voiceWeatherCountry,
                voiceWeatherCity = alarm?.voiceWeatherCity,
                voiceFortuneGender = alarm?.voiceFortuneGender,
                voiceFortuneBirthDate = alarm?.voiceFortuneBirthDate,
                voiceFortuneBirthTime = alarm?.voiceFortuneBirthTime,
                voiceRepeat = alarm?.voiceRepeat ?: true,
                voiceVolumePercent = alarm?.voiceVolumePercent ?: 100,
                ttsMessageId = alarm?.ttsMessageId,
                alarmVolumePercent = alarm?.alarmVolumePercent ?: 100,
                alarmSoundUri = alarm?.alarmSoundUri,
                alarmSoundLabel = alarm?.alarmSoundLabel,
                bucketId = alarm?.bucketId,
                bucketClipKeysJson = alarm?.bucketClipKeysJson,
            )
        }
    }
}

internal fun buildTtsKey(
    profileId: String,
    text: String,
    category: String,
    language: String,
    listenerTitle: String? = null,
): String =
    listOf(profileId, text.trim(), category, language, listenerTitle?.trim().orEmpty()).joinToString("|")

internal fun normalizedTtsCategory(category: String): String {
    val legacy = mapOf(
        "afternoon" to "cheer",
        "sleep" to "night",
        "medicine" to "medication",
    )
    val resolved = legacy[category] ?: category
    return if (TtsCategories.any { (key, _) -> key == resolved }) resolved else DefaultRandomTtsCategory
}

internal fun normalizedRandomPromptContext(context: String): String =
    when (context) {
        "daily", "weather" -> "wake_weather"
        "fortune" -> "wake_fortune"
        else -> if (RandomPromptContexts.any { (key, _) -> key == context }) context else DefaultRandomPromptContext
    }

internal fun ttsCategoryForRandomContext(context: String?): String =
    when (normalizedRandomPromptContext(context ?: DefaultRandomPromptContext)) {
        "meal" -> "lunch"
        "sleep" -> "night"
        "exercise" -> "exercise"
        "love" -> "love"
        "medication" -> "medication"
        else -> "morning"
    }

internal fun randomContextUsesWeather(context: String?): Boolean =
    when (normalizedRandomPromptContext(context ?: DefaultRandomPromptContext)) {
        "wake_weather", "meal", "exercise" -> true
        else -> false
    }

/**
 * 유료 클론 사전렌더 클립으로 '오프라인 버킷'을 붙일 수 있는 컨텍스트 → 백엔드 category.
 * 이 category 로 stockClips 를 필터해 셀렉트 버킷 경로를 재사용한다(bucketId=category).
 * 날씨/운세는 발사 시점 조건/테마 매칭(준비창 워커)이 있어야 정확하므로, 그 전까지는 여기서
 * null 을 돌려 기존 라이브 생성 경로를 유지한다(항상 variant0 오재 방지).
 */
internal fun clonePrerenderBucketCategoryFor(context: String?): String? =
    when (normalizedRandomPromptContext(context ?: "")) {
        "love" -> "love"
        "medication" -> "medication"
        else -> null
    }

private const val DefaultRandomTtsCategory = "morning"
// 기본은 추가 입력이 필요 없는 고정 문구(preset) — 목소리만 고르면 바로 저장할 수 있다.
internal const val DefaultRandomPromptContext = "preset"
internal const val MinVoiceVolumePercent = 30
