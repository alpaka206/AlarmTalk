package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

/**
 * 사용 기록 전송 — 오프라인에 쌓아 둔 것을 **모아서** 보낸다.
 *
 * ⚠ **한 건씩 보내지 않는다.** 재연결 순간에 수십 번을 왕복하게 된다. 서버도 배치만 받는다
 * (`POST /api/events`).
 */
data class UsageEventPayload(
    /** 기기가 만든 UUID. 서버 PK 라 재전송해도 겹치지 않는다(멱등). */
    val id: String,
    val type: String,
    /** 기기에서 **일어난** 시각(ISO-8601 UTC). 도착 시각은 서버가 따로 찍는다. */
    @SerializedName("occurred_at") val occurredAt: String,
    @SerializedName("alarm_id") val alarmId: String? = null,
    @SerializedName("voice_profile_id") val voiceProfileId: String? = null,
    @SerializedName("message_id") val messageId: String? = null,
    val detail: String? = null,
)

data class UsageEventBatchRequest(val events: List<UsageEventPayload>)

data class UsageEventBatchResponse(val accepted: Int? = null)

interface UsageEventApi {
    @POST("events")
    suspend fun uploadUsageEvents(
        @Header("Authorization") authorization: String,
        @Body body: UsageEventBatchRequest,
    ): UsageEventBatchResponse
}
