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
    voiceRepeat: Boolean,
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
    var voiceTranslationEnabled by mutableStateOf(!voiceRandomPrompt && (voiceLanguage ?: "ko") != "ko")
    var voiceRepeat by mutableStateOf(voiceRepeat)
    var ttsMessageId by mutableStateOf(ttsMessageId)
    var alarmVolumePercent by mutableIntStateOf(alarmVolumePercent.coerceIn(0, 100))
    var alarmSoundUri by mutableStateOf(alarmSoundUri)
    var alarmSoundLabel by mutableStateOf(alarmSoundLabel)
    private var generatedTtsKey by mutableStateOf(
        ttsMessageId?.let {
            buildTtsKey(
                profileId = voiceProfileId.orEmpty(),
                text = voiceText.orEmpty(),
                category = if (voiceRandomPrompt) normalizedTtsCategory(voiceCategory ?: "morning") else "custom",
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
            voiceRepeat = if (alarmOnly) true else voiceRepeat,
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
            randomTtsPrompt(voiceCategory, activeVoiceLanguage())
        } else {
            voiceText.trim()
        }

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

    fun activeVoiceLanguage(): String =
        if (voiceRandomPrompt || voiceTranslationEnabled) voiceLanguage else "ko"

    fun activeVoiceCategory(): String =
        if (voiceRandomPrompt) normalizedTtsCategory(voiceCategory) else "custom"

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
                voiceRandomPrompt = alarm?.voiceRandomPrompt ?: alarm?.let {
                    it.voiceSource == VoiceSources.TTS_PROFILE && it.voiceText.isNullOrBlank()
                } ?: false,
                voiceRepeat = alarm?.voiceRepeat ?: true,
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

internal fun normalizedTtsCategory(category: String): String =
    if (RandomTtsPrompts.containsKey(category)) category else DefaultRandomTtsCategory

internal fun randomTtsPromptOptions(category: String, language: String): List<String> {
    val categoryPrompts = RandomTtsPrompts[normalizedTtsCategory(category)]
        ?: RandomTtsPrompts.getValue(DefaultRandomTtsCategory)
    return categoryPrompts[language]
        ?: categoryPrompts["ko"]
        ?: RandomTtsPrompts.getValue(DefaultRandomTtsCategory).getValue("ko")
}

internal fun randomTtsPrompt(category: String, language: String): String =
    randomTtsPromptOptions(category, language).random()

private const val DefaultRandomTtsCategory = "morning"

private val RandomTtsPrompts = mapOf(
    "morning" to mapOf(
        "ko" to listOf("좋은 아침이야, 오늘도 화이팅!", "일어나, 오늘도 좋은 하루 보내자!", "굿모닝! 오늘 하루도 힘내!"),
        "en" to listOf("Good morning. It is time to wake up.", "Wake up and have a good day.", "Good morning. Start your day with energy."),
        "ja" to listOf("おはよう。起きる時間です。", "今日もいい一日にしましょう。", "おはよう。ゆっくり一日を始めましょう。"),
    ),
    "lunch" to mapOf(
        "ko" to listOf("점심 잘 챙겨 먹어, 맛있는 거 먹어!", "밥 먹었어? 꼭 챙겨 먹어!", "점심시간이다! 맛있게 먹고 오후도 파이팅!"),
        "en" to listOf("It is lunch time. Enjoy your meal.", "Take a short break and have lunch.", "Time for lunch. Recharge for the afternoon."),
        "ja" to listOf("お昼の時間です。しっかり食べましょう。", "少し休んで、お昼を楽しみましょう。", "午後のために、お昼で元気を出しましょう。"),
    ),
    "afternoon" to mapOf(
        "ko" to listOf("오후도 힘내, 조금만 더 파이팅!", "오후 슬럼프가 와도 괜찮아. 잠깐 쉬고 다시 가자!", "조금만 더 하면 끝이야, 화이팅!"),
        "en" to listOf("Keep going this afternoon.", "Take a breath and continue your afternoon.", "You are close. Keep it steady."),
        "ja" to listOf("午後ももう少し頑張りましょう。", "少し休んで、午後も続けましょう。", "あと少しです。落ち着いていきましょう。"),
    ),
    "evening" to mapOf(
        "ko" to listOf("오늘도 고생 많았어, 수고했어!", "퇴근 축하해! 오늘 하루도 잘 보냈어!", "고생했어, 이제 편하게 쉬어!"),
        "en" to listOf("You worked hard today.", "Good job today. It is time to rest.", "The day is almost done. Take it easy."),
        "ja" to listOf("今日もお疲れさまでした。", "一日よく頑張りました。休みましょう。", "お疲れさま。ゆっくりしましょう。"),
    ),
    "night" to mapOf(
        "ko" to listOf("오늘 하루도 잘 보냈어, 푹 자!", "잘 자, 좋은 꿈 꿔!", "내일도 좋은 하루 될 거야. 굿나잇!"),
        "en" to listOf("Sleep well and have a good night.", "Good night. Rest well.", "Let today go and sleep comfortably."),
        "ja" to listOf("おやすみなさい。よく眠ってね。", "いい夢を見てください。", "今日はここまで。ゆっくり休みましょう。"),
    ),
    "sleep" to mapOf(
        "ko" to listOf("이제 하루를 정리하고 편하게 쉬어요.", "내일을 위해 잠들 준비를 해요.", "불을 끄고 천천히 잠들 시간이에요."),
        "en" to listOf("It is time to wind down and rest.", "Prepare for sleep and let today go.", "Turn off the lights and sleep well."),
        "ja" to listOf("そろそろ休む時間です。", "明日のために眠る準備をしましょう。", "電気を消して、ゆっくり眠りましょう。"),
    ),
    "medicine" to mapOf(
        "ko" to listOf("약 먹을 시간이에요. 물과 함께 챙겨 주세요.", "건강을 위해 지금 약을 챙겨요.", "잊지 말고 약을 복용해 주세요."),
        "en" to listOf("It is time to take your medicine with water.", "Please take your medicine now.", "Do not forget your medicine."),
        "ja" to listOf("薬を飲む時間です。水と一緒に飲みましょう。", "健康のために、今薬を飲みましょう。", "薬を忘れずに飲んでください。"),
    ),
    "study" to mapOf(
        "ko" to listOf("공부할 시간이에요. 오늘도 한 문장부터 시작해요.", "짧게라도 공부 루틴을 이어가요.", "집중할 시간이에요. 차분하게 시작해요."),
        "en" to listOf("It is study time. Start with one sentence.", "Keep your study routine going today.", "Time to focus. Begin calmly."),
        "ja" to listOf("勉強する時間です。一文から始めましょう。", "今日も勉強の習慣を続けましょう。", "集中する時間です。落ち着いて始めましょう。"),
    ),
    "cheer" to mapOf(
        "ko" to listOf("넌 할 수 있어, 믿어!", "힘들어도 포기하지 마, 항상 응원해!", "넌 정말 대단한 사람이야!"),
        "en" to listOf("You can do this. I believe in you.", "Do not give up. I am cheering for you.", "You are doing great."),
        "ja" to listOf("あなたならできます。信じています。", "あきらめないで。応援しています。", "本当によく頑張っています。"),
    ),
    "love" to mapOf(
        "ko" to listOf("사랑해, 항상 고마워!", "네가 있어서 행복해!", "보고 싶어, 빨리 보자!"),
        "en" to listOf("I love you. Thank you always.", "I am happy because you are here.", "I miss you. Let us meet soon."),
        "ja" to listOf("大好きです。いつもありがとう。", "あなたがいてくれて幸せです。", "会いたいです。またすぐ会いましょう。"),
    ),
    "health" to mapOf(
        "ko" to listOf("물 한 잔 마시고 건강 챙겨!", "오늘 스트레칭 했어? 몸 좀 풀어!", "잠깐 일어나서 몸을 움직여요."),
        "en" to listOf("Drink some water and take care of yourself.", "Stretch for a moment and loosen up.", "Stand up and move your body a little."),
        "ja" to listOf("水を飲んで、体を大切にしましょう。", "少しストレッチして体をほぐしましょう。", "少し立って体を動かしましょう。"),
    ),
)
