package com.alarmtalk.app.network

import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * 등록 초안을 만드는 `POST voice/clone` 의 **실제 멀티파트 본문**을 고정한다.
 *
 * Retrofit 인터페이스에 파트를 더해도 호출부가 값을 안 넘기면(또는 다른 이름으로 넘기면) 컴파일은
 * 통과한다 — 그래서 조립 함수(`createVoiceCloneDraft`)를 실제 Retrofit 에 태워 나가는 파트
 * 이름과 값을 본다. 서버 계약: `routes/voice-profile.ts` 의 `POST /clone` 폼 필드.
 */
class VoiceCloneRequestTest {

    /**
     * 목소리의 결(`voiceEnergy`/`voice_energy`)은 **어떤 이름으로도** 보내지 않는다(2026-09-29
     * '목소리 느낌' 선택 제거). 서버는 필드가 없으면 전사로 추정한 말투를 쓴다 — 빈 값(`""`)을
     * 보내도 결과는 같지만, 앱이 고르지 않는 값을 싣지 않는다.
     */
    @Test
    fun 목소리의_결은_보내지_않는다() {
        val parts = sendClone(
            draft(relationshipLabel = "남자친구", listenerTitle = "자기", language = "ja"),
        )

        assertFalse("voiceEnergy 파트가 나갔다: ${parts.keys}", "voiceEnergy" in parts)
        assertFalse("voice_energy 파트가 나갔다: ${parts.keys}", "voice_energy" in parts)
    }

    @Test
    fun 채운_필드는_그대로_보낸다() {
        val parts = sendClone(
            draft(
                relationshipLabel = "남자친구",
                listenerTitle = "자기",
                language = "ja",
            ),
        )

        assertEquals("엄마 목소리", parts["name"])
        assertEquals("false", parts["isShared"])
        assertEquals("남자친구", parts["relationshipLabel"])
        assertEquals("자기", parts["listenerTitle"])
        assertEquals("15000", parts["durationMs"])
        assertEquals("true", parts["isDraft"])
        assertEquals("ja", parts["language"])
        assertTrue("audio 파트가 없다: ${parts.keys}", "audio" in parts)
    }

    @Test
    fun 비어_있는_관계_호칭은_파트를_보내지_않고_언어는_앱_로케일로_채운다() {
        val parts = sendClone(draft(language = null))

        assertFalse("relationshipLabel" in parts)
        assertFalse("listenerTitle" in parts)
        assertEquals("en", parts["language"])
    }

    // ── 도우미 ────────────────────────────────────────────────────────────

    private fun audio() = CachedAlarmAudio(
        localAudioUri = "file:///tmp/voice.m4a",
        rawAudioUri = null,
        displayName = "voice.m4a",
        durationMillis = 15_000L,
        cacheKey = null,
    )

    private fun draft(
        relationshipLabel: String = "",
        listenerTitle: String = "",
        language: String? = "ko",
    ) = VoiceProfileCreationDraft(
        name = "엄마 목소리",
        audio = audio(),
        shared = false,
        relationshipLabel = relationshipLabel,
        listenerTitle = listenerTitle,
        language = language,
    )

    /** 조립 함수를 실제 Retrofit 에 태우고, 나간 멀티파트를 `파트 이름 → 본문` 으로 돌려준다. */
    private fun sendClone(draft: VoiceProfileCreationDraft): Map<String, String> = runBlocking {
        val captured = mutableMapOf<String, String>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            assertEquals("POST", request.method)
            assertTrue(request.url.encodedPath.endsWith("/voice/clone"))
            val body = request.body as MultipartBody
            body.parts.forEach { part ->
                val disposition = part.headers?.get("Content-Disposition").orEmpty()
                val name = Regex("""name="([^"]*)"""").find(disposition)?.groupValues?.get(1)
                    ?: error("이름 없는 파트: $disposition")
                captured[name] = Buffer().also { part.body.writeTo(it) }.readUtf8()
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(201).message("Created")
                .body("""{"profile":{"id":"draft-1","name":"엄마 목소리","is_draft":true}}""".toResponseBody("application/json".toMediaType()))
                .build()
        }.build()
        try {
            val api = Retrofit.Builder().baseUrl("https://voice-clone.example.test/api/")
                .client(client).addConverterFactory(GsonConverterFactory.create()).build()
                .create(VoiceProfileApi::class.java)
            val profile = api.createVoiceCloneDraft(
                authorization = "Bearer test-token",
                draft = draft,
                audio = MultipartBody.Part.createFormData(
                    name = "audio",
                    filename = "voice.m4a",
                    body = byteArrayOf(1, 2, 3).toRequestBody("audio/mp4".toMediaType()),
                ),
                fallbackLanguage = "en",
            )
            assertEquals("draft-1", profile.id)
            captured
        } finally {
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
        }
    }
}
