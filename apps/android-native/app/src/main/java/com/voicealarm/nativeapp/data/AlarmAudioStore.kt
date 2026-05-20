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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.abs

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
        // 동일 cacheKey 로 동시에 trim/copy 가 두 번 일어나면 중복 파일 쓰기와 망가진 캐시가 생긴다.
        // cacheKey 별 lock 으로 첫 번째 호출이 끝날 때까지 두 번째 호출이 기다리도록 한다.
        return cacheKeyLock(cacheKey).withLock {
            try {
                cacheFromUriLocked(
                    sourceUri = sourceUri,
                    maxDurationMillis = maxDurationMillis,
                    durationMillis = durationMillis,
                    displayName = displayName,
                    extension = extension,
                    sourceMimeType = sourceMimeType,
                    trackMimeType = trackMimeType,
                    forceExtractAudio = forceExtractAudio,
                    trimAsMp3 = trimAsMp3,
                    resolvedStartMillis = resolvedStartMillis,
                    cacheKey = cacheKey,
                )
            } finally {
                releaseCacheKeyLockIfUnused(cacheKey)
            }
        }
    }

    @Suppress("LongParameterList")
    private fun cacheFromUriLocked(
        sourceUri: Uri,
        maxDurationMillis: Long,
        durationMillis: Long,
        displayName: String,
        extension: String,
        sourceMimeType: String?,
        trackMimeType: String?,
        forceExtractAudio: Boolean,
        trimAsMp3: Boolean,
        resolvedStartMillis: Long,
        cacheKey: String,
    ): CachedAlarmAudio {
        findCachedFile(cacheKey)?.let { cached ->
            val cachedUri = cached.toUri()
            val rawDuration = readDurationMillis(cachedUri)
            // 과거 잘못 만들어진 캐시(.m4a 헤더만 있고 실제 오디오 없음) 를 걸러낸다.
            //   - 파일 크기가 비정상적으로 작음 (헤더만 있는 수백 바이트)
            //   - 또는 duration 을 읽지 못함
            // 이런 캐시는 무효로 보고 삭제 후 다시 trim 한다.
            val cachedSize = cached.length()
            if (rawDuration == null || rawDuration <= 0L || cachedSize < 4 * 1024) {
                Log.w(
                    TAG,
                    "Discarding corrupt voice audio cache path=${cached.absolutePath} size=$cachedSize duration=$rawDuration",
                )
                runCatching { cached.delete() }
                runCatching { metadataFile(cacheKey).delete() }
            } else {
                val metadata = readMetadata(cacheKey)
                val cachedDurationMillis = normalizeDurationWithinLimit(
                    durationMillis = rawDuration,
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
        }
        val needsTrim = forceExtractAudio || resolvedStartMillis > 0 || durationMillis > maxDurationMillis
        Log.i(
            TAG,
            "cacheFromUri source=$sourceUri sourceMime=$sourceMimeType trackMime=$trackMimeType ext=$extension duration=$durationMillis max=$maxDurationMillis start=$resolvedStartMillis needsTrim=$needsTrim trimAsMp3=$trimAsMp3",
        )
        val target = if (needsTrim) {
            val trimExtension = if (trimAsMp3) "mp3" else "m4a"
            val trimTarget = File(audioDir, "${safeCacheKey(cacheKey)}.$trimExtension")
            runCatching {
                trimToMaxDuration(
                    sourceUri = sourceUri,
                    target = trimTarget,
                    maxDurationMillis = maxDurationMillis,
                    startMillis = resolvedStartMillis,
                    forceMp3 = trimAsMp3,
                )
            }.onFailure { error ->
                Log.w(TAG, "trimToMaxDuration threw, will try direct copy as fallback", error)
                runCatching { trimTarget.delete() }
            }
            // trim 이 성공했어도 결과가 빈 파일이면 직접 복사로 폴백.
            val trimDuration = if (trimTarget.exists()) readDurationMillis(trimTarget.toUri()) else null
            if (trimTarget.exists() && trimTarget.length() >= 4 * 1024 && trimDuration != null && trimDuration > 0L) {
                trimTarget
            } else {
                Log.w(
                    TAG,
                    "trim output empty (size=${trimTarget.length()} duration=$trimDuration), falling back to direct copy",
                )
                runCatching { trimTarget.delete() }
                // 원본을 그대로 캐시 디렉토리에 복사. duration 이 maxDuration 보다 길면 이후 단계에서 거부됨.
                File(audioDir, "${safeCacheKey(cacheKey)}.$extension").also { file ->
                    context.contentResolver.openInputStream(sourceUri).use { input ->
                        requireNotNull(input) { "선택한 오디오 파일을 열 수 없어요." }
                        file.outputStream().use { output -> input.copyTo(output) }
                    }
                }
            }
        } else {
            File(audioDir, "${safeCacheKey(cacheKey)}.$extension").also { file ->
                context.contentResolver.openInputStream(sourceUri).use { input ->
                    requireNotNull(input) { "선택한 오디오 파일을 열 수 없어요." }
                    file.outputStream().use { output -> input.copyTo(output) }
                }
            }
        }

        val trimmedDuration = readDurationMillis(target.toUri())
        Log.i(
            TAG,
            "cacheFromUri result path=${target.absolutePath} size=${target.length()} duration=$trimmedDuration",
        )
        if (trimmedDuration == null || trimmedDuration <= 0L || target.length() < 4 * 1024) {
            // trim/copy 가 사실상 빈 파일을 만들었음. 캐시 남기지 않고 명확히 실패.
            Log.e(
                TAG,
                "Cached audio empty path=${target.absolutePath} size=${target.length()} duration=$trimmedDuration",
            )
            runCatching { target.delete() }
            throw IllegalArgumentException("선택한 파일에서 오디오를 추출하지 못했어요. 다른 파일로 시도해 주세요.")
        }
        val cachedDurationMillis = trimmedDuration
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

    fun readWaveformLevels(uri: Uri, bins: Int = 48): List<Float> {
        val safeBins = bins.coerceIn(12, 120)
        val durationMillis = readDurationMillis(uri)?.coerceAtLeast(1L) ?: return emptyList()
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        return runCatching {
            extractor.setDataSource(context, uri, null)
            val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index)
                    .getString(MediaFormat.KEY_MIME)
                    ?.startsWith("audio/") == true
            } ?: return@runCatching emptyList()
            val format = extractor.getTrackFormat(trackIndex)
            val mimeType = format.getString(MediaFormat.KEY_MIME) ?: return@runCatching emptyList()
            var sampleRate = format.integerOrNull(MediaFormat.KEY_SAMPLE_RATE)?.takeIf { it > 0 } ?: 44_100
            var channelCount = format.integerOrNull(MediaFormat.KEY_CHANNEL_COUNT)?.coerceAtLeast(1) ?: 1
            extractor.selectTrack(trackIndex)
            val decoder = MediaCodec.createDecoderByType(mimeType)
            codec = decoder
            decoder.configure(format, null, null, 0)
            decoder.start()

            val sums = DoubleArray(safeBins)
            val counts = LongArray(safeBins)
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            var idleOutputCount = 0

            while (!outputDone) {
                if (!inputDone) {
                    val inputIndex = decoder.dequeueInputBuffer(DECODE_TIMEOUT_US)
                    if (inputIndex >= 0) {
                        val inputBuffer = decoder.getInputBuffer(inputIndex)
                        val sampleSize = if (inputBuffer != null) {
                            inputBuffer.clear()
                            extractor.readSampleData(inputBuffer, 0)
                        } else {
                            -1
                        }
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(
                                inputIndex,
                                0,
                                0,
                                0L,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                            )
                            inputDone = true
                        } else {
                            decoder.queueInputBuffer(
                                inputIndex,
                                0,
                                sampleSize,
                                extractor.sampleTime.coerceAtLeast(0L),
                                0,
                            )
                            extractor.advance()
                        }
                    }
                }

                when (val outputIndex = decoder.dequeueOutputBuffer(info, DECODE_TIMEOUT_US)) {
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val outputFormat = decoder.outputFormat
                        sampleRate = outputFormat.integerOrNull(MediaFormat.KEY_SAMPLE_RATE)
                            ?.takeIf { it > 0 }
                            ?: sampleRate
                        channelCount = outputFormat.integerOrNull(MediaFormat.KEY_CHANNEL_COUNT)
                            ?.coerceAtLeast(1)
                            ?: channelCount
                    }

                    MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        idleOutputCount += 1
                        if (inputDone && idleOutputCount > MAX_IDLE_OUTPUT_DEQUEUE_COUNT) {
                            outputDone = true
                        }
                    }

                    else -> if (outputIndex >= 0) {
                        idleOutputCount = 0
                        val outputBuffer = decoder.getOutputBuffer(outputIndex)
                        if (outputBuffer != null && info.size > 0) {
                            outputBuffer.position(info.offset)
                            outputBuffer.limit(info.offset + info.size)
                            collectPcmWaveformLevels(
                                buffer = outputBuffer,
                                presentationTimeUs = info.presentationTimeUs.coerceAtLeast(0L),
                                sampleRate = sampleRate,
                                channelCount = channelCount,
                                durationMillis = durationMillis,
                                sums = sums,
                                counts = counts,
                            )
                        }
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            outputDone = true
                        }
                        decoder.releaseOutputBuffer(outputIndex, false)
                    }
                }
            }

            normalizeWaveformLevels(sums, counts)
        }.onFailure { error ->
            Log.w(TAG, "Unable to read audio waveform uri=$uri", error)
        }.getOrDefault(emptyList()).also {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            extractor.release()
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

    private fun collectPcmWaveformLevels(
        buffer: ByteBuffer,
        presentationTimeUs: Long,
        sampleRate: Int,
        channelCount: Int,
        durationMillis: Long,
        sums: DoubleArray,
        counts: LongArray,
    ) {
        val safeSampleRate = sampleRate.coerceAtLeast(1)
        val safeChannelCount = channelCount.coerceAtLeast(1)
        val bytesPerFrame = safeChannelCount * 2
        var frameIndex = 0L
        while (buffer.remaining() >= bytesPerFrame) {
            var frameLevel = 0.0
            repeat(safeChannelCount) {
                val low = buffer.get().toInt() and 0xff
                val high = buffer.get().toInt()
                val sample = ((high shl 8) or low).toShort().toInt()
                frameLevel += abs(sample) / PCM_16BIT_MAX_LEVEL
            }
            val frameTimeMillis = (presentationTimeUs + (frameIndex * 1_000_000L / safeSampleRate)) / 1_000L
            val bin = (frameTimeMillis * sums.size / durationMillis)
                .toInt()
                .coerceIn(0, sums.lastIndex)
            sums[bin] += frameLevel / safeChannelCount
            counts[bin] += 1
            frameIndex += 1
        }
    }

    private fun normalizeWaveformLevels(
        sums: DoubleArray,
        counts: LongArray,
    ): List<Float> {
        if (counts.all { it == 0L }) return emptyList()
        val rawLevels = sums.indices.map { index ->
            if (counts[index] > 0L) sums[index] / counts[index] else 0.0
        }
        val maxLevel = rawLevels.maxOrNull() ?: 0.0
        if (maxLevel <= 0.0) return List(sums.size) { 0.05f }
        return rawLevels.map { level ->
            (0.06 + (level / maxLevel) * 0.94)
                .toFloat()
                .coerceIn(0.05f, 1f)
        }
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
        private const val DECODE_TIMEOUT_US = 10_000L
        private const val MAX_IDLE_OUTPUT_DEQUEUE_COUNT = 20
        private const val PCM_16BIT_MAX_LEVEL = 32768.0

        // cacheKey 별 in-flight 작업 중복 방지용 lock.
        // 프로세스 전역으로 공유하지 않으면 같은 입력에 대해 두 번 호출 시 두 번째가 첫 번째와
        // 동시에 trim/copy 를 수행해 캐시 파일을 덮어쓸 수 있다.
        private val cacheKeyLocks = ConcurrentHashMap<String, ReentrantLock>()

        private fun cacheKeyLock(cacheKey: String): ReentrantLock =
            cacheKeyLocks.computeIfAbsent(cacheKey) { ReentrantLock() }

        private fun releaseCacheKeyLockIfUnused(cacheKey: String) {
            val lock = cacheKeyLocks[cacheKey] ?: return
            // hold 중인 호출은 위 withLock 안에서 unlock 된 직후이며,
            // 다른 호출이 lock 을 잡고 있다면 isLocked 가 true 이므로 그대로 둔다.
            if (!lock.isLocked) {
                // 동일 키로 새 호출이 막 들어왔을 가능성을 고려, atomic remove 만 시도.
                cacheKeyLocks.remove(cacheKey, lock)
            }
        }

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

private fun MediaFormat.integerOrNull(key: String): Int? =
    if (containsKey(key)) {
        runCatching { getInteger(key) }.getOrNull()
    } else {
        null
    }
