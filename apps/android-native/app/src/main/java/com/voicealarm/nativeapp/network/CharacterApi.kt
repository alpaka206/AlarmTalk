package com.voicealarm.nativeapp.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

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

interface CharacterApi {
    @GET("characters/me")
    suspend fun getCharacter(@Header("Authorization") authorization: String): CharacterResponse

    @POST("characters/xp")
    suspend fun grantCharacterXp(
        @Header("Authorization") authorization: String,
        @Body request: CharacterXpRequest,
    ): CharacterGrantResponse
}
