package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

data class VoiceProfileListResponse(
    val profiles: List<VoiceProfile>,
)

data class VoiceProfileResponse(
    val profile: VoiceProfile,
)

data class VoiceProfileDraftResponse(
    val profile: VoiceProfile? = null,
)

// 이번 달(KST) 목소리 초안 생성 쿼터. 삭제 전 '이번 달 재생성 가능 여부' 판정에 쓴다.
data class VoiceDraftQuotaResponse(
    val limit: Int = 0,
    val used: Int = 0,
    val remaining: Int = 0,
    // 이번 달 '정식 등록' 쿼터 — 목소리는 한 달에 1개. 위 limit(초안 재시도 여유 3회)와 다르다.
    @SerializedName("registration_limit") val registrationLimit: Int = 0,
    @SerializedName("registration_used") val registrationUsed: Int = 0,
    @SerializedName("registration_remaining") val registrationRemaining: Int = 0,
)

data class VoiceUploadResponse(
    val upload: VoiceUpload,
)

data class VoiceUpload(
    val id: String,
    val objectKey: String? = null,
    val mimeType: String? = null,
    val sizeBytes: Long? = null,
    val durationMs: Long? = null,
    val originalName: String? = null,
    val createdAt: String? = null,
)

data class VoiceProfileUpdateRequest(
    val name: String? = null,
    @SerializedName("is_shared") val isShared: Boolean? = null,
    @SerializedName("is_draft") val isDraft: Boolean? = null,
    @SerializedName("relationship_label") val relationshipLabel: String? = null,
    @SerializedName("listener_title") val listenerTitle: String? = null,
    // draft→official 승격 시 사전렌더할 앱 언어(서버는 promote 시점에만 사용, 미전송 시 'ko').
    val language: String? = null,
)

data class VoicePreviewPlayedRequest(
    @SerializedName("preview_playback_token") val previewPlaybackToken: String,
)

data class VoicePreviewPlayedResponse(
    val success: Boolean,
    val previewed: Boolean,
)

data class VoicePreviewTextUpdateRequest(
    @SerializedName("preview_text") val previewText: String,
)

data class VoicePreviewTextUpdateResponse(
    val success: Boolean,
    // 서버가 공백 정규화한 최종 문구 — 이후 미리듣기 합성 문구(캐시 키)와 동일.
    @SerializedName("preview_text") val previewText: String,
)

/** GET voice/{id}/prerender-status 응답 — 유료 클론 사전렌더(R2 21클립) 진행 상태. */
data class VoicePrerenderStatusResponse(
    // "pending" | "done" | "failed" | "none"
    val status: String? = null,
    val total: Int = 0,
    val generated: Int = 0,
    val attempts: Int = 0,
)

/** POST voice/{id}/prerender/advance 응답 — 소유자 주도 사전렌더 전진(호출당 최대 3클립). */
data class VoicePrerenderAdvanceResponse(
    val done: Boolean = false,
    val generated: Int = 0,
    val total: Int = 0,
)

data class VoicePrerenderRetryResponse(
    val success: Boolean = false,
)

data class VoiceSpeechStyleRetryResponse(
    val success: Boolean = false,
    // 성공 시 "done".
    val status: String? = null,
)

data class VoiceProfile(
    val id: String,
    // Gson 은 JSON 에 name 이 누락되거나 null 이어도 기본값을 통하지 않고 그대로 null 을 주입할 수 있어
    // 추후 NPE 를 막기 위해 기본값을 부여한다.
    val name: String = "",
    val status: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("is_shared") val isShared: Boolean? = null,
    @SerializedName("is_draft") val isDraft: Boolean? = null,
    // 시스템 제공(스톡) 보이스 — 무료 플랜도 사용 가능, 수정/삭제/공유 불가.
    @SerializedName("is_system") val isSystem: Boolean? = null,
    @SerializedName("relationship_label") val relationshipLabel: String? = null,
    @SerializedName("listener_title") val listenerTitle: String? = null,
    // 말투(스피치 스타일) 분석 상태: null | "pending" | "done" | "failed". 클론 보이스 전용.
    @SerializedName("speech_style_status") val speechStyleStatus: String? = null,
)

