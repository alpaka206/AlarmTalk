package com.alarmtalk.app.data

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
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Locale
import java.util.Properties
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantLock
import kotlin.math.abs

object AlarmAudioLimits {
    const val MAX_DURATION_MILLIS = 30_000L
}

object VoiceProfileAudioLimits {
    const val MIN_DURATION_MILLIS = 60_000L
    const val RECOMMENDED_DURATION_MILLIS = 90_000L
    const val MAX_DURATION_MILLIS = 120_000L
    const val MAX_DURATION_TOLERANCE_MILLIS = 5_000L
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
            ?: throw IllegalArgumentException(context.getString(R.string.rd_audio_duration_unreadable))
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
        val lock = cacheKeyLock(cacheKey)
        lock.lock()
        return try {
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
            lock.unlock()
            releaseCacheKeyLockIfUnused(cacheKey, lock)
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
                val cachedDurationMillis: Long? = runCatching {
                    normalizeDurationWithinLimit(
                        durationMillis = rawDuration,
                        maxDurationMillis = maxDurationMillis,
                        toleranceMillis = toleranceForLimit(maxDurationMillis),
                    )
                }.getOrElse { error ->
                    Log.w(
                        TAG,
                        "Discarding over-limit voice audio cache path=${cached.absolutePath} duration=$rawDuration max=$maxDurationMillis",
                        error,
                    )
                    runCatching { cached.delete() }
                    runCatching { metadataFile(cacheKey).delete() }
                    null
                }
                if (cachedDurationMillis != null) {
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
                AlarmTalkLog.reportError("trimToMaxDuration failed", error)
                runCatching { trimTarget.delete() }
                throw IllegalArgumentException(
                    context.getString(R.string.rd_audio_trim_failed),
                    error,
                )
            }.getOrThrow()
            // trim 이 실패한 상태에서 원본을 올리면 2분 제한을 다시 넘기므로, 빈 결과는 명확한 실패로 처리한다.
            val trimDuration = if (trimTarget.exists()) readDurationMillis(trimTarget.toUri()) else null
            if (trimTarget.exists() && trimTarget.length() >= 4 * 1024 && trimDuration != null && trimDuration > 0L) {
                trimTarget
            } else {
                AlarmTalkLog.reportError("trim output empty path=${trimTarget.absolutePath} size=${trimTarget.length()} duration=$trimDuration",
                )
                runCatching { trimTarget.delete() }
                throw IllegalArgumentException(
                    context.getString(R.string.rd_audio_trim_failed),
                )
            }
        } else {
            File(audioDir, "${safeCacheKey(cacheKey)}.$extension").also { file ->
                context.contentResolver.openInputStream(sourceUri).use { input ->
                    requireNotNull(input) { context.getString(R.string.rd_audio_open_failed) }
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
            AlarmTalkLog.reportError("Cached audio empty path=${target.absolutePath} size=${target.length()} duration=$trimmedDuration",
            )
            runCatching { target.delete() }
            throw IllegalArgumentException(context.getString(R.string.rd_audio_extract_failed))
        }
        val cachedDurationMillis = trimmedDuration
        val normalizedDurationMillis = normalizeDurationWithinLimit(
            durationMillis = cachedDurationMillis,
            maxDurationMillis = maxDurationMillis,
            toleranceMillis = toleranceForLimit(maxDurationMillis),
        )

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

    /**
     * 원본에서 여러 발화 구간([startMillis, endMillis])만 잘라 하나로 이어붙인 클립을 만든다.
     * 화자 분리에서 "그 화자 발화 구간"만 모아 클론 소스로 쓰기 위한 용도 — 구간 사이의
     * 다른 화자/침묵은 버린다. 구간 합이 maxDurationMillis 를 넘으면 앞에서부터 채우고 자른다.
     */
    fun cacheFromUriSegments(
        sourceUri: Uri,
        segments: List<Pair<Long, Long>>,
        maxDurationMillis: Long = AlarmAudioLimits.MAX_DURATION_MILLIS,
    ): CachedAlarmAudio {
        val durationMillis = readDurationMillis(sourceUri)
            ?: throw IllegalArgumentException(context.getString(R.string.rd_audio_duration_unreadable))
        // 유효 구간만 남긴다: [0,duration] 클램프, start<end, 시작순 정렬, 합이 max 를 넘으면 잘라 담는다.
        val cleaned = ArrayList<Pair<Long, Long>>()
        var accMillis = 0L
        for ((rawStart, rawEnd) in segments.sortedBy { it.first }) {
            if (accMillis >= maxDurationMillis) break
            val start = rawStart.coerceIn(0L, durationMillis)
            val end = rawEnd.coerceIn(0L, durationMillis)
            if (end <= start) continue
            val remaining = maxDurationMillis - accMillis
            val clippedEnd = if (end - start > remaining) start + remaining else end
            cleaned.add(start to clippedEnd)
            accMillis += clippedEnd - start
        }
        require(cleaned.isNotEmpty()) { context.getString(R.string.rd_audio_extract_failed) }

        val displayName = readDisplayName(sourceUri) ?: "voice_${System.currentTimeMillis()}"
        val extension = extensionFor(sourceUri, displayName)
        val trackMimeType = audioTrackMime(sourceUri)
        val trimAsMp3 = extension == "mp3" || isMp3Mime(trackMimeType)

        val segToken = cleaned.joinToString(";") { "${it.first}-${it.second}" }
        val cacheKey = audioCacheKeyForSource(
            sourceUri = "$sourceUri#seg:$segToken",
            durationMillis = accMillis,
            startMillis = 0L,
            maxDurationMillis = maxDurationMillis,
        )
        val lock = cacheKeyLock(cacheKey)
        lock.lock()
        return try {
            val cachedHit = findCachedFile(cacheKey)?.let { cached ->
                val cachedDuration = readDurationMillis(cached.toUri())
                if (cachedDuration != null && cachedDuration > 0L && cached.length() >= 4 * 1024) {
                    CachedAlarmAudio(
                        localAudioUri = cached.toUri().toString(),
                        rawAudioUri = sourceUri.toString(),
                        displayName = displayName,
                        // 헤더 없는 MP3 concat 은 MediaMetadataRetriever 가 길이를 오판할 수 있어,
                        // 실제 잘라 담은 세그먼트 합(accMillis)을 길이로 쓴다(클론 게이트 정합).
                        durationMillis = accMillis,
                        cacheKey = cacheKey,
                        messageId = null,
                    )
                } else {
                    runCatching { cached.delete() }
                    null
                }
            }
            if (cachedHit != null) {
                cachedHit
            } else {
                val outExtension = if (trimAsMp3) "mp3" else "m4a"
                val target = File(audioDir, "${safeCacheKey(cacheKey)}.$outExtension")
                runCatching {
                    concatSegments(sourceUri = sourceUri, target = target, segments = cleaned, forceMp3 = trimAsMp3)
                }.onFailure { error ->
                    runCatching { target.delete() }
                    Log.e(TAG, "Failed to concat voice speaker segments uri=$sourceUri", error)
                    AlarmTalkLog.reportError("Failed to concat voice speaker segments scheme=${sourceUri.scheme}", error)
                    throw IllegalArgumentException(context.getString(R.string.rd_audio_extract_failed), error)
                }.getOrThrow()

                // 파일이 실제로 만들어졌는지(빈 출력 아님)만 검증하고, 신고 길이는 세그먼트 합을 쓴다.
                // 헤더 없는 MP3 는 추출기 길이 추정이 어긋날 수 있어 accMillis 가 더 정확하다.
                val outDuration = if (target.exists()) readDurationMillis(target.toUri()) else null
                if (outDuration == null || outDuration <= 0L || target.length() < 4 * 1024) {
                    runCatching { target.delete() }
                    throw IllegalArgumentException(context.getString(R.string.rd_audio_extract_failed))
                }
                CachedAlarmAudio(
                    localAudioUri = target.toUri().toString(),
                    rawAudioUri = sourceUri.toString(),
                    displayName = displayName,
                    durationMillis = accMillis,
                    cacheKey = cacheKey,
                    messageId = null,
                )
            }
        } finally {
            lock.unlock()
            releaseCacheKeyLockIfUnused(cacheKey, lock)
        }
    }

    private fun concatSegments(
        sourceUri: Uri,
        target: File,
        segments: List<Pair<Long, Long>>,
        forceMp3: Boolean,
    ) {
        if (forceMp3 || isMp3Mime(audioTrackMime(sourceUri))) {
            concatSegmentsMp3(sourceUri, target, segments)
        } else {
            concatSegmentsMp4(sourceUri, target, segments)
        }
    }

    /**
     * MP3: 구간별 프레임 바이트를 그대로 이어 쓴다(재인코딩 없음). MP3 프레임은 대체로 독립적이나
     * bit reservoir 로 앞 프레임을 참조할 수 있어 경계 프레임에 미세 글리치가 남을 수 있다 —
     * 클론 소스(음색 추출)로는 무시할 수준이라 그대로 둔다.
     */
    private fun concatSegmentsMp3(sourceUri: Uri, target: File, segments: List<Pair<Long, Long>>) {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(context, sourceUri, null)
            val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: error("No audio track found.")
            extractor.selectTrack(trackIndex)
            val inputFormat = extractor.getTrackFormat(trackIndex)
            val maxInputSize = (
                if (inputFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    inputFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
                } else {
                    256 * 1024
                }
                ).coerceAtLeast(64 * 1024)
            val buffer = ByteBuffer.allocate(maxInputSize)
            target.outputStream().use { output ->
                for ((startMs, endMs) in segments) {
                    val startUs = startMs * 1_000
                    val endUs = endMs * 1_000
                    extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                    while (true) {
                        val sampleTimeUs = extractor.sampleTime
                        if (sampleTimeUs < 0 || sampleTimeUs >= endUs) break
                        // closest-sync 가 구간 시작보다 앞 프레임에 착지하면 그 선행(=다른 화자/침묵)
                        // 프레임은 버려 경계 혼입을 줄인다.
                        if (sampleTimeUs < startUs) {
                            extractor.advance()
                            continue
                        }
                        buffer.clear()
                        val sampleSize = extractor.readSampleData(buffer, 0)
                        if (sampleSize < 0) break
                        output.write(buffer.array(), 0, sampleSize)
                        extractor.advance()
                    }
                }
            }
        } finally {
            extractor.release()
        }
    }

    /** MP4/AAC 등: MediaMuxer 로 구간별 샘플을 이어붙이되, 출력 PTS 를 누적해 연속 증가시킨다. */
    private fun concatSegmentsMp4(sourceUri: Uri, target: File, segments: List<Pair<Long, Long>>) {
        val extractor = MediaExtractor()
        val muxer = MediaMuxer(target.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        try {
            extractor.setDataSource(context, sourceUri, null)
            val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: error("No audio track found.")
            extractor.selectTrack(trackIndex)
            val inputFormat = extractor.getTrackFormat(trackIndex)
            val outputTrackIndex = muxer.addTrack(inputFormat)
            val maxInputSize = (
                if (inputFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    inputFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
                } else {
                    256 * 1024
                }
                ).coerceAtLeast(64 * 1024)
            val buffer = ByteBuffer.allocate(maxInputSize)
            val bufferInfo = MediaCodec.BufferInfo()
            muxer.start()
            // 이어붙일 출력 타임라인의 현재 위치. 각 구간을 이 위치부터 다시 0 기준으로 얹는다.
            var outputBaseUs = 0L
            for ((startMs, endMs) in segments) {
                val startUs = startMs * 1_000
                val endUs = endMs * 1_000
                extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                // closest-sync 가 구간 시작보다 앞이면 선행(=다른 화자/침묵) 프레임을 버려 경계 혼입을 줄인다.
                while (extractor.sampleTime in 0 until startUs) extractor.advance()
                val segAnchorUs = extractor.sampleTime.takeIf { it >= 0L } ?: startUs
                var lastRelUs = 0L
                var wroteAny = false
                while (true) {
                    val sampleTimeUs = extractor.sampleTime
                    if (sampleTimeUs < 0 || sampleTimeUs >= endUs) break
                    buffer.clear()
                    val sampleSize = extractor.readSampleData(buffer, 0)
                    if (sampleSize < 0) break
                    val relUs = (sampleTimeUs - segAnchorUs).coerceAtLeast(0L)
                    bufferInfo.set(0, sampleSize, outputBaseUs + relUs, codecBufferFlags(extractor.sampleFlags))
                    muxer.writeSampleData(outputTrackIndex, buffer, bufferInfo)
                    lastRelUs = relUs
                    wroteAny = true
                    extractor.advance()
                }
                // 다음 구간 첫 샘플 PTS 가 이전 구간 마지막과 같아지지 않도록 한 프레임(~23ms)만큼 벌린다.
                if (wroteAny) outputBaseUs += lastRelUs + 23_000L
            }
        } finally {
            runCatching { muxer.stop() }
            muxer.release()
            extractor.release()
        }
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

    /**
     * 오래 손대지 않은 캐시 음성 파일을 정리한다.
     * 같은 캐시 파일을 여러 알람이 공유할 수 있으므로, 호출자가 DB 에서 모은
     * [inUseFileNames](확장자 제외 파일명) 에 포함된 파일은 건너뛴다.
     * 메타(.meta) 파일은 본 파일과 이름이 같아 함께 정리된다.
     *
     * @return 삭제한 파일 수
     */
    fun sweepStaleCache(
        inUseFileNames: Set<String>,
        maxAgeMillis: Long = STALE_CACHE_MAX_AGE_MILLIS,
        nowMillis: Long = System.currentTimeMillis(),
    ): Int {
        val cutoffMillis = nowMillis - maxAgeMillis
        var deleted = 0
        audioDir.listFiles()?.forEach { file ->
            if (!file.isFile) return@forEach
            if (file.nameWithoutExtension in inUseFileNames) return@forEach
            val lastModified = file.lastModified()
            if (lastModified <= 0L || lastModified >= cutoffMillis) return@forEach
            if (file.delete()) {
                deleted += 1
                Log.i(TAG, "Swept stale alarm audio cache path=${file.absolutePath} lastModified=$lastModified")
            } else {
                Log.w(TAG, "Failed to sweep stale alarm audio cache path=${file.absolutePath}")
            }
        }
        if (deleted > 0) {
            Log.i(TAG, "Stale alarm audio cache sweep complete deleted=$deleted")
        }
        return deleted
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
        toleranceMillis: Long = DURATION_METADATA_TOLERANCE_MILLIS,
    ): Long? {
        requireWithinLimit(durationMillis, maxDurationMillis, toleranceMillis)
        return durationMillis?.coerceAtMost(maxDurationMillis)
    }

    private fun requireWithinLimit(
        durationMillis: Long?,
        maxDurationMillis: Long = AlarmAudioLimits.MAX_DURATION_MILLIS,
        toleranceMillis: Long = DURATION_METADATA_TOLERANCE_MILLIS,
    ) {
        val toleratedLimit = maxDurationMillis + toleranceMillis
        require(durationMillis == null || durationMillis <= toleratedLimit) {
            "Voice audio must be ${maxDurationMillis / 1000} seconds or shorter."
        }
    }

    private fun toleranceForLimit(maxDurationMillis: Long): Long =
        if (maxDurationMillis >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS) {
            VoiceProfileAudioLimits.MAX_DURATION_TOLERANCE_MILLIS
        } else {
            DURATION_METADATA_TOLERANCE_MILLIS
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
                val requestedStartUs = startMillis * 1_000
                extractor.seekTo(requestedStartUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                val trimStartUs = extractor.sampleTime.takeIf { it >= 0L } ?: requestedStartUs
                val endUs = trimStartUs + maxDurationMillis * 1_000

                while (true) {
                    val sampleTimeUs = extractor.sampleTime
                    if (sampleTimeUs < 0 || sampleTimeUs >= endUs) break
                    buffer.clear()
                    val sampleSize = extractor.readSampleData(buffer, 0)
                    if (sampleSize < 0) break
                    bufferInfo.set(
                        0,
                        sampleSize,
                        (sampleTimeUs - trimStartUs).coerceAtLeast(0L),
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
            // 사용자가 고른 미디어 URI(content://…)는 파일명·로컬 식별자가 담겨 PII 소지 —
            // 전체 URI 는 Logcat 에만 남기고 Sentry 로 가는 메시지에는 scheme 만 포함한다.
            Log.e(TAG, "Failed to trim selected voice audio uri=$sourceUri", error)
            AlarmTalkLog.reportError("Failed to trim selected voice audio scheme=${sourceUri.scheme}", error)
            throw IllegalArgumentException(context.getString(R.string.rd_audio_over_limit_trim_failed, maxDurationMillis / 1000), error)
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
                val requestedStartUs = startMillis * 1_000
                extractor.seekTo(requestedStartUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                val trimStartUs = extractor.sampleTime.takeIf { it >= 0L } ?: requestedStartUs
                val endUs = trimStartUs + maxDurationMillis * 1_000

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
            // 위 trimMp4 와 동일 — 전체 URI 는 Logcat 전용, Sentry 메시지는 scheme 만.
            Log.e(TAG, "Failed to trim selected mp3 voice audio uri=$sourceUri", error)
            AlarmTalkLog.reportError("Failed to trim selected mp3 voice audio scheme=${sourceUri.scheme}", error)
            throw IllegalArgumentException(context.getString(R.string.rd_audio_mp3_trim_failed), error)
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
        val totalFrames = safeSampleRate * durationMillis / 1_000L
        val sampleStrideFrames = (totalFrames / (sums.size * WAVEFORM_TARGET_SAMPLES_PER_BIN))
            .coerceAtLeast(1L)
            .coerceAtMost(WAVEFORM_MAX_SAMPLE_STRIDE_FRAMES)
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

            val skipFrames = (sampleStrideFrames - 1L)
                .coerceAtMost(buffer.remaining() / bytesPerFrame.toLong())
            if (skipFrames > 0L) {
                buffer.position(buffer.position() + (skipFrames * bytesPerFrame).toInt())
            }
            frameIndex += skipFrames + 1L
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

        /** 이 기간 이상 손대지 않은(미참조) 캐시 파일은 앱 시작 시 백그라운드 sweep 으로 정리한다. */
        const val STALE_CACHE_MAX_AGE_MILLIS: Long = 30L * 24 * 60 * 60 * 1_000
        private const val DURATION_METADATA_TOLERANCE_MILLIS = 750L
        private const val DECODE_TIMEOUT_US = 10_000L
        private const val MAX_IDLE_OUTPUT_DEQUEUE_COUNT = 20
        private const val PCM_16BIT_MAX_LEVEL = 32768.0
        private const val WAVEFORM_TARGET_SAMPLES_PER_BIN = 180L
        private const val WAVEFORM_MAX_SAMPLE_STRIDE_FRAMES = 2_048L

        // cacheKey 별 in-flight 작업 중복 방지용 lock.
        // 프로세스 전역으로 공유하지 않으면 같은 입력에 대해 두 번 호출 시 두 번째가 첫 번째와
        // 동시에 trim/copy 를 수행해 캐시 파일을 덮어쓸 수 있다.
        private val cacheKeyLocks = ConcurrentHashMap<String, ReentrantLock>()

        private fun cacheKeyLock(cacheKey: String): ReentrantLock =
            cacheKeyLocks.computeIfAbsent(cacheKey) { ReentrantLock() }

        private fun releaseCacheKeyLockIfUnused(cacheKey: String, lock: ReentrantLock) {
            // hold 중인 호출은 위 withLock 안에서 unlock 된 직후이며,
            // 다른 호출이 lock 을 잡고 있다면 isLocked 가 true 이므로 그대로 둔다.
            if (lock.tryLock()) {
                try {
                    if (!lock.hasQueuedThreads()) {
                // 동일 키로 새 호출이 막 들어왔을 가능성을 고려, atomic remove 만 시도.
                        cacheKeyLocks.remove(cacheKey, lock)
                    }
                } finally {
                    lock.unlock()
                }
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

/**
 * 캐시 음성 파일을 다른 알람이 더 이상 참조하지 않을 때만 삭제한다.
 * 같은 cacheKey 파일을 여러 알람이 공유할 수 있으므로(중복 시각 알람 교체, 알람 복사 등)
 * DB 참조 카운트가 0 일 때만 실제 파일을 지운다.
 */
internal suspend fun AlarmAudioStore.deleteCachedAudioIfUnreferenced(
    alarmDao: AlarmDao,
    cacheKey: String?,
) {
    if (cacheKey.isNullOrBlank()) return
    if (alarmDao.countByAudioCacheKey(cacheKey) > 0) return
    deleteCachedAudio(cacheKey)
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
