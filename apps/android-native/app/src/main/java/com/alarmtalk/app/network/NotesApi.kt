package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

data class NoteListResponse(
    val notes: List<ReceivedNote>,
    val total: Int? = null,
    val limit: Int? = null,
    val offset: Int? = null,
)

data class ReceivedNote(
    val id: String,
    @SerializedName("sender_id") val senderId: String,
    @SerializedName("sender_name") val senderName: String? = null,
    @SerializedName("sender_email") val senderEmail: String? = null,
    @SerializedName("sender_picture") val senderPicture: String? = null,
    val text: String,
    @SerializedName("audio_url") val audioUrl: String? = null,
    @SerializedName("audio_available") val audioAvailable: Boolean? = null,
    @SerializedName("read_at") val readAt: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
)

data class SendNoteRequest(
    @SerializedName("receiver_id") val receiverId: String,
    val text: String,
    @SerializedName("audio_url") val audioUrl: String? = null,
)

data class SendNoteResponse(
    val success: Boolean,
    val note: ReceivedNote,
)

data class MarkNoteReadResponse(
    val success: Boolean,
    @SerializedName("already_read") val alreadyRead: Boolean? = null,
    @SerializedName("read_at") val readAt: String? = null,
)

data class NoteAudioResponse(
    @SerializedName("note_id") val noteId: String,
    @SerializedName("audio_base64") val audioBase64: String,
    @SerializedName("audio_format") val audioFormat: String,
    @SerializedName("audio_url") val audioUrl: String? = null,
    val text: String = "",
)

interface NotesApi {
    @GET("notes/received")
    suspend fun listReceivedNotes(
        @Header("Authorization") authorization: String,
        @Query("limit") limit: Int = 20,
        @Query("offset") offset: Int = 0,
    ): NoteListResponse

    @POST("notes")
    suspend fun sendNote(
        @Header("Authorization") authorization: String,
        @Body request: SendNoteRequest,
    ): SendNoteResponse

    @GET("notes/{id}/audio")
    suspend fun getNoteAudio(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): NoteAudioResponse

    @PATCH("notes/{id}/read")
    suspend fun markNoteRead(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): MarkNoteReadResponse
}
