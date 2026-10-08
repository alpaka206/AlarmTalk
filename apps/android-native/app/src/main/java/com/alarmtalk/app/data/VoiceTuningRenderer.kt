package com.alarmtalk.app.data

import android.content.Context
import android.media.MediaDataSource
import android.net.Uri
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 등록 미리듣기의 **높이를 바꾼 소리**를 메모리에서 굽는다 — 16-bit 모노 WAV 바이트([render]).
 *
 * 서버가 준 초안 미리듣기(원래 소리 — 초안에는 높이가 없다)를 풀어(`VoiceAudioDecoder`) 높이만 옮기고
 * (`VoicePitchShifter`) WAV 로 묶는다. 틀 때는 [InMemoryAudioDataSource] 로 `MediaPlayer` 에 바로 넘긴다.
 *
 * ⚠ **파일로 남기지 않는다**(스펙 voice-and-message §4-3). 사본을 쓰면 사용자 목소리의 복사본이 하나 더 생겨
 *   목소리 삭제·동의 철회·로그아웃마다 따라 지워야 한다 — 기기마다 알람용 사본을 굽던 예전 설계(#870)가 그 수명
 *   관리만으로 리뷰를 스무 회차 넘겼다.
 * ⚠ **알람 소리는 여기서 굽지 않는다.** 서버가 등록 때 받은 높이로 그 목소리의 모든 알람 소리를 굽는다 — 앱이
 *   또 걸면 두 번 걸린다.
 *
 * ⚠ 디코딩·변환이 수백 ms 걸린다 — **메인 스레드에서 부르지 말 것.** 실패하면 null 이고, 부르는 쪽은
 * 원래 소리를 튼다(그때 들은 높이는 0 이다).
 */
object VoiceTuningRenderer {
    private const val TAG = "VoiceTuningRenderer"

    /** 이보다 긴 소리는 앞부분만 굽는다 — 미리듣기는 한 문장이라 닿지 않는다. 메모리를 묶어 두는 상한이다. */
    private const val MAX_DURATION_MILLIS = 120_000L
    private const val WAV_HEADER_BYTES = 44

    /** [source] 의 높이를 [pitchSemitones] 반음 옮긴 16-bit 모노 WAV. 0 이거나 실패하면 null. */
    fun render(context: Context, source: Uri, pitchSemitones: Float): ByteArray? {
        if (pitchSemitones == 0f) return null
        return runCatching {
            val started = System.nanoTime()
            val decoded = VoiceAudioDecoder.decodeMono(context, source, maxDurationMillis = MAX_DURATION_MILLIS)
                ?: error("decode failed")
            val shifted = VoicePitchShifter.shift(decoded.samples, decoded.sampleRate, pitchSemitones)
            val wav = wavBytes(shifted, decoded.sampleRate)
            Log.i(
                TAG,
                "Rendered pitch=$pitchSemitones st ${shifted.size / decoded.sampleRate.toFloat()}s " +
                    "in ${(System.nanoTime() - started) / 1_000_000}ms",
            )
            wav
        }.onFailure { error ->
            Log.w(TAG, "Failed to render voice tuning pitch=$pitchSemitones", error)
        }.getOrNull()
    }

    /** 16-bit 모노 PCM WAV(머리말 44바이트 + 표본). 표본은 −1…1 로 자른 뒤 32767 을 곱한다. */
    internal fun wavBytes(samples: FloatArray, sampleRate: Int): ByteArray {
        val dataBytes = samples.size * 2
        val buffer = ByteBuffer.allocate(WAV_HEADER_BYTES + dataBytes).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray(Charsets.US_ASCII)).putInt(36 + dataBytes)
            .put("WAVE".toByteArray(Charsets.US_ASCII))
        buffer.put("fmt ".toByteArray(Charsets.US_ASCII)).putInt(16).putShort(1).putShort(1)
            .putInt(sampleRate).putInt(sampleRate * 2).putShort(2).putShort(16)
        buffer.put("data".toByteArray(Charsets.US_ASCII)).putInt(dataBytes)
        for (v in samples) buffer.putShort((v.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
        return buffer.array()
    }
}

/**
 * 메모리의 바이트를 `MediaPlayer.setDataSource(MediaDataSource)` 로 넘긴다 — 높이를 바꾼 미리듣기를 파일 없이
 * 튼다([VoiceTuningRenderer]). 바이트를 바꾸지 않으므로 플레이어의 읽기 스레드에서 불려도 안전하다.
 */
class InMemoryAudioDataSource(private val bytes: ByteArray) : MediaDataSource() {
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (position < 0 || position >= bytes.size) return -1
        if (size <= 0) return 0
        val count = minOf(size.toLong(), bytes.size - position).toInt()
        System.arraycopy(bytes, position.toInt(), buffer, offset, count)
        return count
    }

    override fun getSize(): Long = bytes.size.toLong()

    override fun close() = Unit
}
