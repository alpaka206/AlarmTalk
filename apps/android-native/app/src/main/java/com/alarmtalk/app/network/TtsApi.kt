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
    @SerializedName("preview_playback_token") val previewPlaybackToken: String? = null,
    @SerializedName("preview_playback_confirmed") val previewPlaybackConfirmed: Boolean = false,
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
    /** 카테고리별 **완전한 세트의 클립 수**. 옛 서버면 null. */
    @SerializedName("expected_variants") val expectedVariants: ExpectedVariantCounts? = null,
)

/**
 * ⚠ **기본 목소리와 등록(클론) 목소리는 개수가 다르다**(지금도 `medication` 이 2 vs 3).
 * 하나로 합치면 한쪽이 반드시 깨진다 — 기본 목소리의 완전한 세트가 '불완전' 으로 읽혀
 * 오프라인 재생이 안 켜지거나, 클론이 부분 세트인데 완전하다고 읽혀 없는 자리를 튼다.
 *
 * 앱에 개수를 박지 않으려고 서버가 내려준다. 운영이 시드를 늘리면 앱 업데이트 없이 따라온다.
 */
data class ExpectedVariantCounts(
    val system: Map<String, Int> = emptyMap(),
    val clone: Map<String, Int> = emptyMap(),
) {
    /** 이 목소리 종류에서 해당 카테고리가 완전하려면 몇 개여야 하는가. 모르면 null. */
    fun countFor(category: String, isSystemVoice: Boolean): Int? =
        (if (isSystemVoice) system else clone)[category]
}

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
    /**
     * **서버가 이 클립을 '지금 목소리' 로 이미 구웠는가.**
     *
     * ⚠ 제자리 목소리 교체는 세대 표식(custom_audio_invalidated_at)을 **먼저 커밋하고**
     * 프리셋 재렌더는 큐에만 넣는다 — 굽는 것은 cron 이 나중에 한다. 그 사이 매니페스트의
     * [audioUrl] 은 **옛 클립 그대로**라, 앱이 "낡은 키가 없다 = 다 끝났다" 로 읽으면 교체
     * 세대를 확정해 버리고 재렌더가 끝난 뒤에도 다시 받지 않는다(Codex #703 P1).
     * false 인 클립이 하나라도 있으면 **아직 끝난 것이 아니다.**
     *
     * ⚠ **nullable 이어야 한다**(Codex #703 P2). Retrofit 의 Gson 은 이 클래스를 리플렉션으로
     * 만들어 **코틀린 기본 인자를 적용하지 않는다** — 필드가 없으면 원시 Boolean 은 `false`
     * 로 채워진다. 그러면 옛 서버에서 **모든 클립이 '아직 안 구워짐'** 이 되어 워커가 계속
     * `Result.retry()` 만 하고 교체 표식을 영영 확정하지 못한다. 없으면 [isRendered] 가
     * true 로 읽는다. iOS 짝은 `StockClip.renderedForCurrentVoice`(같은 이유로 옵셔널).
     */
    @SerializedName("rendered_for_current_voice") val renderedForCurrentVoice: Boolean? = null,
) {
    /** 옛 서버(필드 없음)는 '준비됨' 으로 본다 — 없는 신호로 앱을 멈추지 않는다. */
    val isRendered: Boolean get() = renderedForCurrentVoice ?: true
}

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
