package com.voicealarm.nativeapp.data

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.net.toUri
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Locale
import java.util.Properties

object AlarmAudioLimits {
    const val MAX_DURATION_MILLIS = 30_000L
}

data class CachedAlarmAudio(
    val localAudioUri: String,
    val rawAudioUri: String?,
    val displayName: String,
    val durationMillis: Long?,
    val cacheKey: String?,
    val messageId: String? = null,
)

class AlarmAudioStore(
    private val context: Context,
) {
    private val audioDir: File
        get() = File(context.filesDir, AUDIO_DIR).also { it.mkdirs() }

    fun createRecordingFile(): File =
        File(audioDir, "recording_${System.currentTimeMillis()}.m4a")

    fun cachedRecording(file: File): CachedAlarmAudio {
        val bytes = file.readBytes()
        val cacheKey = audioCacheKeyForBytes(bytes)
        val extension = file.extension.takeIf { it.isNotBlank() } ?: "m4a"
        val cachedFile = findCachedFile(cacheKey) ?: File(audioDir, "${safeCacheKey(cacheKey)}.$extension").also { target ->
            if (target.absolutePath != file.absolutePath) {
                file.copyTo(target, overwrite = false)
                file.delete()
            }
        }
        val uri = cachedFile.toUri()
        val durationMillis = readDurationMillis(uri)
        return CachedAlarmAudio(
            localAudioUri = uri.toString(),
            rawAudioUri = null,
            displayName = cachedFile.name,
            durationMillis = durationMillis,
            cacheKey = cacheKey,
            messageId = null,
        )
    }

    fun cacheFromUri(sourceUri: Uri): CachedAlarmAudio {
        val durationMillis = readDurationMillis(sourceUri)
        val displayName = readDisplayName(sourceUri) ?: "voice_${System.currentTimeMillis()}"
        val extension = extensionFor(sourceUri, displayName)
        val cacheKey = audioCacheKeyForSource(sourceUri.toString(), durationMillis)
        findCachedFile(cacheKey)?.let { cached ->
            val cachedUri = cached.toUri()
            val metadata = readMetadata(cacheKey)
            return CachedAlarmAudio(
                localAudioUri = cachedUri.toString(),
                rawAudioUri = metadata.rawAudioUri ?: sourceUri.toString(),
                displayName = cached.name,
                durationMillis = readDurationMillis(cachedUri) ?: durationMillis,
                cacheKey = cacheKey,
                messageId = metadata.messageId,
            )
        }
        val target = if (durationMillis != null && durationMillis > AlarmAudioLimits.MAX_DURATION_MILLIS) {
            File(audioDir, "${safeCacheKey(cacheKey)}.m4a").also {
                trimToMaxDuration(sourceUri, it)
            }
        } else {
            File(audioDir, "${safeCacheKey(cacheKey)}.$extension").also { file ->
                context.contentResolver.openInputStream(sourceUri).use { input ->
                    requireNotNull(input) { "Unable to open selected audio." }
                    file.outputStream().use { output -> input.copyTo(output) }
                }
            }
        }

        val cachedDurationMillis = readDurationMillis(target.toUri()) ?: durationMillis
        requireWithinLimit(cachedDurationMillis)

        Log.i(TAG, "Cached local voice audio path=${target.absolutePath} durationMillis=$cachedDurationMillis")
        return CachedAlarmAudio(
            localAudioUri = target.toUri().toString(),
            rawAudioUri = sourceUri.toString(),
            displayName = displayName,
            durationMillis = cachedDurationMillis,
            cacheKey = cacheKey,
            messageId = null,
        )
    }

    fun cacheGeneratedAudio(
        bytes: ByteArray,
        format: String,
        rawAudioUri: String?,
        displayName: String = "generated_voice_${System.currentTimeMillis()}",
        cacheKey: String? = null,
        messageId: String? = null,
    ): CachedAlarmAudio {
        val extension = format.lowercase(Locale.US).substringBefore(';').takeIf { it.length in 2..5 } ?: "mp3"
        val resolvedCacheKey = cacheKey ?: audioCacheKeyForBytes(bytes)
        findCachedFile(resolvedCacheKey)?.let { cached ->
            val cachedUri = cached.toUri()
            val metadata = readMetadata(resolvedCacheKey)
            return CachedAlarmAudio(
                localAudioUri = cachedUri.toString(),
                rawAudioUri = metadata.rawAudioUri ?: rawAudioUri,
                displayName = cached.name,
                durationMillis = readDurationMillis(cachedUri),
                cacheKey = resolvedCacheKey,
                messageId = metadata.messageId ?: messageId,
            )
        }
        val target = File(audioDir, "${safeCacheKey(resolvedCacheKey)}.$extension")
        target.writeBytes(bytes)
        writeMetadata(
            cacheKey = resolvedCacheKey,
            rawAudioUri = rawAudioUri,
            messageId = messageId,
        )
        val durationMillis = readDurationMillis(target.toUri())
        requireWithinLimit(durationMillis)
        Log.i(TAG, "Cached generated voice audio path=${target.absolutePath} durationMillis=$durationMillis")
        return CachedAlarmAudio(
            localAudioUri = target.toUri().toString(),
            rawAudioUri = rawAudioUri,
            displayName = target.name,
            durationMillis = durationMillis,
            cacheKey = resolvedCacheKey,
            messageId = messageId,
        )
    }

    fun getCachedAudio(cacheKey: String, rawAudioUri: String? = null): CachedAlarmAudio? {
        val cached = findCachedFile(cacheKey) ?: return null
        val uri = cached.toUri()
        val metadata = readMetadata(cacheKey)
        return CachedAlarmAudio(
            localAudioUri = uri.toString(),
            rawAudioUri = metadata.rawAudioUri ?: rawAudioUri,
            displayName = cached.name,
            durationMillis = readDurationMillis(uri),
            cacheKey = cacheKey,
            messageId = metadata.messageId,
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

    private fun trimToMaxDuration(sourceUri: Uri, target: File) {
        runCatching {
            val extractor = MediaExtractor()
            val muxer = MediaMuxer(target.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            try {
                extractor.setDataSource(context, sourceUri, null)
                val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
                    extractor.getTrackFormat(index)
                        .getString(MediaFormat.KEY_MIME)
                        ?.startsWith("audio/") == true
                } ?: error("No audio track found.")
                extractor.selectTrack(trackIndex)
                val inputFormat = extractor.getTrackFormat(trackIndex)
                val outputTrackIndex = muxer.addTrack(inputFormat)
                val maxInputSize = if (inputFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    inputFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
                } else {
                    256 * 1024
                }.coerceAtLeast(64 * 1024)
                val buffer = ByteBuffer.allocate(maxInputSize)
                val bufferInfo = MediaCodec.BufferInfo()
                muxer.start()

                while (true) {
                    val sampleTimeUs = extractor.sampleTime
                    if (sampleTimeUs < 0 || sampleTimeUs > AlarmAudioLimits.MAX_DURATION_MILLIS * 1_000) break
                    buffer.clear()
                    val sampleSize = extractor.readSampleData(buffer, 0)
                    if (sampleSize < 0) break
                    bufferInfo.set(0, sampleSize, sampleTimeUs, extractor.sampleFlags)
                    muxer.writeSampleData(outputTrackIndex, buffer, bufferInfo)
                    extractor.advance()
                }
            } finally {
                runCatching { muxer.stop() }
                muxer.release()
                extractor.release()
            }
        }.onFailure { error ->
            target.delete()
            Log.e(TAG, "Failed to trim selected voice audio uri=$sourceUri", error)
            throw IllegalArgumentException("30초 초과 파일을 자동으로 자르지 못했어요. m4a/aac/mp4 형식으로 다시 선택해 주세요.", error)
        }.getOrThrow()
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

    private fun findCachedFile(cacheKey: String): File? {
        val safeKey = safeCacheKey(cacheKey)
        return audioDir.listFiles()?.firstOrNull { file ->
            file.isFile && file.nameWithoutExtension == safeKey && file.extension != META_EXTENSION
        }
    }

    private fun metadataFile(cacheKey: String): File =
        File(audioDir, "${safeCacheKey(cacheKey)}.$META_EXTENSION")

    private fun writeMetadata(cacheKey: String, rawAudioUri: String?, messageId: String?) {
        val props = Properties()
        rawAudioUri?.takeIf { it.isNotBlank() }?.let { props.setProperty("rawAudioUri", it) }
        messageId?.takeIf { it.isNotBlank() }?.let { props.setProperty("messageId", it) }
        if (props.isEmpty()) return
        metadataFile(cacheKey).outputStream().use { props.store(it, null) }
    }

    private fun readMetadata(cacheKey: String): CachedAudioMetadata {
        val file = metadataFile(cacheKey)
        if (!file.exists()) return CachedAudioMetadata()
        val props = Properties()
        return runCatching {
            file.inputStream().use { props.load(it) }
            CachedAudioMetadata(
                rawAudioUri = props.getProperty("rawAudioUri"),
                messageId = props.getProperty("messageId"),
            )
        }.getOrDefault(CachedAudioMetadata())
    }

    companion object {
        private const val AUDIO_DIR = "alarm-audio"
        private const val META_EXTENSION = "meta"

        fun ttsCacheKey(
            profileId: String,
            text: String,
            category: String,
            language: String,
            serverCacheKey: String? = null,
        ): String =
            serverCacheKey?.takeIf { it.isNotBlank() }
                ?: sha256(listOf("tts", profileId, text.trim().replace(Regex("\\s+"), " "), category, language).joinToString("|"))

        fun audioCacheKeyForSource(sourceUri: String, durationMillis: Long?): String =
            sha256(listOf("source", sourceUri, durationMillis?.toString().orEmpty()).joinToString("|"))

        fun audioCacheKeyForBytes(bytes: ByteArray): String = sha256(bytes)

        fun safeCacheKey(cacheKey: String): String =
            cacheKey.lowercase(Locale.US).replace(Regex("[^a-z0-9_-]"), "_").take(96)

        private fun sha256(input: String): String = sha256(input.toByteArray(Charsets.UTF_8))

        private fun sha256(bytes: ByteArray): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}

private data class CachedAudioMetadata(
    val rawAudioUri: String? = null,
    val messageId: String? = null,
)
