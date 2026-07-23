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
import com.alarmtalk.app.data.isSystemVoiceId
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

// 매핑 단일 출처는 data.appVoiceLanguageOf. MainViewModel 과 어긋나지 않도록 여기서도 그걸 위임한다.
internal fun supportedAppVoiceLanguage(language: String?): String =
    com.alarmtalk.app.data.appVoiceLanguageOf(language)

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
    alarmSoundEnabled: Boolean = true,
    bucketId: String? = null,
    bucketClipKeysJson: String? = null,
    bucketClipTextsJson: String? = null,
    contextVariantIndex: Int? = null,
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
    // 알람음(기상 톤) on/off. off 면 알람은 울리되(화면·진동·음성) 톤만 재생 안 함.
    var alarmSoundEnabled by mutableStateOf(alarmSoundEnabled)
    // 무료 버킷 회전: 선택한 버킷 카테고리, 미리 캐시한 N개 클립의 cacheKey JSON,
    // 그리고 그 클립이 어떤 보이스로 캐시됐는지(보이스 변경 시 재선택 판단용, 영속 안 함).
    var selectedBucket by mutableStateOf(bucketId)
    var bucketClipKeysJson by mutableStateOf(bucketClipKeysJson)
    var bucketClipTextsJson by mutableStateOf(bucketClipTextsJson)
    var bucketResolvedForProfileId by mutableStateOf(if (bucketId != null) voiceProfileId else null)
    // 날씨 버킷: 저장 시점에 서버가 resolve 한 조건 인덱스 스냅샷(발사 오프라인 lookup 용). 기존
    // 알람 편집 시 값을 보존해야 재저장으로 인덱스가 null 로 날아가지 않는다. 운세는 발사 시점 기기
    // 계산이라 안 담고, 회전형(사랑/약)도 null.
    var contextVariantIndex by mutableStateOf(contextVariantIndex)
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
            // 날씨는 라이브 랜덤 알람뿐 아니라 '날씨 버킷' 알람도 위치가 있어야 준비창 워커가 조건을
            // resolve 한다(없으면 서버가 서울로 폴백). 운세 버킷도 사주가 있어야 온디바이스 테마 계산.
            voiceWeatherCountry = if (weatherContextForSave()) {
                voiceWeatherCountry.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceWeatherCity = if (weatherContextForSave()) {
                voiceWeatherCity.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceFortuneGender = if (fortuneContextForSave()) {
                voiceFortuneGender.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceFortuneBirthDate = if (fortuneContextForSave()) {
                voiceFortuneBirthDate.trim().takeIf { it.isNotBlank() }
            } else {
                null
            },
            voiceFortuneBirthTime = if (fortuneContextForSave()) {
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
            bucketClipTextsJson = if (isActiveBucketAlarm()) bucketClipTextsJson else null,
            contextVariantIndex = if (isActiveBucketAlarm()) contextVariantIndex else null,
            alarmVolumePercent = alarmVolumePercent.coerceIn(0, 100),
            alarmSoundUri = alarmSoundUri,
            alarmSoundLabel = alarmSoundLabel,
            alarmSoundEnabled = alarmSoundEnabled,
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

    // 날씨/운세 컨텍스트가 '저장에 위치/사주를 남겨야 하는가': 라이브 랜덤 알람이거나, 그 컨텍스트의
    // 오프라인 클론 버킷 알람이면 true(준비창 워커·온디바이스 테마 계산이 그 필드를 쓴다).
    private fun weatherContextForSave(): Boolean =
        (voiceRandomPrompt && randomContextUsesWeather(voiceRandomContext)) ||
            (isActiveBucketAlarm() && selectedBucket == "weather")

    private fun fortuneContextForSave(): Boolean =
        (voiceRandomPrompt && normalizedRandomPromptContext(voiceRandomContext) == "wake_fortune") ||
            (isActiveBucketAlarm() && selectedBucket == "fortune")

    /** 버킷(회전) 메타데이터를 비운다. 일반/생성/녹음 등 비-버킷 경로로 전환할 때 호출. */
    private fun clearBucketSelection() {
        selectedBucket = null
        bucketClipKeysJson = null
        bucketResolvedForProfileId = null
    }

    /**
     * F2: 제한(날씨+약) 모드에서 허용되지 않는 잔재 — 직접 입력 문구, 생성 TTS 오디오,
     * 운세/사랑 등 비허용 버킷 메타 — 가 남아 있는지. 허용 버킷으로 이 프로필에 해석된
     * 상태면 정상이므로 false. generatedTtsKey 가 private 이라 판정도 state 안에서 한다.
     */
    fun hasRestrictedVoiceRemnants(allowedBuckets: List<String>): Boolean {
        val validBucket = selectedBucket in allowedBuckets &&
            bucketResolvedForProfileId == voiceProfileId
        if (validBucket) return false
        return voiceText.isNotBlank() || generatedTtsKey != null ||
            !localAudioUri.isNullOrBlank() || selectedBucket != null
    }

    /**
     * F2: 제한(날씨+약) 모드에서 허용되지 않는 잔재를 비운다. 기존 알람 편집처럼
     * selectVoiceProfile 이 불리지 않는 경로에서 남겨두면, 신선한 오디오가 /tts
     * 재호출 없이 그대로 저장돼 직접 입력 제한이 우회된다(Codex #599).
     */
    fun clearRestrictedVoiceRemnants() {
        voiceText = ""
        clearAudio()
        clearTtsMeta()
        clearBucketSelection()
    }

    fun selectVoiceProfile(profileId: String?) {
        val changed = voiceProfileId != profileId
        if (changed) {
            voiceListenerTitleOverride = ""
        }
        voiceProfileId = profileId
        // 시스템(기본) 보이스는 날씨+약 버킷만 허용 → 이전에 고른 운세/사랑/직접입력 잔여 컨텍스트를
        // 비워 무효 카테고리가 저장되지 않게 한다. 실제 버킷은 편집 화면 LaunchedEffect 가 재해석한다.
        if (changed && isSystemVoiceId(profileId)) {
            voiceRandomPrompt = false
            voiceText = ""
            clearBucketSelection()
        }
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
        clipTexts: List<String> = emptyList(),
        contextVariantIndex: Int? = null,
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
        bucketClipTextsJson = com.alarmtalk.app.data.encodeBucketClipKeys(clipTexts)
        bucketResolvedForProfileId = profileId
        this.contextVariantIndex = contextVariantIndex
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
            // 새 알람의 기본 문구 종류. 호출측이 '마지막에 고른 문구'를 넘기고, 없으면
            // '기본 인사말'(preset)로 폴백한다. 기존 알람은 자신의 voiceRandomContext 를 쓴다.
            defaultRandomContext: String = DefaultRandomPromptContext,
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
                // 마지막 문구 기억은 '신규 알람'에만 적용. 기존 알람(수동/알람전용 등 context=null 포함)은
                // 자기 값(없으면 기본 preset)을 그대로 써, 편집만 열어도 문구가 바뀌는 일이 없게 한다.
                voiceRandomContext = if (alarm == null) {
                    defaultRandomContext
                } else {
                    alarm.voiceRandomContext ?: DefaultRandomPromptContext
                },
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
                alarmSoundEnabled = alarm?.alarmSoundEnabled ?: true,
                bucketId = alarm?.bucketId,
                bucketClipKeysJson = alarm?.bucketClipKeysJson,
                bucketClipTextsJson = alarm?.bucketClipTextsJson,
                contextVariantIndex = alarm?.contextVariantIndex,
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
 * - 사랑/약: 매칭 불필요(순차 회전).
 * - 날씨: 저장 시점에 서버 /tts/prerender-variant 로 조건 인덱스를 1회 스냅샷(현행 동적 알람과
 *   동일 신선도). 발사는 오프라인 lookup. (매일 갱신은 준비창 워커 후속 enhancement)
 * - 운세: 사주+날짜 결정적 계산이라 발사 시점 기기에서 매일 신선하게 고른다(네트워크 0).
 */
internal fun clonePrerenderBucketCategoryFor(context: String?): String? =
    when (normalizedRandomPromptContext(context ?: "")) {
        "preset" -> "greeting"
        "love" -> "love"
        "medication" -> "medication"
        // 운세: 발사 시점 기기에서 매일 신선 계산이라 반복 알람도 정확(fortuneThemeIndex).
        "wake_fortune" -> "fortune"
        // 날씨: 실시간 판정이 서버 전용이라, 저장 직후(runOnce) + 반복이면 준비창에 DynamicVoiceRefreshWorker
        // →AlarmRepository.resolveDueCloneBucketVariants 가 저장 위치로 서버(/tts/prerender-variant)에
        // 조건을 resolve 해 contextVariantIndex 를 갱신한다(편집기가 저장 시점에 직접 resolve 하지는 않음).
        // 발사는 그 인덱스로 오프라인 lookup.
        "wake_weather" -> "weather"
        else -> null
    }

private const val DefaultRandomTtsCategory = "morning"
// 기본은 추가 입력이 필요 없는 고정 문구(preset) — 목소리만 고르면 바로 저장할 수 있다.
internal const val DefaultRandomPromptContext = "preset"
internal const val MinVoiceVolumePercent = 30
