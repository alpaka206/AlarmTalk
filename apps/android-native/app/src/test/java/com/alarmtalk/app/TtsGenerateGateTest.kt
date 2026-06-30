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

    @Test
    fun freeAlarmGateRejectsCachedSystemCustomTts() {
        val draft = alarmDraft(
            localAudioUri = "file:///cache/custom.mp3",
            rawAudioUri = "r2://tts/custom",
            audioCacheKey = "tts-cache",
            voiceRandomPrompt = false,
            voiceRandomContext = null,
            voiceText = "Wake up with a custom paid line.",
        )

        assertFalse(draft.usesFreeSystemVoiceAlarm())
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
        playMode = AlarmPlayModes.ALARM_VOICE,
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
