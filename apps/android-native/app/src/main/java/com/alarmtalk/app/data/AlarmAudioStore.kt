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
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.Locale
import java.util.Properties
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantLock

object AlarmAudioLimits {
    const val MAX_DURATION_MILLIS = 30_000L
}

object VoiceProfileAudioLimits {
    // 백엔드 voice-profile.ts 의 MIN/MAX_CLONE_DURATION_MS 와 같은 값을 유지한다.
    // 최소 12초: 예전에는 1분을 요구했는데 채우기가 부담이라는 제보가 많았다. 길수록 클론이
    // 더 비슷해지는 건 맞지만 그건 안내로 유도할 일이지 등록을 막을 일이 아니다.
    const val MIN_DURATION_MILLIS = 12_000L
    const val MAX_DURATION_MILLIS = 120_000L
    const val MAX_DURATION_TOLERANCE_MILLIS = 5_000L
}

/** [AlarmAudioStore.resolveTtsInput] 결과 — 재사용할 오디오 키와 그 오디오의 표시 문구. */
data class TtsInputAlias(
    val cacheKey: String,
    val displayText: String,
)

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
        // 업로드 화이트리스트 밖 컨테이너(FLAC/WebM/OPUS 등 낯선 확장자)는 그대로 올리면
        // octet-stream 으로 나가 백엔드가 거절한다 — 항상 트랜스코드 경로로 보내 m4a 로 정규화한다.
        val unknownUploadContainer = extension.lowercase(Locale.US) !in UPLOAD_AUDIO_MIME_BY_EXTENSION
        val needsTrim = forceExtractAudio || resolvedStartMillis > 0 || durationMillis > maxDurationMillis ||
            unknownUploadContainer
        Log.i(
            TAG,
            "cacheFromUri source=$sourceUri sourceMime=$sourceMimeType trackMime=$trackMimeType ext=$extension duration=$durationMillis max=$maxDurationMillis start=$resolvedStartMillis needsTrim=$needsTrim unknownContainer=$unknownUploadContainer trimAsMp3=$trimAsMp3",
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
        // 같은 클립을 두 경로가 동시에 받을 수 있다(프리페치 워커 ↔ 편집기/수신 동기화).
        // 키별 lock 이 없으면 한쪽이 staging 을 rename 하는 사이 다른 쪽이 같은 staging 을
        // 건드려, 늦은 쪽이 target 이 이미 있는데도 IOException 으로 실패한다 —
        // 편집기에서는 알람 저장 실패로, 동기화에서는 음성 없는 수신 알람으로 나타난다.
        val lock = cacheKeyLock(resolvedCacheKey)
        lock.lock()
        return try {
            cacheGeneratedAudioLocked(
                bytes = bytes,
                extension = extension,
                resolvedCacheKey = resolvedCacheKey,
                rawAudioUri = rawAudioUri,
                messageId = messageId,
            )
        } finally {
            lock.unlock()
            releaseCacheKeyLockIfUnused(resolvedCacheKey, lock)
        }
    }

    private fun cacheGeneratedAudioLocked(
        bytes: ByteArray,
        extension: String,
        resolvedCacheKey: String,
        rawAudioUri: String?,
        messageId: String?,
    ): CachedAlarmAudio {
        require(bytes.isNotEmpty()) { "Voice audio must not be empty." }
        val existing = findCachedFile(resolvedCacheKey)
        // ⚠ **세대 표식이 없는 옛 캐시는 여기서 갈아 끼운다**(Codex #703 P1). 이미 바이트를
        // 받아 온 자리라 다시 받는 비용이 없고, 이때 `rawAudioUri` 를 적어 두지 않으면
        // 새로고침이 같은 키를 **매번 다시 고르고 매번 건너뛴다**(영원한 루프).
        val stale = existing != null &&
            (cachedAudioIsStale(resolvedCacheKey, rawAudioUri) ||
                cachedAudioNeedsRevisionRefresh(resolvedCacheKey, rawAudioUri))
        if (existing != null && !stale) {
            val cached = existing
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
        // stale 교체도 기존 경로를 유지한다. DB/예약이 localAudioUri를 들고 있어 새 확장자
        // 경로로 바꾸면 파일을 잘 받아 놓고도 옛 경로를 재생하게 된다.
        val target = existing ?: File(audioDir, "${safeCacheKey(resolvedCacheKey)}.$extension")
        // 임시 파일에 쓴 뒤 rename 한다. 곧바로 target 에 쓰면 쓰기 도중 프로세스가 죽었을 때
        // '잘린 mp3'가 남고, findCachedFile 은 파일 존재만 보므로 이후 다운로드가 그 클립을
        // 영원히 건너뛴다 -> 그 알람은 무음이 된다. rename 은 같은 파일시스템에서 원자적이라
        // 완성된 파일만 target 이름을 갖는다.
        // staging 이름에 호출별 접미사를 붙인다. 키별 lock 이 이미 직렬화하지만, 다른
        // 프로세스(워커는 별도 프로세스일 수 있다)까지 막지는 못하므로 파일 이름 자체를
        // 겹치지 않게 둔다. 스윕은 확장자만 보고 지우므로 접미사가 붙어도 정리된다.
        val staging = File(
            audioDir,
            "${safeCacheKey(resolvedCacheKey)}.$extension.${System.nanoTime()}.$PARTIAL_EXTENSION",
        )
        staging.writeBytes(bytes)
        val durationMillis = readDurationMillis(staging.toUri())
        requireWithinLimit(durationMillis)
        try {
            try {
                Files.move(
                    staging.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(staging.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        } catch (error: Exception) {
            staging.delete()
            throw java.io.IOException("Failed to finalize cached audio: ${target.name}", error)
        }
        writeMetadata(
            cacheKey = resolvedCacheKey,
            rawAudioUri = rawAudioUri,
            messageId = messageId,
        )
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
        if (cachedAudioIsStale(cacheKey, rawAudioUri)) {
            return null
        }
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

    fun isCachedAudioStale(cacheKey: String, incomingRawAudioUri: String?): Boolean =
        cachedAudioIsStale(cacheKey, incomingRawAudioUri)

    /**
     * **세대 표식이 아예 없는 옛 캐시인가**(Codex #703 P1).
     *
     * 낡음 판정은 `audio_url` 비교 하나인데, `rawAudioUri` 를 적기 **전에** 받아 둔 캐시는
     * 비교할 값이 없어 [cachedAudioIsStale] 이 늘 false 를 준다 — 제자리 목소리 교체가
     * 일어나도 그 프리셋만 **영영 다시 받지 않고**, 알람이 회수된 옛 목소리로 계속 운다.
     *
     * ⚠ **[cachedAudioIsStale] 을 고치지 않는 이유**: 그 판정은 재생 경로도 본다.
     * "모르면 낡지 않았다" 를 뒤집으면 알람마다 네트워크를 타고 **오프라인에서는 아예 못
     * 쓴다**(그게 그 규칙의 존재 이유다). 그래서 **새로고침 선택**에서만 이 값을 함께 보고,
     * 한 번 받아 두면 그때 표식이 적혀 다시 걸리지 않는다 — **한 번뿐인 보정**이다.
     */
    fun cachedAudioNeedsRevisionRefresh(cacheKey: String, incomingRawAudioUri: String?): Boolean {
        if (findCachedFile(cacheKey) == null) return false
        if (incomingRawAudioUri?.takeIf { it.isNotBlank() } == null) return false
        return readMetadata(cacheKey).rawAudioUri?.takeIf { it.isNotBlank() } == null
    }

    /** 같은 message ID라도 서버의 R2 주소가 바뀌면 제자리 목소리 교체로 게시된 새 음원이다. */
    private fun cachedAudioIsStale(cacheKey: String, incomingRawAudioUri: String?): Boolean {
        if (findCachedFile(cacheKey) == null) return false
        val incoming = incomingRawAudioUri?.takeIf { it.isNotBlank() } ?: return false
        val stored = readMetadata(cacheKey).rawAudioUri?.takeIf { it.isNotBlank() } ?: return false
        return stored != incoming
    }

    /**
     * "이 문구로 만든 음성이 이미 있다" 는 별칭을 남긴다.
     *
     * 오디오 파일 이름은 **서버가 준 cache_key** 다. 서버는 문구에 delivery 태그를 붙인 뒤
     * 그 결과로 키를 만들기 때문에, 앱은 요청을 보내기 전에는 그 키를 알 수 없다. 그래서
     * 사용자가 입력한 값으로 만든 [ttsInputKey] 에서 서버 키로 가는 화살표를 한 번 적어 둔다.
     * 다음에 똑같은 문구를 넣으면 서버를 부르지 않고 그 파일을 그대로 쓴다.
     *
     * [displayText] 도 함께 적는다 — **서버가 돌려준 표시 문구**다. 번역이 켜지면 이 값이
     * 입력 원문과 달라지는데(앱 언어 ≠ 입력 언어), 재사용 때 원문을 표시 문구로 쓰면
     * **잠금화면 문구와 실제 음성이 어긋난다**(Codex #660). 그래서 오디오와 짝이 되는 문구를
     * 같이 보관했다가 그대로 복원한다.
     *
     * 별칭은 오디오와 같은 `.meta` 사이드카를 쓴다(새 파일 형식을 만들지 않는다). 스윕이
     * 별칭을 지웠거나 오디오가 먼저 사라졌으면 조회가 null 이 되어 기존 서버 경로로 폴백한다 —
     * 최악의 경우가 '지금과 똑같음' 이다.
     */
    fun linkTtsInput(inputKey: String, serverCacheKey: String, displayText: String) {
        if (inputKey.isBlank() || serverCacheKey.isBlank() || inputKey == serverCacheKey) return
        if (displayText.isBlank()) return
        val props = Properties()
        props.setProperty(META_ALIAS_OF, serverCacheKey)
        props.setProperty(META_ALIAS_TEXT, displayText)
        runCatching {
            metadataFile(inputKey).outputStream().use { props.store(it, null) }
        }.onFailure { error ->
            Log.w(TAG, "Failed to link tts input key=$inputKey", error)
        }
    }

    /**
     * [linkTtsInput] 로 남긴 별칭. 없으면 null(= 서버에 새로 요청).
     *
     * 표시 문구가 없는 별칭은 **없는 것으로 취급한다.** 그 값 없이 재사용하면 번역된 오디오에
     * 원문을 붙이게 되므로, 한 번 더 생성하는 편이 낫다.
     */
    fun resolveTtsInput(inputKey: String): TtsInputAlias? {
        if (inputKey.isBlank()) return null
        val file = metadataFile(inputKey)
        if (!file.exists()) return null
        val props = Properties()
        return runCatching {
            file.inputStream().use { props.load(it) }
            val cacheKey = props.getProperty(META_ALIAS_OF)?.takeIf { it.isNotBlank() } ?: return null
            val displayText = props.getProperty(META_ALIAS_TEXT)?.takeIf { it.isNotBlank() } ?: return null
            TtsInputAlias(cacheKey = cacheKey, displayText = displayText)
        }.getOrNull()?.also {
            // 스윕 TTL 이 '최초 생성'이 아니라 '마지막 사용' 기준이 되게 만져 둔다.
            runCatching { file.setLastModified(System.currentTimeMillis()) }
        }
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
     * URI 가 가리키는 캐시 파일을 지운다 — **우리 캐시 디렉터리 안일 때만.**
     *
     * 캐시 키가 없어 [deleteCachedAudio] 로 지울 수 없는 옛 행을 위한 경로다. 디렉터리를
     * 확인하는 이유는 [localAudioUri] 가 언제나 우리 파일이라는 보장이 없어서다 —
     * 사용자가 고른 원본(`content://`, 공유 저장소)을 지우면 남의 파일을 지우는 것이다.
     * 메타(.meta) 사이드카는 이름이 같아 함께 지운다.
     */
    fun deleteCachedFileAt(localAudioUri: String) {
        val path = runCatching { Uri.parse(localAudioUri).path }.getOrNull() ?: return
        val file = File(path)
        val dir = audioDir
        val insideCacheDir = runCatching {
            file.parentFile?.canonicalPath == dir.canonicalPath
        }.getOrDefault(false)
        if (!insideCacheDir) {
            Log.i(TAG, "Skipped deleting audio outside cache dir path=$path")
            return
        }
        dir.listFiles()?.forEach { candidate ->
            if (candidate.isFile && candidate.nameWithoutExtension == file.nameWithoutExtension) {
                if (candidate.delete()) {
                    Log.i(TAG, "Deleted keyless cached audio path=${candidate.absolutePath}")
                } else {
                    Log.w(TAG, "Failed to delete keyless cached audio path=${candidate.absolutePath}")
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
            // 쓰다 만 잔재는 어떤 알람도 참조하지 않으니 TTL 을 기다리지 않고 정리한다
            // (다음 다운로드가 다시 받는다). 단 '지금 쓰고 있는' staging 까지 지우면 그 쪽
            // renameTo 가 실패해 프리페치나 알람 저장이 IOException("Failed to finalize
            // cached audio")으로 죽는다 — 앱 시작 스윕은 StockClipPrefetchWorker·편집기
            // 다운로드와 겹칠 수 있고, 워커는 별도 프로세스일 수 있어 키별 lock 으로도 못 막는다.
            // 한 클립 쓰기는 순식간에 끝나므로 그보다 한참 긴 유예를 넘긴 것만 잔재로 본다.
            if (file.extension == PARTIAL_EXTENSION) {
                val writtenAt = file.lastModified()
                if (writtenAt <= 0L || writtenAt >= nowMillis - PARTIAL_STALE_AFTER_MILLIS) return@forEach
                if (file.delete()) deleted += 1
                return@forEach
            }
            // 미리 받아둔 기본 목소리 클립은 어떤 알람도 참조하지 않으므로 in-use 집합에
            // 안 들어간다. 그대로 두면 TTL 이 지나 전부 삭제되고 오프라인 재생이 깨진다.
            if (file.nameWithoutExtension.startsWith(STOCK_CACHE_KEY_PREFIX)) return@forEach
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

    // 목소리 등록(2분 상한)만 프레임 경계 오차 5초를 허용한다. 알람용 짧은 오디오는
    // 메타데이터 오차만 본다. (상한으로 두 경로를 가른다 — 최소 길이로 가르면 최소값을
    // 낮추는 순간 알람 오디오까지 등록용 오차를 쓰게 된다.)
    private fun toleranceForLimit(maxDurationMillis: Long): Long =
        if (maxDurationMillis >= VoiceProfileAudioLimits.MAX_DURATION_MILLIS) {
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

    /**
     * 기기에 남아 있는 기본 목소리 클립 수.
     *
     * "다운로드를 마쳤는가"를 계정 플래그가 아니라 **파일 존재**로 판정하기 위한 것이다.
     * 캐시는 계정이 아니라 기기에 종속되므로: 로그아웃 후 다시 로그인하면 파일이 남아 있어
     * 다시 받지 않고, 다른 기기로 로그인하면 그 기기에는 파일이 없어 새로 받는다.
     */
    fun cachedStockClipCount(): Int =
        audioDir.listFiles()?.count { file ->
            file.isFile &&
                file.extension != META_EXTENSION &&
                file.extension != PARTIAL_EXTENSION &&
                file.nameWithoutExtension.startsWith(STOCK_CACHE_KEY_PREFIX)
        } ?: 0

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

        /** 입력키 → 서버 cache_key 별칭(`.meta` 안의 속성). [linkTtsInput] 참고. */
        private const val META_ALIAS_OF = "aliasOf"

        /** 그 오디오와 짝이 되는 **서버 표시 문구**. 번역이 켜지면 입력 원문과 달라진다. */
        private const val META_ALIAS_TEXT = "aliasText"

        /** 쓰기 도중 죽었을 때 남는 미완성 파일 확장자. sweep 이 [PARTIAL_STALE_AFTER_MILLIS] 뒤 정리한다. */
        private const val PARTIAL_EXTENSION = "part"

        /**
         * 이만큼 손대지 않은 .part 만 '쓰다 죽은 잔재'로 보고 스윕이 지운다.
         * 정상 쓰기는 버퍼 한 번 flush 라 순식간에 끝나므로, 진행 중인 staging 을 지워
         * renameTo 를 깨뜨리는 일이 없도록 넉넉히 잡은 값이다.
         */
        private const val PARTIAL_STALE_AFTER_MILLIS: Long = 60L * 60 * 1_000

        /**
         * 미리 내려받는 기본(시스템) 목소리 클립의 캐시 키 접두사.
         * 이 파일들은 특정 알람에 묶이지 않아 in-use 집합에 안 들어가므로 sweep 에서 제외한다.
         */
        const val STOCK_CACHE_KEY_PREFIX = "stock_"

        /** 같은 서버 message ID를 담을 수 있는 캐시 네임스페이스. 존재하는 stale 키만 갱신한다. */
        fun messageCacheKeys(messageId: String): List<String> = listOf(
            "$STOCK_CACHE_KEY_PREFIX$messageId",
            "remote-message-$messageId",
            "greeting_$messageId",
        )

        // 백엔드 /voice/clone 은 audio/* 접두 MIME 만 받는다(아니면 INVALID_AUDIO_MIME_TYPE).
        // 이 확장자들은 업로드 시 대응 audio/* 로 매핑되고(voiceUploadPart), 목록 밖 컨테이너는
        // cacheFromUri 가 m4a 로 트랜스코드해 application/octet-stream 거절을 막는다.
        val UPLOAD_AUDIO_MIME_BY_EXTENSION: Map<String, String> = mapOf(
            "m4a" to "audio/mp4",
            "mp4" to "audio/mp4",
            "aac" to "audio/mp4",
            "mp3" to "audio/mpeg",
            "wav" to "audio/wav",
            "ogg" to "audio/ogg",
            "flac" to "audio/flac",
            "webm" to "audio/webm",
            "opus" to "audio/opus",
            "3ga" to "audio/3gpp",
            "3gp" to "audio/3gpp",
            "amr" to "audio/amr",
        )

        /** 이 기간 이상 손대지 않은(미참조) 캐시 파일은 앱 시작 시 백그라운드 sweep 으로 정리한다. */
        const val STALE_CACHE_MAX_AGE_MILLIS: Long = 30L * 24 * 60 * 60 * 1_000
        private const val DURATION_METADATA_TOLERANCE_MILLIS = 750L

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

        /**
         * "사용자가 무엇을 입력했는가" 로 만드는 키. 파일 이름이 아니라 [linkTtsInput] 별칭의
         * 왼쪽에만 쓴다.
         *
         * 키에 반드시 들어가야 하는 것:
         *  - `userId` — 캐시는 기기에 남고 로그아웃해도 안 지워진다. 빼면 다른 계정이 앞 계정의
         *    message_id 를 물려받아 알람 동기화가 서버에서 거부된다.
         *  - `listenerTitle`(호칭) — 서버가 호칭을 문구 **안에** 병합하고, 공유 목소리는 보는
         *    사람마다 호칭이 다르다. 빼면 '엄마 목소리로 아빠 호칭' 이 나온다.
         *  - `language` — 번역 여부가 이 값으로 결정된다.
         */
        fun ttsInputKey(
            userId: String,
            profileId: String,
            text: String,
            category: String,
            language: String,
            listenerTitle: String?,
        ): String =
            sha256(
                listOf(
                    "tts-input-v1",
                    userId,
                    profileId,
                    text.trim().replace(Regex("\\s+"), " "),
                    category,
                    language,
                    listenerTitle?.trim().orEmpty(),
                ).joinToString("|"),
            )

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

/**
 * 캐시 키가 없어 [deleteCachedAudioIfUnreferenced] 로는 못 지우는 옛 행의 음성 파일을,
 * 다른 알람이 같은 URI 를 안 쓸 때만 지운다.
 *
 * 키가 있는 행에는 쓰지 말 것 — 같은 파일을 여러 URI 로 가리킬 수 있어 카운트가 어긋난다.
 * 여긴 '키가 없어서 참조를 셀 방법이 URI 뿐인' 경우의 최후 수단이다.
 */
internal suspend fun AlarmAudioStore.deleteLocalAudioIfUnreferenced(
    alarmDao: AlarmDao,
    localAudioUri: String?,
) {
    if (localAudioUri.isNullOrBlank()) return
    if (alarmDao.countByLocalAudioUri(localAudioUri) > 0) return
    deleteCachedFileAt(localAudioUri)
}

private data class CachedAudioMetadata(
    val rawAudioUri: String? = null,
    val messageId: String? = null,
)
