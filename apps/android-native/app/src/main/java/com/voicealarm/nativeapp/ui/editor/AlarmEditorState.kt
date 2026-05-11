package com.voicealarm.nativeapp

import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import com.voicealarm.nativeapp.data.AlarmAudioStore
import com.voicealarm.nativeapp.data.AlarmDraft
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.SnoozeRepeatLimits
import com.voicealarm.nativeapp.data.VibrationPatterns
import com.voicealarm.nativeapp.data.VoiceSources
import com.voicealarm.nativeapp.network.TtsMessage
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
    var voiceCategory by mutableStateOf(voiceCategory ?: "morning")
    var voiceLanguage by mutableStateOf(voiceLanguage ?: "ko")
    var voiceTranslationEnabled by mutableStateOf((voiceLanguage ?: "ko") != "ko")
    var voiceRandomPrompt by mutableStateOf(voiceRandomPrompt)
    var ttsMessageId by mutableStateOf(ttsMessageId)
    var alarmVolumePercent by mutableIntStateOf(alarmVolumePercent.coerceIn(0, 100))
    var alarmSoundUri by mutableStateOf(alarmSoundUri)
    var alarmSoundLabel by mutableStateOf(alarmSoundLabel)
    private var generatedTtsKey by mutableStateOf(
        ttsMessageId?.let {
            buildTtsKey(
                profileId = voiceProfileId.orEmpty(),
                text = voiceText.orEmpty(),
                category = voiceCategory ?: "morning",
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
            voiceCategory = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else voiceCategory,
            voiceLanguage = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else activeVoiceLanguage(),
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

    fun ttsTextForSave(): String =
        if (voiceRandomPrompt && voiceText.isBlank()) {
            randomTtsPrompt(voiceCategory, "ko")
        } else {
            voiceText.trim()
        }

    fun hasFreshTtsAudio(profileId: String, text: String): Boolean =
        !localAudioUri.isNullOrBlank() && (
            generatedTtsKey == buildTtsKey(profileId, text, voiceCategory, activeVoiceLanguage()) ||
                audioCacheKey == AlarmAudioStore.ttsCacheKey(profileId, text, voiceCategory, activeVoiceLanguage())
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
        generatedTtsKey = buildTtsKey(profileId, text, voiceCategory, activeVoiceLanguage())
    }

    fun activeVoiceLanguage(): String = if (voiceTranslationEnabled) voiceLanguage else "ko"

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
        fun from(alarm: AlarmEntity?): AlarmEditorState {
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
                playMode = alarm?.playMode ?: AlarmPlayModes.ALARM_ONLY,
                localAudioUri = alarm?.localAudioUri,
                audioCacheKey = alarm?.audioCacheKey,
                rawAudioUri = alarm?.rawAudioUri,
                voiceSource = alarm?.voiceSource ?: VoiceSources.TTS_PROFILE,
                voiceProfileId = alarm?.voiceProfileId,
                voiceText = alarm?.voiceText,
                voiceCategory = alarm?.voiceCategory ?: "morning",
                voiceLanguage = alarm?.voiceLanguage ?: "ko",
                voiceRandomPrompt = alarm?.let {
                    it.voiceSource == VoiceSources.TTS_PROFILE && it.voiceText.isNullOrBlank()
                } ?: false,
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

internal fun randomTtsPrompt(category: String, language: String): String {
    val ko = when (category) {
        "lunch" -> listOf("점심 시간이에요. 잠깐 쉬고 맛있게 챙겨 먹어요.", "몸도 마음도 충전할 시간이에요.")
        "sleep" -> listOf("이제 하루를 정리하고 편하게 쉬어요.", "내일을 위해 잠들 준비를 해요.")
        "medicine" -> listOf("약 먹을 시간이에요. 물과 함께 챙겨 주세요.", "건강을 위해 지금 약을 챙겨요.")
        "study" -> listOf("영어 공부할 시간이에요. 오늘도 한 문장부터 시작해요.", "짧게라도 영어 루틴을 이어가요.")
        else -> listOf("일어날 시간이에요. 오늘도 차분하게 시작해요.", "좋은 아침이에요. 지금 일어나요.")
    }
    val en = when (category) {
        "lunch" -> listOf("It is lunch time. Take a short break and recharge.", "Time for lunch. Enjoy your meal.")
        "sleep" -> listOf("It is time to wind down and get some rest.", "Prepare for sleep and let today go.")
        "medicine" -> listOf("It is time to take your medicine with water.", "Please take your medicine now.")
        "study" -> listOf("It is English study time. Start with one sentence.", "Keep your English routine going today.")
        else -> listOf("Good morning. It is time to wake up.", "Wake up now and start your day calmly.")
    }
    val ja = when (category) {
        "sleep" -> listOf("そろそろ休む時間です。ゆっくり眠りましょう。")
        "study" -> listOf("英語を勉強する時間です。短く始めましょう。")
        else -> listOf("起きる時間です。今日も落ち着いて始めましょう。")
    }
    val pool = when (language) {
        "en" -> en
        "ja" -> ja
        else -> ko
    }
    return pool.random()
}

private fun translateAlarmTextIfNeeded(text: String, category: String, language: String, enabled: Boolean): String {
    if (!enabled || language == "ko" || text.none { it in '\uAC00'..'\uD7A3' }) return text
    return when (language) {
        "en" -> when {
            text.contains("점심") -> "It is lunch time. Take a short break and recharge."
            text.contains("약") -> "It is time to take your medicine with water."
            text.contains("공부") || text.contains("영어") -> "It is study time. Start with one small step."
            text.contains("자") || text.contains("잠") || text.contains("쉬") -> "It is time to wind down and get some rest."
            text.contains("일어나") || text.contains("기상") || text.contains("아침") -> "Good morning. It is time to wake up."
            else -> randomTtsPrompt(category, "en")
        }
        "ja" -> when {
            text.contains("공부") || text.contains("영어") -> "勉強する時間です。短く始めましょう。"
            text.contains("자") || text.contains("잠") || text.contains("쉬") -> "そろそろ休む時間です。ゆっくり眠りましょう。"
            else -> randomTtsPrompt(category, "ja")
        }
        else -> text
    }
}
