package com.voicealarm.nativeapp.network

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

data class VoiceSpeakerListResponse(
    val speakers: List<VoiceSpeakerSegment>,
    val provider: String? = null,
)

data class VoiceSpeakerSegment(
    val id: String,
    @SerializedName(value = "uploadId", alternate = ["upload_id"]) val uploadId: String? = null,
    val label: String,
    @SerializedName(value = "startMs", alternate = ["start_ms"]) val startMs: Long,
    @SerializedName(value = "endMs", alternate = ["end_ms"]) val endMs: Long,
    val confidence: Double? = null,
)

data class VoiceProfileUpdateRequest(
    val name: String? = null,
    @SerializedName("is_shared") val isShared: Boolean? = null,
    @SerializedName("is_draft") val isDraft: Boolean? = null,
    @SerializedName("relationship_label") val relationshipLabel: String? = null,
    @SerializedName("listener_title") val listenerTitle: String? = null,
)

data class VoiceProfileRelationshipUpdateRequest(
    @SerializedName("relationship_label") val relationshipLabel: String,
    @SerializedName("listener_title") val listenerTitle: String,
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
    @SerializedName("relationship_label") val relationshipLabel: String? = null,
    @SerializedName("listener_title") val listenerTitle: String? = null,
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

    @Multipart
    @POST("voice/clone")
    suspend fun createVoiceClone(
        @Header("Authorization") authorization: String,
        @Part audio: MultipartBody.Part,
        @Part("name") name: RequestBody,
        @Part("isShared") isShared: RequestBody,
        @Part("relationshipLabel") relationshipLabel: RequestBody,
        @Part("listenerTitle") listenerTitle: RequestBody,
        @Part("durationMs") durationMs: RequestBody,
        @Part("isDraft") isDraft: RequestBody,
    ): VoiceProfileResponse

    @Multipart
    @POST("voice/upload")
    suspend fun uploadVoiceAudio(
        @Header("Authorization") authorization: String,
        @Part audio: MultipartBody.Part,
        @Part("durationMs") durationMs: RequestBody,
        @Part("originalName") originalName: RequestBody,
    ): VoiceUploadResponse

    @POST("voice/uploads/{uploadId}/separate")
    suspend fun separateVoiceUpload(
        @Header("Authorization") authorization: String,
        @Path("uploadId") uploadId: String,
    ): VoiceSpeakerListResponse

    @PATCH("voice/{id}")
    suspend fun updateVoiceProfile(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Body request: VoiceProfileUpdateRequest,
    ): VoiceProfileResponse

    @PATCH("voice/{id}/relationship")
    suspend fun updateVoiceProfileRelationship(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Body request: VoiceProfileRelationshipUpdateRequest,
    ): VoiceProfileResponse

    @DELETE("voice/{id}")
    suspend fun deleteVoiceProfile(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Query("force") force: Boolean? = null,
    )

    @GET("voice/family")
    suspend fun listFamilyVoiceProfiles(@Header("Authorization") authorization: String): FamilyVoiceProfileListResponse
}
