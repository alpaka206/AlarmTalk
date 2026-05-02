package com.voicealarm.nativeapp.data

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.net.toUri
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import java.io.File

object AlarmAudioLimits {
    const val MAX_DURATION_MILLIS = 30_000L
}

data class CachedAlarmAudio(
    val localAudioUri: String,
    val rawAudioUri: String?,
    val displayName: String,
    val durationMillis: Long?,
)

class AlarmAudioStore(
    private val context: Context,
) {
    private val audioDir: File
        get() = File(context.filesDir, AUDIO_DIR).also { it.mkdirs() }

    fun createRecordingFile(): File =
        File(audioDir, "recording_${System.currentTimeMillis()}.m4a")

    fun cachedRecording(file: File): CachedAlarmAudio {
        val uri = file.toUri()
        val durationMillis = readDurationMillis(uri)
        requireWithinLimit(durationMillis)
        return CachedAlarmAudio(
            localAudioUri = uri.toString(),
            rawAudioUri = null,
            displayName = file.name,
            durationMillis = durationMillis,
        )
    }

    fun cacheFromUri(sourceUri: Uri): CachedAlarmAudio {
        val durationMillis = readDurationMillis(sourceUri)
        requireWithinLimit(durationMillis)

        val displayName = readDisplayName(sourceUri) ?: "voice_${System.currentTimeMillis()}"
        val extension = extensionFor(sourceUri, displayName)
        val target = File(audioDir, "voice_${System.currentTimeMillis()}.$extension")

        context.contentResolver.openInputStream(sourceUri).use { input ->
            requireNotNull(input) { "Unable to open selected audio." }
            target.outputStream().use { output -> input.copyTo(output) }
        }

        Log.i(TAG, "Cached local voice audio path=${target.absolutePath} durationMillis=$durationMillis")
        return CachedAlarmAudio(
            localAudioUri = target.toUri().toString(),
            rawAudioUri = sourceUri.toString(),
            displayName = displayName,
            durationMillis = durationMillis,
        )
    }

    fun readDurationMillis(uri: Uri): Long? {
        val retriever = MediaMetadataRetriever()
        return runCatching {
            retriever.setDataSource(context, uri)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        }.onFailure { error ->
            Log.w(TAG, "Unable to read audio duration uri=$uri", error)
        }.getOrNull().also {
            retriever.release()
        }
    }

    private fun requireWithinLimit(durationMillis: Long?) {
        require(durationMillis == null || durationMillis <= AlarmAudioLimits.MAX_DURATION_MILLIS) {
            "Voice audio must be 30 seconds or shorter."
        }
    }

    private fun readDisplayName(uri: Uri): String? =
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME))
            } else {
                null
            }
        }

    private fun extensionFor(uri: Uri, displayName: String): String {
        val fromName = displayName.substringAfterLast('.', missingDelimiterValue = "")
            .lowercase()
            .takeIf { it.isNotBlank() && it.length <= 5 }
        if (fromName != null) return fromName

        val mimeType = context.contentResolver.getType(uri)
        return MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType) ?: "m4a"
    }

    companion object {
        private const val AUDIO_DIR = "alarm-audio"
    }
}
