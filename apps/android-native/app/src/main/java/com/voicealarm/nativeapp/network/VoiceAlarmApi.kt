package com.voicealarm.nativeapp.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

data class AuthUser(
    val id: String,
    val email: String,
    val name: String = "",
    val plan: String = "free",
)

data class AuthTokenResponse(
    val token: String,
    val user: AuthUser,
)

data class AuthMeResponse(
    val user: AuthUser,
)

data class LoginRequest(
    val email: String,
    val password: String,
)

data class RegisterRequest(
    val email: String,
    val password: String,
    val name: String,
)

data class RemoteAlarmListResponse(
    val alarms: List<RemoteAlarm>,
    val total: Int? = null,
    val limit: Int? = null,
    val offset: Int? = null,
)

data class RemoteAlarmResponse(
    val alarm: RemoteAlarm,
)

data class RemoteAlarm(
    val id: String,
    val time: String? = null,
    @SerializedName("repeat_days") val repeatDays: List<Int>? = null,
    @SerializedName("is_active") val isActive: Boolean? = null,
    @SerializedName("snooze_minutes") val snoozeMinutes: Int? = null,
    val mode: String? = null,
    @SerializedName("vibration_pattern") val vibrationPattern: String? = null,
    @SerializedName("wake_mode") val wakeMode: String? = null,
    @SerializedName("voice_profile_id") val voiceProfileId: String? = null,
    @SerializedName("speaker_id") val speakerId: String? = null,
    @SerializedName("raw_audio_url") val rawAudioUrl: String? = null,
    @SerializedName("raw_audio_duration_ms") val rawAudioDurationMs: Long? = null,
)

data class RemoteAlarmWriteRequest(
    val time: String,
    @SerializedName("repeat_days") val repeatDays: List<Int>,
    @SerializedName("snooze_minutes") val snoozeMinutes: Int,
    val mode: String,
    @SerializedName("vibration_pattern") val vibrationPattern: String,
    @SerializedName("wake_mode") val wakeMode: String,
    @SerializedName("is_active") val isActive: Boolean? = null,
    @SerializedName("message_id") val messageId: String? = null,
    @SerializedName("voice_profile_id") val voiceProfileId: String? = null,
    @SerializedName("raw_audio_url") val rawAudioUrl: String? = null,
    @SerializedName("raw_audio_duration_ms") val rawAudioDurationMs: Long? = null,
)

data class VoiceProfileListResponse(
    val profiles: List<VoiceProfile>,
)

data class VoiceProfile(
    val id: String,
    val name: String,
    val status: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
)

data class FamilyVoiceProfile(
    val id: String,
    val name: String,
    val status: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("user_id") val userId: String? = null,
    @SerializedName("owner_name") val ownerName: String? = null,
)

data class FamilyVoiceProfileListResponse(
    val profiles: List<FamilyVoiceProfile>,
)

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
)

data class FriendListResponse(
    val friends: List<Friend>,
    val total: Int? = null,
)

data class Friend(
    val id: String,
    @SerializedName("user_a") val userA: String? = null,
    @SerializedName("user_b") val userB: String? = null,
    @SerializedName("friend_email") val friendEmail: String? = null,
    @SerializedName("friend_name") val friendName: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
)

data class PendingFriendListResponse(
    val pending: List<PendingFriendRequest>,
    val total: Int? = null,
)

data class PendingFriendRequest(
    val id: String,
    @SerializedName("user_a") val userA: String? = null,
    @SerializedName("requester_email") val requesterEmail: String? = null,
    @SerializedName("requester_name") val requesterName: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
)

data class FriendRequestBody(
    val email: String,
)

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

data class CodeRegisterRequest(
    val code: String,
)

data class CodeRegisterResponse(
    val success: Boolean,
    val type: String? = null,
)

data class CharacterResponse(
    val character: CharacterPayload,
    val progress: CharacterProgress,
    val streak: CharacterStreak,
    val stats: CharacterStats,
    val achievements: List<StreakAchievement> = emptyList(),
)

data class CharacterPayload(
    val id: String,
    val name: String,
    val level: Int,
    val xp: Int,
    val affection: Int,
    val stage: String,
    @SerializedName("daily_xp") val dailyXp: Int = 0,
)

data class CharacterProgress(
    @SerializedName("xp_into_level") val xpIntoLevel: Int,
    @SerializedName("xp_to_next_level") val xpToNextLevel: Int,
    @SerializedName("level_span") val levelSpan: Int,
    @SerializedName("progress_ratio") val progressRatio: Double,
)

