package com.alarmtalk.app

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
    // 옛 행에 섞여 있던 delivery 태그를 그대로 실으면 사용자가 그걸 자기 문구로 알고 고치게
    // 되고, 그 순간 서버는 '사용자가 친 대괄호'로 보아 영구 보존한다. 실을 때 한 번 벗겨 그
    // 고리를 끊되, **생성 문구일 때만** 벗긴다 — 직접 입력한 문구의 대괄호는 사용자 것이라
    // 건드리면 저장 시 영구히 사라진다(Codex #660).
    var voiceText by mutableStateOf(voiceText?.stripDeliveryTags(generated = voiceRandomPrompt) ?: "")
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
            // **버킷 알람도 종류를 남긴다.** 버킷은 저장 직전 setBucketAudio 가 붙이면서
            // voiceRandomPrompt 를 끄므로, `!voiceRandomPrompt` 만 보고 떨어뜨리면 사용자가
            // 고른 문구 종류가 통째로 사라진다. 유료 클론은 5종이 전부 버킷으로 매핑돼
            // (clonePrerenderBucketCategoryFor) 사실상 **모든 저장**에서 사라졌고, 그래서
            // (1) 다음 새 알람이 '기본 인사말'로 되돌아가고 (2) 이 알람을 다시 열면
            // '직접 입력'으로 보였다. 바로 아래 weatherContextForSave()/fortuneContextForSave()
            // 도 같은 이유로 버킷을 예외 처리한다 — 판정을 하나만 고치지 말 것.
            voiceRandomContext = if (
                alarmOnly ||
                voiceSource == VoiceSources.LOCAL_AUDIO ||
                isManualForSave()
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
            // ⚠ **목소리는 항상 반복한다**(2026-08-27 지시). 선택지를 없앴으므로 저장값도
            // 늘 true 다 — 옛 행에 false 가 남아 있어도 다음 저장에서 true 로 올라온다.
            // 한 번만 나고 그치면 그것은 알림이지 알람이 아니다.
            voiceRepeat = true,
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

    /**
     * 현재 편집 상태가 실제 버킷 회전 알람인지 — 대표 클립이 버킷 클립 목록에 포함될 때만 true.
     *
     * '직접 입력'과의 구분에도 쓰는 단일 출처다. 버킷 알람도 저장될 때 voiceRandomPrompt=false 에
     * voiceText=클립문구가 되므로, `!voiceRandomPrompt` 만으로 판별하면 버킷 알람이 직접 입력으로
     * 오분류된다(그 오분류 때문에 2026-07-21 에 문구 프리필이 통째로 제거됐었다).
     *
     * **표시 판정식은 `!voiceRandomPrompt && !hasBucketMessageChoice()` 다**(2026-08-16 분리 —
     * 위 `hasBucketMessageChoice` 주석 참조). 저장·오디오 판정식은 `!isActiveBucketAlarm()` 이고,
     * 각 갈래 안에서는 여전히 **철자까지 같아야 한다.**
     * 예전 주석: 판정식 `!voiceRandomPrompt && !isActiveBucketAlarm()` 을 쓰는 자리는 셋이고, 셋이 같아야
     * 한다**: 저장([toDraft] 의 voiceRandomContext), 문구 pane 프리셀렉트(`AlarmEditorScreen` 의
     * `random_prompt` → randomContext·manualText), 요약 행(`VoiceAudioCard` 의 isManual).
     * 2026-08-05 에 요약 행만 맞고 나머지가 틀려, 행은 '사랑'인데 눌러 열면 '직접 입력'이었다.
     */
    fun isActiveBucketAlarm(): Boolean {
        if (playMode == AlarmPlayModes.ALARM_ONLY || voiceSource == VoiceSources.LOCAL_AUDIO) return false
        return hasBucketMessageChoice()
    }

    /**
     * **사용자가 고른 문구가 테마(버킷)인가 — 재생 방식과 무관하다.**
     *
     * ⚠ **`isActiveBucketAlarm()` 과 용도가 다르다. 둘을 합치지 말 것**(2026-08-16 분리).
     * 저쪽은 "**울릴 때** 버킷 클립을 쓰는가" 를 묻고, 그래서 알람 전용·직접 녹음이면
     * false 다 — 그건 맞다. 그런데 그 함수를 **문구 종류 표시**에도 쓰고 있어서,
     * 재생 방식을 '알람' 으로 바꾸는 것만으로 요약 행이 `약` → `직접 입력` 으로 뒤집혔다
     * (실기기 확인: `bucket=medication` 은 그대로인데 `active` 만 true → false).
     * 고른 문구는 그대로인데 재생 방식만 바뀐 것이므로 **표시가 틀린 것**이다.
     *
     * 나누는 기준:
     *  - **표시**(요약 행·pane 프리셀렉트·직접입력 여부) → `hasBucketMessageChoice()`
     *  - **저장·오디오 바인딩**(`toDraft`, 버킷 필드, 컨텍스트 플래그) → `isActiveBucketAlarm()`
     */
    /**
     * **사용자가 테마 종류를 골랐는가 — 클립이 아직 안 묶였어도.**
     *
     * ⚠ [hasBucketMessageChoice] 와 다르다. 저쪽은 클립이 **실제로 묶였는지**(`audioCacheKey`
     * 가 클립 목록에 있는지)까지 보므로, 방금 고르고 아직 바인딩 전이면 false 다.
     * 저장 직전 갈래를 가를 때는 그 구분이 필요하다 — 2026-08-31 에 저 함수를 쓰다가
     * **무료·기본 목소리 테마 알람이 유료 게이트에 걸렸다**(클립이 아직 없어 직접입력으로 읽혔다).
     */
    fun hasChosenBucketKind(): Boolean = selectedBucket != null

    /**
     * **저장 관점에서 직접 입력인가.** 저장·오디오 바인딩·컨텍스트 플래그가 쓴다.
     *
     * ⚠ [isManualForDisplay] 와 **결과가 다를 수 있다** — 재생 방식이 '알람' 이면
     * [isActiveBucketAlarm] 이 false 라 여기서는 직접입력으로 읽힌다. 그건 저장 관점에선
     * 맞고 **표시 관점에선 틀리다**(고른 문구는 그대로인데 재생 방식만 바뀐 것이므로).
     */
    fun isManualForSave(): Boolean = !voiceRandomPrompt && !isActiveBucketAlarm()

    /**
     * **표시 관점에서 직접 입력인가.** 요약 행·pane 프리셀렉트·직접입력 여부가 쓴다.
     * 재생 방식과 **무관**하다 — 그게 [isManualForSave] 와 갈라지는 유일한 축이다.
     */
    fun isManualForDisplay(): Boolean = !voiceRandomPrompt && !hasBucketMessageChoice()

    /**
     * **문구 종류를 무엇이든 골랐는가**(생성형이거나 테마). 저장 갈래를 가를 때 쓴다.
     *
     * ⚠ 여기서 [hasBucketMessageChoice]·[isActiveBucketAlarm] 을 쓰면 안 된다 — 둘 다
     * `audioCacheKey` 가 살아 있어야 true 라, **방금 고른 테마**를 못 본다.
     */
    fun hasMessageKindChoice(): Boolean = voiceRandomPrompt || hasChosenBucketKind()

    /** **직접 입력을 실제로 쳐 넣었는가.** 잔재 정리가 그 문구를 지우지 않도록 가른다. */
    fun hasTypedManualText(): Boolean =
        !voiceRandomPrompt && !hasChosenBucketKind() && voiceText.isNotBlank()

    fun hasBucketMessageChoice(): Boolean {
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
        // audioCacheKey 와 비교하는 분기가 있었는데 성립할 수 없었다 — 파일 이름은 항상 서버가
        // 준 cache_key 이고 비교 대상은 앱이 만든 해시라 절대 같아지지 않는다. '재사용되고
        // 있다'는 착시만 줬다. 다른 알람이 만든 오디오의 재사용은 AlarmAudioStore 의
        // linkTtsInput/resolveTtsInput 별칭이 맡는다.
        return !localAudioUri.isNullOrBlank() &&
            generatedTtsKey == buildTtsKey(
                profileId = profileId,
                text = text,
                category = activeVoiceCategory(),
                language = activeVoiceLanguage(),
                listenerTitle = listenerTitleForKey,
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
     * 회전용 N개 클립의 cacheKey 목록을 저장한다.
     *
     * 여기서 끄는 `voiceRandomPrompt` 는 **'지금 라이브로 생성하느냐'** 일 뿐, 사용자가 고른
     * **문구 종류(`voiceRandomContext`)를 무효로 만들지 않는다.** 버킷은 그 종류에서 유도된
     * 결과다(사랑→love …). 둘을 같은 것으로 읽어 종류를 지우면 다음 새 알람이 '기본 인사말'로
     * 되돌아가고 이 알람을 다시 열면 '직접 입력'으로 보인다 — [toDraft] 위 주석 참고.
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
        voiceText = text
        voiceLanguage = language
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        rawAudioUri = audio.rawAudioUri
        ttsMessageId = messageId.takeIf { it.isNotBlank() }
        selectedBucket = bucket
        // ⚠ **문구 종류를 버킷과 맞춰 둔다**(2026-08-31). 컨텍스트가 밀린 채(목소리 재선택 등)
        // 여기로 오면 버킷은 '날씨' 인데 종류는 'preset' 으로 남아, 저장된 행을 다시 열 때
        // **기본 인사말**로 보인다(CLAUDE.md 「일곱 자리」가 막으려는 바로 그 어긋남).
        // 되짚기는 `clonePrerenderBucketCategoryFor` 의 역함수 하나뿐이다 — 한쪽만 고치지 말 것.
        randomPromptContextForBucket(bucket)?.let { voiceRandomContext = it }
        bucketClipKeysJson = com.alarmtalk.app.data.encodeBucketClipKeys(clipKeys)
        bucketClipTextsJson = com.alarmtalk.app.data.encodeBucketClipKeys(clipTexts)
        bucketResolvedForProfileId = profileId
        this.contextVariantIndex = contextVariantIndex
        generatedTtsKey = buildTtsKey(profileId, text, activeVoiceCategory(), activeVoiceLanguage())
    }

    /**
     * ⚠ **이건 번역 스위치가 아니다 — 지우지 말 것.**
     *
     * 번역은 2026-08-12 지시("직접 입력한 거 그대로 나오도록")로 없앴다. 예전에는 앱 언어가
     * 한국어가 아니면 직접 입력 문구를 서버가 그 언어로 **옮겨서** 읽었고, 그래서 사용자가
     * 친 글자와 실제로 들리는 말이 달라졌다. 이제 TTS 요청의 `translate` 는 언제나 false 다.
     *
     * 반면 이 함수가 정하는 건 **어느 언어의 스톡 클립을 고를지**와 캐시 키다. 축이 다르다 —
     * 번역을 없앴다고 이걸 같이 지우면 en·ja 기기에서 한국어 클립이 재생된다.
     */
    fun activeVoiceLanguage(): String = supportedAppVoiceLanguage(voiceLanguage)

    fun activeVoiceCategory(): String =
        if (voiceRandomPrompt) ttsCategoryForRandomContext(voiceRandomContext) else "custom"

    companion object {
        fun from(
            alarm: AlarmEntity?,
            defaultPlayMode: String = AlarmPlayModes.ALARM_ONLY,
            // 새 알람의 기본 문구 종류. 호출측이 '마지막에 고른 문구'를 넘기고, 없으면
            // '기본 인사말'(preset)로 폴백한다. 기존 알람은 자신의 voiceRandomContext 를 쓴다.
            defaultRandomContext: String = DefaultRandomPromptContext,
            /**
             * 마지막에 쓴 직접 입력 문구. **차 있으면 마지막 선택이 직접 입력이었다는 뜻**이라
             * 새 알람을 그 문구가 담긴 직접 입력으로 연다(생성형을 저장하면 저장소에서 지워지므로
             * 둘이 동시에 차 있지 않다 — DynamicPromptPreferenceStore.saveLastMessageContext).
             *
             * 문구를 같이 얹는 이유는 빈 직접입력으로 열면 저장이 막히기 때문이다. 글자가 같으면
             * 오디오 캐시에 걸려 재생성도 한도 차감도 없다. 기존 알람에는 쓰지 않는다.
             */
            defaultManualText: String? = null,
        ): AlarmEditorState {
            val seedManualText = defaultManualText?.takeIf { alarm == null && it.isNotBlank() }
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
                voiceText = alarm?.voiceText ?: seedManualText,
                voiceCategory = alarm?.voiceCategory ?: "morning",
                voiceLanguage = alarm?.voiceLanguage ?: "ko",
                // 새 알람은 랜덤(기본 문구) ON — 목소리만 고르면 추가 입력 없이 저장 가능.
                // 단 마지막 선택이 직접 입력이었으면 그 문구로 연다(seedManualText).
                voiceRandomPrompt = alarm?.voiceRandomPrompt ?: alarm?.let {
                    it.voiceSource == VoiceSources.TTS_PROFILE && it.voiceText.isNullOrBlank()
                } ?: (seedManualText == null),
                // 마지막 문구 기억은 '신규 알람'에만 적용. 기존 알람(수동/알람전용 등 context=null 포함)은
                // 자기 값(없으면 기본 preset)을 그대로 써, 편집만 열어도 문구가 바뀌는 일이 없게 한다.
                voiceRandomContext = if (alarm == null) {
                    defaultRandomContext
                } else {
                    // 종류를 떨어뜨리던 시절에 저장된 버킷 알람은 이 값이 null 이라, 그대로
                    // 열면 고른 적 없는 '기본 인사말'로 보인다. 버킷은 종류에서 유도된 값이라
                    // 되짚을 수 있다(randomPromptContextForBucket).
                    alarm.voiceRandomContext
                        ?: randomPromptContextForBucket(alarm.bucketId)
                        ?: DefaultRandomPromptContext
                },
                voiceWeatherCountry = alarm?.voiceWeatherCountry,
                voiceWeatherCity = alarm?.voiceWeatherCity,
                voiceFortuneGender = alarm?.voiceFortuneGender,
                voiceFortuneBirthDate = alarm?.voiceFortuneBirthDate,
                voiceFortuneBirthTime = alarm?.voiceFortuneBirthTime,
                voiceRepeat = true,
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

internal fun normalizedTtsCategory(category: String): String =
    if (TtsCategories.any { (key, _) -> key == category }) category else DefaultRandomTtsCategory

internal fun normalizedRandomPromptContext(context: String): String =
    when (context) {
        "daily", "weather" -> "wake_weather"
        "fortune" -> "wake_fortune"
        // ⚠ **옛 이름을 지우지 말 것.** 2026-09-02 에 '사랑'(`love`)을 '응원'(`cheer`)으로
        //   바꿨는데, 이미 저장된 알람 행과 스토어에 올라간 구버전 앱이 여전히 `love` 를
        //   들고 있다. 이 줄이 없으면 아래 `else` 가 모르는 값으로 보고 **`preset` 으로
        //   접는다** — 사용자는 응원을 골랐는데 기본 인사말이 울린다.
        "love" -> "cheer"
        else -> if (RandomPromptContexts.any { (key, _) -> key == context }) context else DefaultRandomPromptContext
    }

internal fun ttsCategoryForRandomContext(context: String?): String =
    when (normalizedRandomPromptContext(context ?: DefaultRandomPromptContext)) {
        "cheer" -> "cheer"
        "medication" -> "medication"
        // 기본값(preset)·날씨·운세는 모두 'morning' 으로 보낸다. 서버가 preset 경로에서
        // greeting 문구로 이어 붙이고(stockPresetCategory), 날씨·운세는 동적 생성이라
        // 카테고리는 저장 라벨로만 쓰인다.
        else -> "morning"
    }

internal fun randomContextUsesWeather(context: String?): Boolean =
    when (normalizedRandomPromptContext(context ?: DefaultRandomPromptContext)) {
        "wake_weather" -> true
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
        "cheer" -> "cheer"
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

/**
 * [clonePrerenderBucketCategoryFor] 의 역 — 버킷 category 로 문구 종류를 되짚는다.
 *
 * 쓰는 곳은 두 군데다. 둘 다 "종류는 없는데 버킷은 있다" 는 같은 상황을 다룬다:
 *  - 옛 알람 행을 열 때(AlarmEditorState.from) — 종류를 떨어뜨리던 시절 저장분.
 *  - 저장 성공 시 마지막 선택 기록(MainViewModel.rememberMessageChoiceUsed) — 거기서
 *    조용히 넘어가면 다음 새 알람이 '기본 인사말'로 되돌아간다.
 *
 * 위 매핑과 짝이므로 한쪽만 고치지 말 것.
 */
internal fun randomPromptContextForBucket(bucket: String?): String? =
    when (bucket?.trim()) {
        "greeting" -> "preset"
        "cheer" -> "cheer"
        // 옛 버킷 이름 — 이미 저장된 알람 행이 들고 있다(위 normalize 와 같은 이유).
        "love" -> "cheer"
        "medication" -> "medication"
        "fortune" -> "wake_fortune"
        "weather" -> "wake_weather"
        else -> null
    }

private const val DefaultRandomTtsCategory = "morning"
// 기본은 추가 입력이 필요 없는 고정 문구(preset) — 목소리만 고르면 바로 저장할 수 있다.
internal const val DefaultRandomPromptContext = "preset"
/**
 * 목소리 음량 하한. **0 을 허용하지 않는다** — 0 은 '무음' 이라는 별개의 뜻인데 슬라이더
 * 끝값으로 두면 실수로 닿아 목소리 알람이 조용히 안 들리게 된다. 끄는 것은 재생 방식을
 * '알람' 으로 바꾸는 것으로 표현한다. iOS `AlarmEditDraft.minVoiceVolumePercent` 와 같은 값.
 */
internal const val MinVoiceVolumePercent = 10

/**
 * 알람 음량 하한. 목소리와 같은 이유로 **0 을 슬라이더로 만들 수 없다** —
 * 무음은 알람음 스위치(`alarmSoundEnabled`)로만 표현한다.
 */
internal const val MinAlarmVolumePercent = 10