data class FamilyVoiceProfile(
    val id: String,
    val name: String,
    val status: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("user_id") val userId: String? = null,
    @SerializedName("owner_name") val ownerName: String? = null,
    @SerializedName("is_shared") val isShared: Boolean? = null,
    @SerializedName("relationship_label") val relationshipLabel: String? = null,
    @SerializedName("listener_title") val listenerTitle: String? = null,
    @SerializedName("needs_viewer_info") val needsViewerInfo: Boolean? = null,
)

data class FamilyVoiceProfileListResponse(
    val profiles: List<FamilyVoiceProfile>,
)

interface VoiceProfileApi {
    @GET("voice")
    suspend fun listVoiceProfiles(@Header("Authorization") authorization: String): VoiceProfileListResponse

    @GET("voice/draft")
    suspend fun getVoiceDraft(@Header("Authorization") authorization: String): VoiceProfileDraftResponse

    @Multipart
    @POST("voice/clone")
    suspend fun createVoiceClone(
        @Header("Authorization") authorization: String,
        @Part audio: MultipartBody.Part,
        @Part("name") name: RequestBody,
        @Part("isShared") isShared: RequestBody,
        // 관계·호칭은 선택 입력 — 비우면 파트 자체를 보내지 않는다(백엔드 옵셔널).
        @Part("relationshipLabel") relationshipLabel: RequestBody?,
        @Part("listenerTitle") listenerTitle: RequestBody?,
        @Part("durationMs") durationMs: RequestBody,
        @Part("isDraft") isDraft: RequestBody,
        // 사전렌더할 앱 언어(미전송 시 서버가 'ko' 폴백 → 비-ko 유저가 클론 버킷을 못 받음).
        @Part("language") language: RequestBody,
    ): VoiceProfileResponse

    @Multipart
    @POST("voice/upload")
    suspend fun uploadVoiceAudio(
        @Header("Authorization") authorization: String,
        @Part audio: MultipartBody.Part,
        @Part("durationMs") durationMs: RequestBody,
        @Part("originalName") originalName: RequestBody,
    ): VoiceUploadResponse

    @PATCH("voice/{id}")
    suspend fun updateVoiceProfile(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Body request: VoiceProfileUpdateRequest,
    ): VoiceProfileResponse

    @POST("voice/{id}/preview-played")
    suspend fun confirmVoicePreviewPlayed(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Body request: VoicePreviewPlayedRequest,
    ): VoicePreviewPlayedResponse

    // 등록 미리듣기 문구 직접 수정(초안 전용) — 서버가 previewed_at 을 리셋해 재청취를 강제한다.
    @PATCH("voice/{id}/preview-text")
    suspend fun updateVoicePreviewText(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Body request: VoicePreviewTextUpdateRequest,
    ): VoicePreviewTextUpdateResponse

    @DELETE("voice/{id}")
    suspend fun deleteVoiceProfile(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Query("force") force: Boolean? = null,
        // draft 정리 전용 삭제 — 서버는 아직 is_draft=1 인 경우에만 실제 삭제한다(등록된 보이스 보호).
        @Query("draftOnly") draftOnly: Boolean? = null,
    )

    @GET("voice/draft-quota")
    suspend fun getVoiceDraftQuota(
        @Header("Authorization") authorization: String,
    ): VoiceDraftQuotaResponse

    @GET("voice/family")
    suspend fun listFamilyVoiceProfiles(@Header("Authorization") authorization: String): FamilyVoiceProfileListResponse

    // 유료 클론 사전렌더(R2 21클립) 진행 상태 — 목소리 탭 준비 표시가 짧게 폴링한다.
    @GET("voice/{id}/prerender-status")
    suspend fun getVoicePrerenderStatus(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): VoicePrerenderStatusResponse

    @POST("voice/{id}/prerender-retry")
    suspend fun retryVoicePrerender(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): VoicePrerenderRetryResponse

    @POST("voice/{id}/prerender/advance")
    suspend fun advanceVoicePrerender(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): VoicePrerenderAdvanceResponse

    // 말투 분석 재시도 — 실패 502 { error_code: SPEECH_STYLE_ANALYSIS_FAILED }, 소스 없음 409.
    @POST("voice/{id}/speech-style/retry")
    suspend fun retryVoiceSpeechStyle(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): VoiceSpeechStyleRetryResponse
}
