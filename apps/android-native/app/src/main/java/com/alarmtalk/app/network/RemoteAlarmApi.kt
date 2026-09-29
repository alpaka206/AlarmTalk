package com.alarmtalk.app.network

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.TypeAdapter
import com.google.gson.TypeAdapterFactory
import com.google.gson.annotations.JsonAdapter
import com.google.gson.annotations.SerializedName
import com.google.gson.reflect.TypeToken
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonWriter
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
    // null이면 total/limit/offset을 검증한 뒤 구서버 호환 순회 여부를 결정한다.
    @SerializedName("has_more") val hasMore: Boolean? = null,
    @SerializedName("next_cursor") val nextCursor: String? = null,
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
    @SerializedName("is_received") val isReceived: Boolean? = null,
    @SerializedName("bucket_id") val bucketId: String? = null,
    @SerializedName("delivery_version") val deliveryVersion: String? = null,
    @SerializedName("is_received_family_alarm") val isReceivedFamilyAlarm: Boolean? = null,
    @SerializedName("creation_replayed") val creationReplayed: Boolean? = null,
) {
    // 두 필드를 합치면 신서버의 명시적인 false도 구형 표시 때문에 뒤집힐 수 있다.
    val isReceivedForPull: Boolean get() = isReceived ?: isReceivedFamilyAlarm ?: false
}

data class RemoteAlarmReceivedRequest(
    @SerializedName("delivery_version") val deliveryVersion: String,
)

@JsonAdapter(RemoteAlarmWriteRequestAdapterFactory::class)
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
    @SerializedName("client_alarm_id") val clientAlarmId: String? = null,
    /**
     * [messageId]·[bucketId] 가 비어 있으면 **빼지 않고 `null` 로 실어** 서버 값을 지운다.
     * 본문에는 실리지 않는다(`@Transient`) — [RemoteAlarmWriteRequestAdapterFactory] 가 읽는다.
     *
     * 기본 직렬화는 null 필드를 **빼고**, 서버 `PATCH /alarm` 은 빠진 필드를 **그대로 둔다.**
     * 그래서 무료 잠금이 오디오 없이 기본 목소리로 바꾼 알람(`hasLockedPaidVoice`)을 켜고 끄면
     * 새 기본 목소리 id 만 올라가고 클론의 `message_id`·`bucket_id` 는 서버에 남는다 — 기본
     * 인사말 알람은 `greeting` 테마가 기본 목소리와 짝이 안 맞아 토글마다 `INVALID_BUCKET_ID`
     * 로 거절되고, 나머지는 반쯤 바뀐 서버 행이 된다(Codex #820). 이 알람에서만 켠다 — 다른
     * 알람은 예전처럼 빠진 필드를 서버가 지키게 둔다(`RemoteAlarmMapper.toWriteRequest`).
     */
    @Transient val clearsMissingVoiceReferences: Boolean = false,
)

/**
 * [RemoteAlarmWriteRequest] 직렬화 — 평소와 같되 [RemoteAlarmWriteRequest.clearsMissingVoiceReferences]
 * 면 비어 있는 `message_id`·`bucket_id` 를 **명시적 `null`** 로 보낸다.
 *
 * Gson 은 전역 `serializeNulls` 가 꺼져 있으면(Retrofit 의 `GsonConverterFactory.create()` 기본)
 * null 을 통째로 빼므로, 이 두 키만 `null` 을 남기고 나머지 null 은 예전처럼 뺀 트리를 쓴다.
 * 나머지 필드는 기본(리플렉션) 어댑터가 그대로 만든다 — 필드를 여기서 손으로 적지 않는다.
 */
internal class RemoteAlarmWriteRequestAdapterFactory : TypeAdapterFactory {
    override fun <T> create(gson: Gson, type: TypeToken<T>): TypeAdapter<T>? {
        if (type.rawType != RemoteAlarmWriteRequest::class.java) return null
        val delegate = gson.getDelegateAdapter(this, TypeToken.get(RemoteAlarmWriteRequest::class.java))
        val elements = gson.getAdapter(JsonElement::class.java)
        val adapter = object : TypeAdapter<RemoteAlarmWriteRequest>() {
            override fun write(out: JsonWriter, value: RemoteAlarmWriteRequest?) {
                if (value == null) {
                    out.nullValue()
                    return
                }
                val tree = delegate.toJsonTree(value).asJsonObject
                val keepNull = if (value.clearsMissingVoiceReferences) CLEARABLE_KEYS else emptySet()
                // 트리 작성기는 null 을 JsonNull 로 남긴다 — 지울 두 키만 남기고 나머지는 뺀다.
                tree.entrySet()
                    .filter { (key, element) -> element.isJsonNull && key !in keepNull }
                    .map { it.key }
                    .forEach { key -> tree.remove(key) }
                keepNull.forEach { key -> if (!tree.has(key)) tree.add(key, JsonNull.INSTANCE) }
                val serializeNulls = out.serializeNulls
                out.serializeNulls = true
                try {
                    elements.write(out, tree)
                } finally {
                    out.serializeNulls = serializeNulls
                }
            }

            override fun read(reader: JsonReader): RemoteAlarmWriteRequest? = delegate.read(reader)
        }
        @Suppress("UNCHECKED_CAST")
        return adapter as TypeAdapter<T>
    }

    private companion object {
        val CLEARABLE_KEYS = setOf("message_id", "bucket_id")
    }
}

interface RemoteAlarmApi {
    @GET("alarm")
    suspend fun listAlarms(
        @Header("Authorization") authorization: String,
        @Query("limit") limit: Int,
        @Query("after") after: String? = null,
        @Query("offset") offset: Int? = null,
        @Query("pagination") pagination: String? = if (offset == null) "cursor" else null,
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
     * 수신 확인 — 음원 확보와 켜진 알람의 OS 예약까지 끝나 **서버 행을 지워도 된다**고 알린다.
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
        @Body request: RemoteAlarmReceivedRequest,
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
