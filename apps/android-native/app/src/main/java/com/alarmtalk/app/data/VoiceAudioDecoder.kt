package com.alarmtalk.app.data

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder

/** 디코딩한 모노 PCM(−1..1). */
class DecodedAudio(val samples: FloatArray, val sampleRate: Int)

/**
 * 오디오 파일(녹음 m4a·TTS mp3 등)을 **모노 float PCM** 으로 푼다 — 목소리 보정 추천의 입력.
 * 메모리를 묶어 두려고 [maxDurationMillis] 까지만 읽는다. 실패하면 null(추천은 그 입력 없이 간다).
 */
object VoiceAudioDecoder {

    private const val TIMEOUT_US = 10_000L

    fun decodeMono(
        context: Context,
        uri: Uri,
        startMillis: Long = 0L,
        maxDurationMillis: Long = 45_000L,
    ): DecodedAudio? = runCatching { decode(context, uri, startMillis, maxDurationMillis) }.getOrNull()

    private fun decode(context: Context, uri: Uri, startMillis: Long, maxDurationMillis: Long): DecodedAudio? {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(context, uri, null)
            val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return null
            extractor.selectTrack(trackIndex)
            val inputFormat = extractor.getTrackFormat(trackIndex)
            val mime = inputFormat.getString(MediaFormat.KEY_MIME) ?: return null
            if (startMillis > 0) extractor.seekTo(startMillis * 1000, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            val endUs = startMillis * 1000 + maxDurationMillis * 1000

            val decoder = MediaCodec.createDecoderByType(mime)
            codec = decoder
            decoder.configure(inputFormat, null, null, 0)
            decoder.start()

            var sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
            var floatPcm = false
            val maxSamples = ((maxDurationMillis / 1000.0) * sampleRate.coerceAtLeast(8000) * 1.1).toInt() + 1
            var out = FloatArray(minOf(maxSamples, sampleRate * 10))
            var count = 0
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            // 디코더가 끝 표시를 끝내 안 내는 기기에서 영원히 돌지 않게 — 입력을 다 넣은 뒤 빈 응답이
            // 이만큼 이어지면 그만 읽는다(10 ms × 300 = 3초).
            var idleAfterInput = 0
            while (!outputDone) {
                if (!inputDone) {
                    val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
                    if (inIndex >= 0) {
                        val buffer = decoder.getInputBuffer(inIndex)!!
                        val size = extractor.readSampleData(buffer, 0)
                        if (size < 0 || extractor.sampleTime > endUs) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outIndex = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
                if (outIndex == MediaCodec.INFO_TRY_AGAIN_LATER && inputDone && ++idleAfterInput > 300) break
                when {
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val format = decoder.outputFormat
                        sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
                        floatPcm = format.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            format.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                    }
                    outIndex >= 0 -> {
                        val buffer = decoder.getOutputBuffer(outIndex)
                        if (buffer != null && info.size > 0 && info.presentationTimeUs >= startMillis * 1000) {
                            buffer.position(info.offset)
                            buffer.limit(info.offset + info.size)
                            buffer.order(ByteOrder.nativeOrder())
                            val frames = if (floatPcm) info.size / 4 / channels else info.size / 2 / channels
                            if (count + frames > out.size) {
                                out = out.copyOf(maxOf(out.size * 2, count + frames))
                            }
                            if (floatPcm) {
                                val floats = buffer.asFloatBuffer()
                                for (frame in 0 until frames) {
                                    var sum = 0f
                                    for (channel in 0 until channels) sum += floats.get()
                                    out[count++] = sum / channels
                                }
                            } else {
                                val shorts = buffer.asShortBuffer()
                                for (frame in 0 until frames) {
                                    var sum = 0f
                                    for (channel in 0 until channels) sum += shorts.get() / 32768f
                                    out[count++] = sum / channels
                                }
                            }
                        }
                        decoder.releaseOutputBuffer(outIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                        if (count >= (maxDurationMillis / 1000.0 * sampleRate).toInt()) outputDone = true
                    }
                }
            }
            if (count == 0) return null
            val limit = minOf(count, (maxDurationMillis / 1000.0 * sampleRate).toInt().coerceAtLeast(1))
            return DecodedAudio(out.copyOf(limit), sampleRate)
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            runCatching { extractor.release() }
        }
    }
}
