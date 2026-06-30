package com.alarmtalk.app.data

/**
 * 백엔드 migration 43(system-stock-voices)에서 시드되는 시스템 스톡 보이스의
 * 고정 UUID prefix. 서버가 단일 진실 공급원이며, 클라이언트는 오프라인 판정
 * (무료 다운그레이드 시 로컬 알람 보존 등)에만 이 prefix 를 쓴다.
 */
const val SYSTEM_VOICE_ID_PREFIX = "70000000-0000-4000-9000-"

/** 시스템 제공(스톡) 보이스 id 인지 — 무료 플랜에서도 사용할 수 있다. */
fun isSystemVoiceId(id: String?): Boolean = id?.startsWith(SYSTEM_VOICE_ID_PREFIX) == true

fun AlarmDraft.usesFreeSystemVoiceAlarm(): Boolean =
    usesFreeSystemVoiceAlarm(
        playMode = playMode,
        voiceSource = voiceSource,
        voiceProfileId = voiceProfileId,
        voiceRandomPrompt = voiceRandomPrompt,
        voiceRandomContext = voiceRandomContext,
        voiceLanguage = voiceLanguage,
        localAudioUri = localAudioUri,
        rawAudioUri = rawAudioUri,
        audioCacheKey = audioCacheKey,
    )

fun AlarmEntity.usesFreeSystemVoiceAlarm(): Boolean =
    usesFreeSystemVoiceAlarm(
        playMode = playMode,
        voiceSource = voiceSource,
        voiceProfileId = voiceProfileId,
        voiceRandomPrompt = voiceRandomPrompt,
        voiceRandomContext = voiceRandomContext,
        voiceLanguage = voiceLanguage,
        localAudioUri = localAudioUri,
        rawAudioUri = rawAudioUri,
        audioCacheKey = audioCacheKey,
    )

private fun usesFreeSystemVoiceAlarm(
    playMode: String,
    voiceSource: String,
    voiceProfileId: String?,
    voiceRandomPrompt: Boolean,
    voiceRandomContext: String?,
    voiceLanguage: String?,
    localAudioUri: String?,
    rawAudioUri: String?,
    audioCacheKey: String?,
): Boolean {
    if (playMode == AlarmPlayModes.ALARM_ONLY || voiceSource == VoiceSources.LOCAL_AUDIO) return false
    if (!isSystemVoiceId(voiceProfileId)) return false

    val noCachedAudio = localAudioUri.isNullOrBlank() && rawAudioUri.isNullOrBlank()
    val stockClipAudio = audioCacheKey?.startsWith("stock_") == true
    val presetGeneratedAudio = voiceRandomPrompt &&
        voiceRandomContext?.trim() == "preset" &&
        (voiceLanguage.isNullOrBlank() || voiceLanguage.trim() == "ko")
    return noCachedAudio || stockClipAudio || presetGeneratedAudio
}

/**
 * 스톡 클립 카테고리. greeting 은 목소리 창에서 "이 목소리 들어보기" 샘플 전용이라
 * 알람 에디터의 기본 제공 음성 목록에서는 제외한다.
 */
const val STOCK_GREETING_CATEGORY = "greeting"
