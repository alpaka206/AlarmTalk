package com.alarmtalk.app.network

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * 등록 확정 바디의 목소리 높이(스펙 voice-and-message §4-3) — 0 이면 키가 아예 나가지 않아 높이 이전과 같은 바디이고,
 * 고른 값은 `pitch_semitones` 로 나간다. Retrofit 의 `GsonConverterFactory.create()` 와 같은 기본 Gson 으로 본다
 * (`serializeNulls` 꺼짐). iOS `VoiceStudioViewModelTests.test_voiceDraftPromotionBody_carriesPitchOnlyWhenNotZero` 와 짝이다.
 */
class VoiceProfileUpdateRequestTest {
    private val gson = Gson()

    @Test
    fun promotionBodyOmitsPitchWhenNotChosen() {
        val body = JsonParser.parseString(
            gson.toJson(VoiceProfileUpdateRequest(isDraft = false, language = "ko")),
        ).asJsonObject
        assertFalse(body.has("pitch_semitones"))
        assertEquals(false, body.get("is_draft").asBoolean)
    }

    @Test
    fun promotionBodyCarriesChosenPitch() {
        val body = JsonParser.parseString(
            gson.toJson(
                VoiceProfileUpdateRequest(isDraft = false, replaceExisting = true, pitchSemitones = -1.5f),
            ),
        ).asJsonObject
        assertEquals(-1.5, body.get("pitch_semitones").asDouble, 0.0)
        assertEquals(true, body.get("replace_existing").asBoolean)
    }
}
