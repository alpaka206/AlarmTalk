package com.alarmtalk.app.data

import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.VoiceProfile

/**
 * 백엔드 migration 43(system-stock-voices)에서 시드되는 시스템 스톡 보이스의
 * 고정 UUID prefix. 서버 응답이 전체 목록의 권위이며, 클라이언트는 첫 응답 전 카탈로그와
 * 오프라인 판정(무료 다운그레이드 시 로컬 알람 보존 등)에 이 값을 쓴다.
 */
const val SYSTEM_VOICE_ID_PREFIX = "70000000-0000-4000-9000-"

/**
 * 첫 서버 응답 전에도 즉시 그릴 수 있는 기본 목소리 카탈로그.
 *
 * 개인·공유 목소리는 절대 넣지 않는다. 서버 `GET /voice` 성공 응답이 오면 이 목록은
 * 전체 응답으로 교체된다. 백엔드 system-stock-voices 시드를 바꾸면 이 목록도 함께 맞춘다.
 */
fun bundledSystemVoiceProfiles(): List<VoiceProfile> = listOf(
    VoiceProfile(id = SYSTEM_VOICE_ID_PREFIX + "000000000101", name = "아담", status = "ready", isSystem = true),
    VoiceProfile(id = SYSTEM_VOICE_ID_PREFIX + "000000000102", name = "미나", status = "ready", isSystem = true),
    VoiceProfile(id = SYSTEM_VOICE_ID_PREFIX + "000000000103", name = "하준", status = "ready", isSystem = true),
    VoiceProfile(id = SYSTEM_VOICE_ID_PREFIX + "000000000104", name = "소은", status = "ready", isSystem = true),
)

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
    if (playMode == AlarmPlayModes.ALARM_ONLY) return false
    // **직접 녹음은 유료 기능이 아니다**(2026-08-12 확정). 내 폰에 있는 파일을 그대로
    // 재생하는 것이라 서버 자산을 하나도 쓰지 않는다 — 클론 목소리·서버 생성 클립과 다르다.
    //
    // ⚠ 예전에는 여기서 `voiceSource == LOCAL_AUDIO` 를 곧바로 false 로 떨어뜨렸고, 이
    // 함수를 보는 **세 게이트가 전부** 막혔다: 저장(`voiceAlarmAllowed`), 무료 강등
    // 잠금(`lockPaidAlarmTalks`), 울림 강등(`RingingService.downgradePaidVoice`).
    // 그래서 무료 사용자는 녹음을 다 해 놓고 저장 단계에서 거절당했다.
    //
    // `localAudioUri` 를 함께 보는 이유: `degradeMatchingLocalOwnedVoiceAlarms` 가 강등
    // 표식으로 `voiceSource=LOCAL_AUDIO + localAudioUri=null` 을 남기므로, 그 빈 껍데기를
    // '녹음' 으로 오인하면 안 된다.
    if (voiceSource == VoiceSources.LOCAL_AUDIO) return !localAudioUri.isNullOrBlank()
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

/**
 * 기본(시스템) 목소리 인사말 샘플은 앱에 내장한다(res/raw, 4보이스 × ko/en/ja) —
 * 온보딩·기본 목소리 선택 미리듣기가 스톡 매니페스트 로딩/네트워크에 의존해
 * '눌러도 아무 소리 안 남'이 되지 않도록 즉시·오프라인 재생한다. 내장본은 서버
 * 스톡 greeting(2026-07-19 확정 대사)과 동일 발화. 새 시스템 보이스가 추가되면
 * null 을 돌려 호출자가 기존 스톡 클립 다운로드 경로로 폴백한다.
 */
fun bundledSystemGreetingRes(voiceProfileId: String?, appLanguage: String): Int? {
    val voice = when (voiceProfileId) {
        SYSTEM_VOICE_ID_PREFIX + "000000000101" -> "adam"
        SYSTEM_VOICE_ID_PREFIX + "000000000102" -> "mina"
        SYSTEM_VOICE_ID_PREFIX + "000000000103" -> "hajun"
        SYSTEM_VOICE_ID_PREFIX + "000000000104" -> "soeun"
        else -> return null
    }
    val language = appVoiceLanguageOf(appLanguage)
    return when (voice) {
        "adam" -> when (language) {
            "en" -> com.alarmtalk.app.R.raw.voice_greeting_adam_en
            "ja" -> com.alarmtalk.app.R.raw.voice_greeting_adam_ja
            else -> com.alarmtalk.app.R.raw.voice_greeting_adam_ko
        }
        "mina" -> when (language) {
            "en" -> com.alarmtalk.app.R.raw.voice_greeting_mina_en
            "ja" -> com.alarmtalk.app.R.raw.voice_greeting_mina_ja
            else -> com.alarmtalk.app.R.raw.voice_greeting_mina_ko
        }
        "hajun" -> when (language) {
            "en" -> com.alarmtalk.app.R.raw.voice_greeting_hajun_en
            "ja" -> com.alarmtalk.app.R.raw.voice_greeting_hajun_ja
            else -> com.alarmtalk.app.R.raw.voice_greeting_hajun_ko
        }
        else -> when (language) {
            "en" -> com.alarmtalk.app.R.raw.voice_greeting_soeun_en
            "ja" -> com.alarmtalk.app.R.raw.voice_greeting_soeun_ja
            else -> com.alarmtalk.app.R.raw.voice_greeting_soeun_ko
        }
    }
}

/**
 * 미리듣기용 greeting 스톡 클립 선택의 단일 출처. greeting 은 보이스당 3개 언어(ko/en/ja)가
 * 있고 서버 /tts/stock-clips 는 language ASC 정렬이라, 언어 필터 없이 firstOrNull 을 쓰면
 * 항상 영어(en)가 잡힌다. 반드시 앱 언어(appVoiceLanguageOf)로 고르고,
 * 앱 언어 클립이 없으면 ko → 아무 greeting → 그 보이스의 아무 클립 순으로 폴백한다.
 */
fun greetingStockClipFor(
    clips: List<StockClip>,
    voiceProfileId: String,
    appLanguage: String,
): StockClip? {
    val greetings = clips.filter {
        it.voiceProfileId == voiceProfileId && it.category == STOCK_GREETING_CATEGORY
    }
    return greetings.firstOrNull { (it.language ?: "ko") == appLanguage }
        ?: greetings.firstOrNull { (it.language ?: "ko") == "ko" }
        ?: greetings.firstOrNull()
        ?: clips.firstOrNull { it.voiceProfileId == voiceProfileId }
}
