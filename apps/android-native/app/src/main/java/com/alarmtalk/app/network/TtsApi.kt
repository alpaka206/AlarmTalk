package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

data class TtsGenerateRequest(
    @SerializedName("voice_profile_id") val voiceProfileId: String,
    val text: String = "",
    val category: String,
    val language: String,
    val translate: Boolean = false,
    val random: Boolean = false,
    @SerializedName("random_context") val randomContext: String? = null,
    @SerializedName("alarm_hour") val alarmHour: Int? = null,
    @SerializedName("alarm_minute") val alarmMinute: Int? = null,
    @SerializedName("weather_country") val weatherCountry: String? = null,
    @SerializedName("weather_city") val weatherCity: String? = null,
    @SerializedName("fortune_gender") val fortuneGender: String? = null,
    @SerializedName("fortune_birth_date") val fortuneBirthDate: String? = null,
    @SerializedName("fortune_birth_time") val fortuneBirthTime: String? = null,
    @SerializedName("listener_title") val listenerTitle: String? = null,
    @SerializedName("target_user_id") val targetUserId: String? = null,
    @SerializedName("draft_preview") val draftPreview: Boolean = false,
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
    @SerializedName("random_context") val randomContext: String? = null,
)

/** 직접 입력 문구 만들기 월 한도 사용 현황(선택기 '직접 입력 (남은/총)' 표시용). */
data class ManualQuotaResponse(
    @SerializedName("plan_key") val planKey: String? = null,
    val limit: Int = 0,
    val used: Int = 0,
    val remaining: Int = 0,
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

data class StockClipListResponse(
    val clips: List<StockClip> = emptyList(),
)

data class StockClip(
    @SerializedName("message_id") val messageId: String,
    @SerializedName("voice_profile_id") val voiceProfileId: String,
    @SerializedName("voice_name") val voiceName: String? = null,
    val category: String? = null,
    val language: String? = null,
    // 같은 (보이스·카테고리·언어) 안의 문구 순서. 버킷 회전은 이 순서대로 재생한다.
    val variant: Int = 0,
    val text: String = "",
    @SerializedName("audio_url") val audioUrl: String? = null,
)

data class PrerenderVariantResponse(
    val context: String? = null,
    @SerializedName("variant_index") val variantIndex: Int? = null,
)

interface TtsApi {
    @POST("tts/generate")
    suspend fun generateTts(
        @Header("Authorization") authorization: String,
        @Body request: TtsGenerateRequest,
    ): TtsGenerateResponse

    @GET("tts/messages")
    suspend fun listTtsMessages(@Header("Authorization") authorization: String): TtsMessageListResponse

    @GET("tts/stock-clips")
    suspend fun getStockClips(@Header("Authorization") authorization: String): StockClipListResponse

    // 사전렌더 버킷(날씨)의 '어느 variant 를 틀지' 인덱스만 서버가 resolve. 오디오는 이미 로컬 캐시.
    @GET("tts/prerender-variant")
    suspend fun getPrerenderVariant(
        @Header("Authorization") authorization: String,
        @Query("context") context: String,
        @Query("country") country: String?,
        @Query("city") city: String?,
        @Query("target_date") targetDate: String?,
        @Query("timezone") timezone: String?,
    ): PrerenderVariantResponse

    @GET("tts/manual-quota")
    suspend fun getManualQuota(@Header("Authorization") authorization: String): ManualQuotaResponse

    @GET("tts/messages/{id}/audio")
    suspend fun getTtsMessageAudio(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): TtsMessageAudioResponse
}
