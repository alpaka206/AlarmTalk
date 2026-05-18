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

object VoiceProfileAudioLimits {
    const val MIN_DURATION_MILLIS = 60_000L
    const val RECOMMENDED_DURATION_MILLIS = 90_000L
    const val MAX_DURATION_MILLIS = 120_000L
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

    fun cacheFromUri(
        sourceUri: Uri,
        maxDurationMillis: Long = AlarmAudioLimits.MAX_DURATION_MILLIS,
        startMillis: Long = 0L,
    ): CachedAlarmAudio {
        val durationMillis = readDurationMillis(sourceUri)
            ?: throw IllegalArgumentException("오디오 길이를 확인할 수 없는 파일은 사용할 수 없어요.")
        val displayName = readDisplayName(sourceUri) ?: "voice_${System.currentTimeMillis()}"
        val extension = extensionFor(sourceUri, displayName)
        val sourceMimeType = context.contentResolver.getType(sourceUri)
        val trackMimeType = audioTrackMime(sourceUri)
        val forceExtractAudio = sourceMimeType?.startsWith("video/") == true
        val trimAsMp3 = extension == "mp3" || isMp3Mime(trackMimeType)
        val resolvedStartMillis = startMillis.coerceIn(0L, (durationMillis - maxDurationMillis).coerceAtLeast(0L))
        val cacheKey = audioCacheKeyForSource(
            sourceUri = sourceUri.toString(),
            durationMillis = durationMillis,
            startMillis = resolvedStartMillis,
            maxDurationMillis = maxDurationMillis,
        )
        findCachedFile(cacheKey)?.let { cached ->
            val cachedUri = cached.toUri()
            val metadata = readMetadata(cacheKey)
            val cachedDurationMillis = normalizeDurationWithinLimit(
                durationMillis = readDurationMillis(cachedUri) ?: durationMillis,
                maxDurationMillis = maxDurationMillis,
            )
            return CachedAlarmAudio(
                localAudioUri = cachedUri.toString(),
                rawAudioUri = metadata.rawAudioUri ?: sourceUri.toString(),
                displayName = cached.name,
                durationMillis = cachedDurationMillis,
                cacheKey = cacheKey,
                messageId = metadata.messageId,
            )
        }
        val target = if (forceExtractAudio || resolvedStartMillis > 0 || durationMillis > maxDurationMillis) {
            val trimExtension = if (trimAsMp3) "mp3" else "m4a"
            File(audioDir, "${safeCacheKey(cacheKey)}.$trimExtension").also {
                trimToMaxDuration(
                    sourceUri = sourceUri,
                    target = it,
                    maxDurationMillis = maxDurationMillis,
                    startMillis = resolvedStartMillis,
                    forceMp3 = trimAsMp3,
                )
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
        val normalizedDurationMillis = normalizeDurationWithinLimit(cachedDurationMillis, maxDurationMillis)

        Log.i(TAG, "Cached local voice audio path=${target.absolutePath} durationMillis=$normalizedDurationMillis")
        return CachedAlarmAudio(
            localAudioUri = target.toUri().toString(),
            rawAudioUri = sourceUri.toString(),
            displayName = displayName,
            durationMillis = normalizedDurationMillis,
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

    fun deleteCachedAudio(cacheKey: String) {
        val safeKey = safeCacheKey(cacheKey)
        audioDir.listFiles()?.forEach { file ->
            if (file.isFile && file.nameWithoutExtension == safeKey) {
                if (file.delete()) {
                    Log.i(TAG, "Deleted cached alarm audio path=${file.absolutePath}")
                } else {
                    Log.w(TAG, "Failed to delete cached alarm audio path=${file.absolutePath}")
                }
            }
        }
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

    private fun normalizeDurationWithinLimit(
        durationMillis: Long?,
        maxDurationMillis: Long,
    ): Long? {
        requireWithinLimit(durationMillis, maxDurationMillis)
        return durationMillis?.coerceAtMost(maxDurationMillis)
    }

    private fun requireWithinLimit(
        durationMillis: Long?,
        maxDurationMillis: Long = AlarmAudioLimits.MAX_DURATION_MILLIS,
    ) {
        val toleratedLimit = maxDurationMillis + DURATION_METADATA_TOLERANCE_MILLIS
        require(durationMillis == null || durationMillis <= toleratedLimit) {
            "Voice audio must be ${maxDurationMillis / 1000} seconds or shorter."
        }
    }

    private fun trimToMaxDuration(
        sourceUri: Uri,
        target: File,
        maxDurationMillis: Long,
        startMillis: Long = 0L,
        forceMp3: Boolean = false,
    ) {
        if (forceMp3 || isMp3Mime(audioTrackMime(sourceUri))) {
            trimMp3Frames(sourceUri, target, maxDurationMillis, startMillis)
            return
        }
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
                val startUs = startMillis * 1_000
                val endUs = startUs + maxDurationMillis * 1_000
                if (startUs > 0) {
                    extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                }

                while (true) {
                    val sampleTimeUs = extractor.sampleTime
                    if (sampleTimeUs < 0 || sampleTimeUs >= endUs) break
                    buffer.clear()
                    val sampleSize = extractor.readSampleData(buffer, 0)
                    if (sampleSize < 0) break
                    bufferInfo.set(
                        0,
                        sampleSize,
                        (sampleTimeUs - startUs).coerceAtLeast(0L),
                        codecBufferFlags(extractor.sampleFlags),
                    )
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
            throw IllegalArgumentException("${maxDurationMillis / 1000}초 초과 파일을 자동으로 자르지 못했어요. m4a/aac/mp4 형식으로 다시 선택해 주세요.", error)
        }.getOrThrow()
    }

    private fun trimMp3Frames(
        sourceUri: Uri,
        target: File,
        maxDurationMillis: Long,
        startMillis: Long,
    ) {
        runCatching {
            val extractor = MediaExtractor()
            try {
                extractor.setDataSource(context, sourceUri, null)
                val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
                    extractor.getTrackFormat(index)
                        .getString(MediaFormat.KEY_MIME)
                        ?.startsWith("audio/") == true
                } ?: error("No audio track found.")
                extractor.selectTrack(trackIndex)
                val inputFormat = extractor.getTrackFormat(trackIndex)
                val maxInputSize = if (inputFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    inputFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
                } else {
                    256 * 1024
                }.coerceAtLeast(64 * 1024)
                val buffer = ByteBuffer.allocate(maxInputSize)
                val startUs = startMillis * 1_000
                val endUs = startUs + maxDurationMillis * 1_000
                if (startUs > 0) {
                    extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                }

                target.outputStream().use { output ->
                    while (true) {
                        val sampleTimeUs = extractor.sampleTime
                        if (sampleTimeUs < 0 || sampleTimeUs >= endUs) break
                        buffer.clear()
                        val sampleSize = extractor.readSampleData(buffer, 0)
                        if (sampleSize < 0) break
                        output.write(buffer.array(), 0, sampleSize)
                        extractor.advance()
                    }
                }
            } finally {
                extractor.release()
            }
        }.onFailure { error ->
            target.delete()
            Log.e(TAG, "Failed to trim selected mp3 voice audio uri=$sourceUri", error)
            throw IllegalArgumentException("MP3 구간을 저장하지 못했어요. 다른 파일을 선택해 주세요.", error)
        }.getOrThrow()
    }

    private fun audioTrackMime(uri: Uri): String? {
        val extractor = MediaExtractor()
        return runCatching {
            extractor.setDataSource(context, uri, null)
            (0 until extractor.trackCount).firstNotNullOfOrNull { index ->
                extractor.getTrackFormat(index)
                    .getString(MediaFormat.KEY_MIME)
                    ?.takeIf { it.startsWith("audio/") }
            }
        }.getOrNull().also {
            extractor.release()
        }
    }

    private fun isMp3Mime(mimeType: String?): Boolean =
        mimeType.equals("audio/mpeg", ignoreCase = true) ||
            mimeType.equals("audio/mp3", ignoreCase = true)

    private fun codecBufferFlags(sampleFlags: Int): Int {
        var flags = 0
        if (sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) {
            flags = flags or MediaCodec.BUFFER_FLAG_KEY_FRAME
        }
        if (sampleFlags and MediaExtractor.SAMPLE_FLAG_PARTIAL_FRAME != 0) {
            flags = flags or MediaCodec.BUFFER_FLAG_PARTIAL_FRAME
        }
        return flags
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
        private const val DURATION_METADATA_TOLERANCE_MILLIS = 750L

        fun ttsCacheKey(
            profileId: String,
            text: String,
            category: String,
            language: String,
            serverCacheKey: String? = null,
        ): String =
            serverCacheKey?.takeIf { it.isNotBlank() }
                ?: sha256(listOf("tts-v2", profileId, text.trim().replace(Regex("\\s+"), " "), category, language).joinToString("|"))

        fun audioCacheKeyForSource(
            sourceUri: String,
            durationMillis: Long?,
            startMillis: Long = 0L,
            maxDurationMillis: Long = AlarmAudioLimits.MAX_DURATION_MILLIS,
        ): String =
            sha256(
                listOf(
                    "source",
                    sourceUri,
                    durationMillis?.toString().orEmpty(),
                    startMillis.toString(),
                    maxDurationMillis.toString(),
                ).joinToString("|"),
            )

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