data class CharacterStreak(
    val current: Int,
    val longest: Int,
    @SerializedName("last_wakeup_date") val lastWakeupDate: String? = null,
)

data class CharacterStats(
    val diligence: Int,
    val health: Int,
    val consistency: Int,
)

data class StreakAchievement(
    val milestone: Int,
    @SerializedName("bonus_xp") val bonusXp: Int,
    @SerializedName("achieved_at") val achievedAt: String,
)

data class CharacterXpRequest(
    val event: String,
    @SerializedName("client_nonce") val clientNonce: String,
    @SerializedName("local_date") val localDate: String,
)

data class CharacterGrantResponse(
    val character: CharacterPayload,
    val progress: CharacterProgress,
    val streak: CharacterStreak,
    val stats: CharacterStats,
    val achievements: List<StreakAchievement> = emptyList(),
    val grant: CharacterGrant,
)

data class CharacterGrant(
    val event: String,
    @SerializedName("granted_xp") val grantedXp: Int,
    val affection: Int,
    val capped: Boolean,
    @SerializedName("remaining_cap") val remainingCap: Int,
    val duplicated: Boolean,
)

data class BillingSubscriptionResponse(
    val subscription: BillingSubscription?,
    val plan: BillingPlan?,
)

data class BillingSubscription(
    val id: String,
    @SerializedName("plan_id") val planId: String,
    @SerializedName("plan_group_id") val planGroupId: String? = null,
    val status: String,
    @SerializedName("starts_at") val startsAt: String,
    @SerializedName("expires_at") val expiresAt: String,
)

data class BillingPlan(
    val id: String,
    val key: String,
    val name: String,
    @SerializedName("plan_type") val planType: String,
    @SerializedName("period_days") val periodDays: Int,
    @SerializedName("max_members") val maxMembers: Int,
    @SerializedName("price_krw") val priceKrw: Int,
)

data class VoucherListResponse(
    val vouchers: List<VoucherItem>,
)

data class VoucherItem(
    val id: String,
    val code: String,
    @SerializedName("plan_name") val planName: String,
    @SerializedName("plan_type") val planType: String,
    val status: String,
    @SerializedName("expires_at") val expiresAt: String,
)

interface VoiceAlarmApi {
    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): AuthTokenResponse

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): AuthTokenResponse

    @GET("auth/me")
    suspend fun me(@Header("Authorization") authorization: String): AuthMeResponse

    @GET("alarm")
    suspend fun listAlarms(@Header("Authorization") authorization: String): RemoteAlarmListResponse

    @POST("alarm")
    suspend fun createAlarm(
        @Header("Authorization") authorization: String,
        @Body request: RemoteAlarmWriteRequest,
    ): RemoteAlarmResponse

    @PATCH("alarm/{id}")
    suspend fun updateAlarm(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Body request: RemoteAlarmWriteRequest,
    ): RemoteAlarmResponse

    @DELETE("alarm/{id}")
    suspend fun deleteAlarm(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    )

    @GET("voice")
    suspend fun listVoiceProfiles(@Header("Authorization") authorization: String): VoiceProfileListResponse

    @GET("voice/family")
    suspend fun listFamilyVoiceProfiles(@Header("Authorization") authorization: String): FamilyVoiceProfileListResponse

    @POST("tts/generate")
    suspend fun generateTts(
        @Header("Authorization") authorization: String,
        @Body request: TtsGenerateRequest,
    ): TtsGenerateResponse

    @GET("friend/list")
    suspend fun listFriends(@Header("Authorization") authorization: String): FriendListResponse

    @GET("friend/pending")
    suspend fun listPendingFriends(@Header("Authorization") authorization: String): PendingFriendListResponse

    @POST("friend")
    suspend fun sendFriendRequest(
        @Header("Authorization") authorization: String,
        @Body request: FriendRequestBody,
    )

    @PATCH("friend/{id}/accept")
    suspend fun acceptFriendRequest(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    )

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

    @POST("code/register")
    suspend fun registerCode(
        @Header("Authorization") authorization: String,
        @Body request: CodeRegisterRequest,
    ): CodeRegisterResponse

    @GET("characters/me")
    suspend fun getCharacter(@Header("Authorization") authorization: String): CharacterResponse

    @POST("characters/xp")
    suspend fun grantCharacterXp(
        @Header("Authorization") authorization: String,
        @Body request: CharacterXpRequest,
    ): CharacterGrantResponse

    @GET("billing/subscription")
    suspend fun getSubscription(@Header("Authorization") authorization: String): BillingSubscriptionResponse

    @GET("billing/vouchers")
    suspend fun listVouchers(@Header("Authorization") authorization: String): VoucherListResponse
}
