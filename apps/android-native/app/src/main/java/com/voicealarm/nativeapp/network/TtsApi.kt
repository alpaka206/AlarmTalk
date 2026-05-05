package com.voicealarm.nativeapp.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

data class TtsGenerateRequest(
    @SerializedName("voice_profile_id") val voiceProfileId: String,
    val text: String,
    val category: String,
    val language: String,
)

data class TtsGenerateResponse(
    @SerializedName("message_id") val messageId: String,
    @SerializedName("audio_base64") val audioBase64: String,
    @SerializedName("audio_format") val audioFormat: String,
    @SerializedName("audio_url") val audioUrl: String? = null,
    @SerializedName("audio_object_key") val audioObjectKey: String? = null,
    val text: String,
    @SerializedName("voice_profile_id") val voiceProfileId: String,
    @SerializedName("cache_key") val cacheKey: String? = null,
    @SerializedName("cache_hit") val cacheHit: Boolean = false,
    val provider: String? = null,
)

data class TtsMessageListResponse(
    val messages: List<TtsMessage>,
    val total: Int? = null,
    val limit: Int? = null,
    val offset: Int? = null,
)

data class TtsMessage(
    val id: String,
    val text: String = "",
    val category: String? = null,
    @SerializedName("audio_url") val audioUrl: String? = null,
    @SerializedName("voice_profile_id") val voiceProfileId: String? = null,
    @SerializedName("voice_name") val voiceName: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
)

data class TtsMessageAudioResponse(
    @SerializedName("message_id") val messageId: String,
    @SerializedName("audio_base64") val audioBase64: String,
    @SerializedName("audio_format") val audioFormat: String,
    @SerializedName("audio_url") val audioUrl: String? = null,
    val text: String = "",
    val category: String? = null,
    @SerializedName("voice_profile_id") val voiceProfileId: String? = null,
)

interface TtsApi {
    @POST("tts/generate")
    suspend fun generateTts(
        @Header("Authorization") authorization: String,
        @Body request: TtsGenerateRequest,
    ): TtsGenerateResponse

    @GET("tts/messages")
    suspend fun listTtsMessages(@Header("Authorization") authorization: String): TtsMessageListResponse

    @GET("tts/messages/{id}/audio")
    suspend fun getTtsMessageAudio(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): TtsMessageAudioResponse
}
