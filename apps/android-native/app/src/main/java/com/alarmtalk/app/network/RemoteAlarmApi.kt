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
    @SerializedName("vibration_pattern") val vibrationPattern: String? = null,
    @SerializedName("wake_mode") val wakeMode: String? = null,
    @SerializedName("voice_profile_id") val voiceProfileId: String? = null,
    @SerializedName("message_id") val messageId: String? = null,
    @SerializedName("message_text") val messageText: String? = null,
    val category: String? = null,
    @SerializedName("message_audio_url") val messageAudioUrl: String? = null,
    @SerializedName("sender_name") val senderName: String? = null,
    @SerializedName("sender_email") val senderEmail: String? = null,
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

    /**
     * 수신 확인 — **다 받았으니 서버 행을 지워도 된다**고 알린다.
     *
     * 받은 알람은 로컬이 원본이라(`docs/spec/family-alarm.md`) 전달이 끝나면 서버 행이
     * 할 일이 없다. 남겨 두면 오디오 보존 판정이 "아직 쓰는 알람이 있다" 고 보아
     * 클론 음원을 TTL 이 지나도 영구 보존한다.
     *
     * 실패해도 무시한다 — 다음 pull 이 같은 알람을 다시 임포트하며 재시도한다.
     */
    @POST("alarm/{id}/received")
    suspend fun markAlarmReceived(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    )

    /**
     * 이 계정이 '그만받기' 한 알람 id 목록.
     *
     * 받은 알람이 서버 목록에서 사라지는 이유는 두 가지인데(수신자 그만받기 / 발신자 삭제)
     * 목록만으로는 구분이 안 된다. 그만받기는 다른 기기에서도 지워야 하고, 발신자 삭제는
     * 받은 사람 알람을 건드리면 안 된다 — 그 구분을 위해 따로 묻는다.
     */
    @GET("alarm/declined")
    suspend fun getDeclinedAlarmIds(
        @Header("Authorization") authorization: String,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
    ): DeclinedAlarmIdsResponse
}

data class DeclinedAlarmIdsResponse(
    @SerializedName("alarm_ids") val alarmIds: List<String> = emptyList(),
    /**
     * 발신자가 **탈퇴**해 목소리가 철회된 알람. 그만받기(alarmIds)와 처리가 다르다 —
     * 알람은 남기고 목소리만 걷어낸다.
     */
    @SerializedName("revoked_alarm_ids") val revokedAlarmIds: List<String> = emptyList(),
    @SerializedName("has_more") val hasMore: Boolean = false,
)
