package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.usesFreeSystemVoiceAlarm
import com.alarmtalk.app.network.TtsGenerateRequest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TtsGenerateGateTest {
    @Test
    fun freeSystemPresetRequestIsAllowedWithoutPaidVoiceAccess() {
        val request = TtsGenerateRequest(
            voiceProfileId = "70000000-0000-4000-9000-000000000001",
            category = "preset",
            language = "ko",
            random = true,
            randomContext = "preset",
        )

        assertTrue(request.isFreeSystemPresetRequest())
    }

    @Test
    fun freeGateRejectsCustomTextEvenWithSystemVoice() {
        val request = TtsGenerateRequest(
            voiceProfileId = "70000000-0000-4000-9000-000000000001",
            text = "Wake up",
            category = "custom",
            language = "en",
            random = true,
            randomContext = "preset",
        )

        assertFalse(request.isFreeSystemPresetRequest())
    }

    // 무료도 기본 목소리 직접 입력을 보낸다(voice-and-message §8) — 등록 목소리·번역·생성형은 아니다.
    @Test
    fun freeManualGateAllowsSystemVoiceTypedTextOnly() {
        val manual = TtsGenerateRequest(
            voiceProfileId = "70000000-0000-4000-9000-000000000102",
            text = "10월 26일 확인한 정책브리핑 정책뉴스입니다.",
            category = "custom",
            language = "ko",
        )
        assertTrue(manual.isFreeSystemManualRequest())
        assertFalse(manual.copy(voiceProfileId = "user-voice-id").isFreeSystemManualRequest())
        assertFalse(manual.copy(translate = true).isFreeSystemManualRequest())
        assertFalse(manual.copy(random = true, randomContext = "weather").isFreeSystemManualRequest())
        assertFalse(manual.copy(text = "  ").isFreeSystemManualRequest())
    }

    @Test
    fun freeGateRejectsNonSystemVoicePresetRequest() {
        val request = TtsGenerateRequest(
            voiceProfileId = "user-voice-id",
            category = "preset",
            language = "ko",
            random = true,
            randomContext = "preset",
        )

        assertFalse(request.isFreeSystemPresetRequest())
    }

    @Test
    fun freeGateRejectsTranslatedPresetLanguage() {
        val request = TtsGenerateRequest(
            voiceProfileId = "70000000-0000-4000-9000-000000000001",
            category = "preset",
            language = "en",
            random = true,
            randomContext = "preset",
        )

        assertFalse(request.isFreeSystemPresetRequest())
    }

    @Test
    fun freeAlarmGateAllowsCachedSystemPresetTts() {
        val draft = alarmDraft(
            localAudioUri = "file:///cache/preset.mp3",
            rawAudioUri = "r2://tts/preset",
            audioCacheKey = "tts-cache",
            voiceRandomPrompt = true,
            voiceRandomContext = "preset",
            voiceText = "Buddy, wake now",
        )

        assertTrue(draft.usesFreeSystemVoiceAlarm())
    }

    @Test
    fun freeAlarmGateAllowsSystemStockClipAudio() {
        val draft = alarmDraft(
            localAudioUri = "file:///cache/stock.mp3",
            audioCacheKey = "stock_10000000-0000-4000-8000-000000000001",
            voiceRandomPrompt = false,
            voiceRandomContext = null,
            voiceText = "좋은 아침이에요.",
        )

        assertTrue(draft.usesFreeSystemVoiceAlarm())
    }

    // ⚠ **2026-10-26 뒤집음** — 무료도 기본 목소리 직접 입력을 월 3회 만들고, 만든 결과는 무료로 울린다
    //   (`docs/spec/voice-and-message.md` §8). 이 테스트는 예전에 반대("기본 목소리 직접 입력은 유료")를 지켰다.
    @Test
    fun freeAlarmGateAllowsCachedSystemCustomTts() {
        val draft = alarmDraft(
            localAudioUri = "file:///cache/custom.mp3",
            rawAudioUri = "r2://tts/custom",
            audioCacheKey = "tts-cache",
            voiceRandomPrompt = false,
            voiceRandomContext = null,
            voiceText = "Wake up with a custom line.",
        )

        assertTrue(draft.usesFreeSystemVoiceAlarm())
        // 등록(클론) 목소리는 그대로 유료다.
        assertFalse(draft.copy(voiceProfileId = "00000000-0000-4000-8000-00000000c10e").usesFreeSystemVoiceAlarm())
    }

    private fun alarmDraft(
        localAudioUri: String?,
        audioCacheKey: String?,
        rawAudioUri: String? = null,
        voiceRandomPrompt: Boolean,
        voiceRandomContext: String?,
        voiceText: String?,
    ) = AlarmDraft(
        label = "",
        hour = 7,
        minute = 30,
        repeatDaysMask = 0,
        snoozeMinutes = 5,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.VOICE_ONLY,
        localAudioUri = localAudioUri,
        audioCacheKey = audioCacheKey,
        rawAudioUri = rawAudioUri,
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = "70000000-0000-4000-9000-000000000001",
        voiceText = voiceText,
        voiceCategory = "morning",
        voiceLanguage = "ko",
        voiceRandomPrompt = voiceRandomPrompt,
        voiceRandomContext = voiceRandomContext,
    )
}
