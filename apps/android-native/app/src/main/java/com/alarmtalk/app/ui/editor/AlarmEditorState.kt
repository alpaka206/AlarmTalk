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

internal fun amPmLabel(hour: Int): String = if (floorMod(hour, 24) < 12) "오전" else "오후"

internal fun hour12(hour: Int): Int = when (val value = floorMod(hour, 12)) {
    0 -> 12
    else -> value
}

internal fun timeUntilAlarmLabel(fireAtMillis: Long): String {
    val millisUntilFire = (fireAtMillis - System.currentTimeMillis()).coerceAtLeast(60_000L)
    val duration = java.time.Duration.ofMillis(millisUntilFire)
    val days = duration.toDays()
    val hours = duration.minusDays(days).toHours()
    val minutes = duration.minusDays(days).minusHours(hours).toMinutes()
    return when {
        days > 0L && hours == 0L -> "약 ${days}일 뒤에 울려요"
        days > 0L -> "약 ${days}일 ${hours}시간 뒤에 울려요"
        hours == 0L -> "${minutes.coerceAtLeast(1)}분 뒤에 울려요"
        minutes == 0L -> "${hours}시간 뒤에 울려요"
        else -> "${hours}시간 ${minutes}분 뒤에 울려요"
    }
}

internal fun googleSignInErrorMessage(statusCode: Int): String = when (statusCode) {
    10 -> "Google 로그인 설정이 맞지 않아요. Android OAuth 클라이언트의 패키지 이름과 SHA-1을 확인해 주세요."
    7 -> "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
    12500 -> "Google 로그인에 실패했어요."
    12501 -> "Google 로그인을 취소했어요."
    12502 -> "Google 로그인이 이미 진행 중이에요."
    else -> "Google 로그인에 실패했어요. status=$statusCode"
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
    var voiceText by mutableStateOf(voiceText ?: "")
    var voiceCategory by mutableStateOf(normalizedTtsCategory(voiceCategory ?: "morning"))
    var voiceLanguage by mutableStateOf(voiceLanguage ?: "ko")
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
    private var generatedTtsKey by mutableStateOf(
        ttsMessageId?.let {
            buildTtsKey(
                profileId = voiceProfileId.orEmpty(),
                text = voiceText.orEmpty(),
                category = if (voiceRandomPrompt) ttsCategoryForRandomContext(voiceRandomContext) else "custom",
                language = voiceLanguage ?: "ko",
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

    fun ttsTextForSave(): String = if (voiceRandomPrompt) "" else voiceText.trim()

    fun hasFreshTtsAudio(profileId: String, text: String): Boolean =
        !localAudioUri.isNullOrBlank() && (
            generatedTtsKey == buildTtsKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage()) ||
                audioCacheKey == AlarmAudioStore.ttsCacheKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage())
            )

    fun setGeneratedTtsAudio(
        audio: CachedAlarmAudio,
        profileId: String,
        text: String,
        messageId: String,
        rawAudioUri: String?,
    ) {
        voiceSource = VoiceSources.TTS_PROFILE
        voiceProfileId = profileId
        voiceText = text
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        this.rawAudioUri = rawAudioUri ?: audio.rawAudioUri
        ttsMessageId = messageId.takeIf { it.isNotBlank() }
        generatedTtsKey = buildTtsKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage())
    }

    fun setStockClipAudio(
        audio: CachedAlarmAudio,
        profileId: String,
        messageId: String,
        text: String,
    ) {
        voiceSource = VoiceSources.TTS_PROFILE
        voiceProfileId = profileId
        voiceRandomPrompt = false
        voiceTranslationEnabled = false
        voiceText = text
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        rawAudioUri = audio.rawAudioUri
        ttsMessageId = messageId.takeIf { it.isNotBlank() }
        generatedTtsKey = buildTtsKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage())
    }

    fun activeVoiceLanguage(): String =
        if (voiceRandomPrompt || voiceTranslationEnabled) voiceLanguage else "ko"

    fun activeVoiceCategory(): String =
        if (voiceRandomPrompt) ttsCategoryForRandomContext(voiceRandomContext) else "custom"

    fun shouldTranslateVoiceText(): Boolean =
        !voiceRandomPrompt && voiceTranslationEnabled && voiceLanguage != "ko"

    fun setPendingServerTts(message: TtsMessage) {
        voiceSource = VoiceSources.SERVER_TTS
        ttsMessageId = message.id
        voiceProfileId = message.voiceProfileId
        voiceText = message.text
        voiceCategory = message.category ?: "custom"
        voiceRandomPrompt = false
        localAudioUri = null
        audioCacheKey = null
        rawAudioUri = message.audioUrl
        generatedTtsKey = null
    }

    fun setServerTtsAudio(
        audio: CachedAlarmAudio,
        messageId: String,
        text: String,
        category: String?,
        voiceProfileId: String?,
        rawAudioUri: String?,
    ) {
        voiceSource = VoiceSources.SERVER_TTS
        ttsMessageId = messageId
        voiceText = text
        voiceCategory = category ?: "custom"
        voiceRandomPrompt = false
        this.voiceProfileId = voiceProfileId
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        this.rawAudioUri = rawAudioUri ?: audio.rawAudioUri
        generatedTtsKey = null
    }

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
            )
        }
    }
}

internal fun buildTtsKey(profileId: String, text: String, category: String, language: String): String =
    listOf(profileId, text.trim(), category, language).joinToString("|")

internal fun normalizedTtsCategory(category: String): String {
    val legacy = mapOf(
        "afternoon" to "cheer",
        "sleep" to "night",
        "medicine" to "health",
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
        "exercise" -> "health"
        "love" -> "love"
        else -> "morning"
    }

internal fun randomContextUsesWeather(context: String?): Boolean =
    when (normalizedRandomPromptContext(context ?: DefaultRandomPromptContext)) {
        "wake_weather", "meal", "exercise" -> true
        else -> false
    }

private const val DefaultRandomTtsCategory = "morning"
// 기본은 추가 입력이 필요 없는 고정 문구(preset) — 목소리만 고르면 바로 저장할 수 있다.
internal const val DefaultRandomPromptContext = "preset"
internal const val MinVoiceVolumePercent = 30
