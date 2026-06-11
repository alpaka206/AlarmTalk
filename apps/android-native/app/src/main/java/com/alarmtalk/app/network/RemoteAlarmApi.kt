package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

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
    @SerializedName("message_id") val messageId: String? = null,
    @SerializedName("message_text") val messageText: String? = null,
    val category: String? = null,
    @SerializedName("raw_audio_url") val rawAudioUrl: String? = null,
    @SerializedName("message_audio_url") val messageAudioUrl: String? = null,
    @SerializedName("raw_audio_duration_ms") val rawAudioDurationMs: Long? = null,
    @SerializedName("target_user_id") val targetUserId: String? = null,
    @SerializedName("sender_user_id") val senderUserId: String? = null,
    @SerializedName("sender_name") val senderName: String? = null,
    @SerializedName("sender_email") val senderEmail: String? = null,
    @SerializedName("is_family_alarm") val isFamilyAlarm: Boolean = false,
    @SerializedName("is_received_family_alarm") val isReceivedFamilyAlarm: Boolean = false,
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
    @SerializedName("target_user_id") val targetUserId: String? = null,
    // 사용자 기기의 IANA 타임존(예: "Asia/Seoul"). 서버가 로컬 시각(time)을 절대 시각으로
    // 해석할 수 있게 함께 보낸다. 서버가 아직 받지 않아도 무해(무시됨).
    @SerializedName("timezone") val timezone: String? = null,
)

interface RemoteAlarmApi {
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
}
