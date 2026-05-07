package com.voicealarm.nativeapp.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.DELETE
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

data class LeaveFamilyGroupResponse(
    val success: Boolean,
    @SerializedName("left_group_id") val leftGroupId: String,
)

data class RemoveFamilyMemberResponse(
    val success: Boolean,
    @SerializedName("removed_user_id") val removedUserId: String? = null,
)

interface FamilyApi {
    @GET("family/groups/current")
    suspend fun getFamilyGroup(@Header("Authorization") authorization: String): FamilyGroupCurrentResponse

    @POST("family/groups/{groupId}/leave")
    suspend fun leaveFamilyGroup(
        @Header("Authorization") authorization: String,
        @Path("groupId") groupId: String,
        @Body request: Map<String, String> = emptyMap(),
    ): LeaveFamilyGroupResponse

    @DELETE("family/groups/{groupId}/members/{userId}")
    suspend fun removeFamilyMember(
        @Header("Authorization") authorization: String,
        @Path("groupId") groupId: String,
        @Path("userId") userId: String,
    ): RemoveFamilyMemberResponse

    @POST("family/alarms/voice")
    suspend fun createFamilyVoiceAlarm(
        @Header("Authorization") authorization: String,
        @Body request: FamilyVoiceAlarmRequest,
    ): FamilyVoiceAlarmResponse
}
