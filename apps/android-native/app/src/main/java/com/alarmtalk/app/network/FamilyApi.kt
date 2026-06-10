package com.alarmtalk.app.network

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
    @SerializedName("family_alarm_quiet_days") val familyAlarmQuietDays: List<Int> = listOf(1, 2, 3, 4, 5),
    @SerializedName("family_alarm_quiet_start") val familyAlarmQuietStart: String = "09:00",
    @SerializedName("family_alarm_quiet_end") val familyAlarmQuietEnd: String = "18:30",
    @SerializedName("family_alarm_quiet_windows") val familyAlarmQuietWindows: List<FamilyAlarmQuietWindow>? = null,
    @SerializedName("dynamic_prompt_settings") val dynamicPromptSettings: DynamicPromptSettings =
        DynamicPromptSettings(),
    @SerializedName("dynamic_prompt_settings_state") val dynamicPromptSettingsState: DynamicPromptSettingsState =
        DynamicPromptSettingsState(),
)

data class FamilyAlarmTalkRequest(
    @SerializedName("recipient_user_id") val recipientUserId: String,
    @SerializedName("wake_at") val wakeAt: String,
    @SerializedName("voice_upload_id") val voiceUploadId: String,
    val label: String? = null,
    @SerializedName("repeat_days") val repeatDays: List<Int> = emptyList(),
)

data class FamilyAlarmTalkResponse(
    val alarm: FamilyAlarmTalk,
)

data class FamilyAlarmTalk(
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
    suspend fun createFamilyAlarmTalk(
        @Header("Authorization") authorization: String,
        @Body request: FamilyAlarmTalkRequest,
    ): FamilyAlarmTalkResponse
}
