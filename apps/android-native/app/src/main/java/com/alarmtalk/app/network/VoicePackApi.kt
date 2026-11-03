package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Path

/*
 * 추가 음성팩 앱 API(`docs/spec/voice-packs.md` §3). 서버 짝은 `packages/backend/src/routes/voice-packs.ts` 이고 응답 모양은
 * 그쪽 `toPublicPack` 하나다 — 권리 메타데이터는 오지 않는다.
 *
 * ⚠ Gson 은 코틀린 기본 인자를 적용하지 않는다(`StockClip.renderedForCurrentVoice` 주석과 같은 이유). 그래서 없어도 되는
 * 값은 nullable 이거나 원시 기본값(0·false)이 맞는 뜻일 때만 원시형이다.
 */

data class VoicePackListResponse(
    val packs: List<VoicePackSummary>? = null,
    val withdrawn: List<WithdrawnVoicePack>? = null,
)

data class VoicePackSummary(
    @SerializedName("pack_id") val packId: String,
    @SerializedName("voice_id") val voiceId: String,
    @SerializedName("content_revision") val contentRevision: Int = 0,
    @SerializedName("speaker_name") val speakerName: String,
    val description: String? = null,
    @SerializedName("usage_note") val usageNote: String? = null,
    val language: String? = null,
    val categories: List<String>? = null,
    @SerializedName("clip_count") val clipCount: Int = 0,
    @SerializedName("total_bytes") val totalBytes: Long = 0,
    val preview: VoicePackPreview? = null,
    /** 상세(`GET /voice-packs/:packId`)에만 온다. */
    val clips: List<VoicePackClip>? = null,
)

data class VoicePackPreview(
    @SerializedName("clip_id") val clipId: String,
    @SerializedName("size_bytes") val sizeBytes: Long = 0,
)

data class VoicePackClip(
    @SerializedName("clip_id") val clipId: String,
    val category: String,
    val language: String? = null,
    val variant: Int = 0,
    val text: String? = null,
    val sha256: String,
    @SerializedName("size_bytes") val sizeBytes: Long = 0,
    @SerializedName("audio_format") val audioFormat: String? = null,
)

/** 게시가 끝난 팩 — 받아 둔 팩이면 [playbackUntil] 까지 기존 알람이 울고, 그 뒤 미나로 바뀐다(스펙 §5). */
data class WithdrawnVoicePack(
    @SerializedName("pack_id") val packId: String,
    @SerializedName("voice_id") val voiceId: String,
    @SerializedName("playback_until") val playbackUntil: String,
)

data class VoicePackDetailResponse(val pack: VoicePackSummary)

data class VoicePackAudioResponse(
    @SerializedName("clip_id") val clipId: String,
    @SerializedName("pack_id") val packId: String? = null,
    @SerializedName("audio_base64") val audioBase64: String,
    @SerializedName("audio_format") val audioFormat: String? = null,
    val sha256: String? = null,
    @SerializedName("size_bytes") val sizeBytes: Long = 0,
)

interface VoicePackApi {
    @GET("voice-packs")
    suspend fun listVoicePacks(@Header("Authorization") authorization: String): VoicePackListResponse

    @GET("voice-packs/{packId}")
    suspend fun getVoicePack(
        @Header("Authorization") authorization: String,
        @Path("packId") packId: String,
    ): VoicePackDetailResponse

    @GET("voice-packs/{packId}/clips/{clipId}/audio")
    suspend fun getVoicePackClipAudio(
        @Header("Authorization") authorization: String,
        @Path("packId") packId: String,
        @Path("clipId") clipId: String,
    ): VoicePackAudioResponse
}
