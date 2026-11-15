package com.alarmtalk.app.network

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * `GET /user/consents/status` 의 목소리 권리 확인 칸(`voice_rights_attested`, 2026-11-15). 칸이 없는 옛 서버는
 * null(모른다)이어야 한다 — false 로 읽으면 등록 시트가 그 서버가 모르는 `voice_rights` 를 보내 400 으로 막힌다.
 * iOS `AuthUserDecodingTests.test_consentStatusDecodesVoiceRightsAttested` 와 짝이다.
 */
class ConsentStatusResponseTest {
    private fun parse(json: String) = Gson().fromJson(json, ConsentStatusResponse::class.java)

    @Test
    fun voiceRightsAttestedIsReadFromTheServer() {
        assertEquals(true, parse("""{"sensitive_missing":[],"voice_rights_attested":true}""").voiceRightsAttested)
        assertEquals(false, parse("""{"sensitive_missing":[],"voice_rights_attested":false}""").voiceRightsAttested)
    }

    @Test
    fun anOlderServerWithoutTheFieldMeansUnknown() {
        val status = parse("""{"needs_consent":false,"sensitive_missing":["voice_biometric"]}""")
        assertNull(status.voiceRightsAttested)
        assertEquals(listOf("voice_biometric"), status.sensitiveMissing)
    }
}
