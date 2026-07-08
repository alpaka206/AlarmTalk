package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

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
    // 서버 권위 판별: 내가 target 이고 내가 만든 게 아니면 true(카테고리 무관). pull 은 이 값으로
    // 받은 알람만 임포트한다 — 클라측 session.user.id 비교는 계정 연동 시 네임스페이스가 어긋난다.
    @SerializedName("is_received") val isReceived: Boolean = false,
    @SerializedName("bucket_id") val bucketId: String? = null,
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
    // 무료 버킷 회전 알람이 가리키는 버킷(예: "morning"). 회전 클립은 기기 로컬에서 해석한다.
    @SerializedName("bucket_id") val bucketId: String? = null,
)

interface RemoteAlarmApi {
    @GET("alarm")
    suspend fun listAlarms(
        @Header("Authorization") authorization: String,
        @Query("limit") limit: Int,
        @Query("offset") offset: Int,
    ): RemoteAlarmListResponse

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

    // 수신자 '그만받기': 받은 가족 알람을 서버에 영구 opt-out 한다. 로컬 삭제와 달리 재조회·
    // 재설치·동기화로 되살아나지 않는다(생성자 알람은 보존되는 비파괴 모델).
    @POST("alarm/{id}/decline")
    suspend fun declineAlarm(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    )
}
