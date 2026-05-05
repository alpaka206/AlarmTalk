package com.voicealarm.nativeapp.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

data class FamilyGroupCurrentResponse(
    val group: FamilyGroup?,
    val role: String?,
    val members: List<FamilyGroupMember>,
)

data class FamilyGroup(
    val id: String,
    @SerializedName("owner_user_id") val ownerUserId: String,
    @SerializedName("plan_id") val planId: String,
    @SerializedName("max_members") val maxMembers: Int,
    @SerializedName("created_at") val createdAt: String,
)

data class FamilyGroupMember(
    val id: String,
    @SerializedName("user_id") val userId: String,
    val role: String,
    @SerializedName("joined_at") val joinedAt: String,
    val email: String? = null,
    val name: String? = null,
    @SerializedName("allow_family_alarms") val allowFamilyAlarms: Boolean = false,
)

data class FamilyInviteListResponse(
    val invites: List<FamilyInvite>,
)

data class FamilyInviteResponse(
    val invite: FamilyInvite,
)

data class FamilyInvite(
    val id: String,
    @SerializedName("plan_group_id") val planGroupId: String,
    val code: String,
    val status: String,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("expires_at") val expiresAt: String? = null,
    @SerializedName("deep_link") val deepLink: String? = null,
    @SerializedName("web_url") val webUrl: String? = null,
)

data class FamilyVoiceAlarmRequest(
    @SerializedName("recipient_user_id") val recipientUserId: String,
    @SerializedName("wake_at") val wakeAt: String,
    @SerializedName("voice_upload_id") val voiceUploadId: String,
    val label: String? = null,
    @SerializedName("repeat_days") val repeatDays: List<Int> = emptyList(),
)

data class FamilyVoiceAlarmResponse(
    val alarm: FamilyVoiceAlarm,
)

data class FamilyVoiceAlarm(
    val id: String,
    @SerializedName("recipient_user_id") val recipientUserId: String? = null,
    @SerializedName("wake_at") val wakeAt: String? = null,
    val mode: String? = null,
)

interface FamilyApi {
    @GET("family/groups/current")
    suspend fun getFamilyGroup(@Header("Authorization") authorization: String): FamilyGroupCurrentResponse

    @POST("family/invites")
    suspend fun createFamilyInvite(
        @Header("Authorization") authorization: String,
        @Body request: Map<String, String> = emptyMap(),
    ): FamilyInviteResponse

    @GET("family/invites")
    suspend fun listFamilyInvites(@Header("Authorization") authorization: String): FamilyInviteListResponse

    @POST("family/invites/{code}/accept")
    suspend fun acceptFamilyInvite(
        @Header("Authorization") authorization: String,
        @Path("code") code: String,
        @Body request: Map<String, String> = emptyMap(),
    )

    @POST("family/invites/{code}/revoke")
    suspend fun revokeFamilyInvite(
        @Header("Authorization") authorization: String,
        @Path("code") code: String,
        @Body request: Map<String, String> = emptyMap(),
    )

    @POST("family/alarms/voice")
    suspend fun createFamilyVoiceAlarm(
        @Header("Authorization") authorization: String,
        @Body request: FamilyVoiceAlarmRequest,
    ): FamilyVoiceAlarmResponse
}
