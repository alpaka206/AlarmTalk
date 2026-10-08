package com.alarmtalk.app.data

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 높이를 바꾼 등록 미리듣기는 **메모리에서** 굽고 튼다 — 파일을 남기지 않는다(스펙 voice-and-message §4-3).
 * WAV 묶기와 `MediaPlayer` 에 넘기는 데이터 소스, 굽지 않는 갈래를 고정한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceTuningRendererTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun wavBytesAreSixteenBitMonoPcm() {
        val wav = VoiceTuningRenderer.wavBytes(floatArrayOf(0f, 0.5f, -1f, 2f), 24_000)
        assertEquals(44 + 8, wav.size)
        val le = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(wav, 0, 4, Charsets.US_ASCII))
        assertEquals(36 + 8, le.getInt(4))
        assertEquals("WAVE", String(wav, 8, 4, Charsets.US_ASCII))
        assertEquals("fmt ", String(wav, 12, 4, Charsets.US_ASCII))
        assertEquals(16, le.getInt(16))
        assertEquals("PCM", 1.toShort(), le.getShort(20))
        assertEquals("모노", 1.toShort(), le.getShort(22))
        assertEquals(24_000, le.getInt(24))
        assertEquals("초당 바이트", 48_000, le.getInt(28))
        assertEquals(2.toShort(), le.getShort(32))
        assertEquals(16.toShort(), le.getShort(34))
        assertEquals("data", String(wav, 36, 4, Charsets.US_ASCII))
        assertEquals(8, le.getInt(40))
        // 표본은 −1…1 로 자른 뒤 32767 을 곱한다.
        assertEquals(0.toShort(), le.getShort(44))
        assertEquals(16383.toShort(), le.getShort(46))
        assertEquals((-32767).toShort(), le.getShort(48))
        assertEquals(32767.toShort(), le.getShort(50))
    }

    @Test
    fun inMemorySourceReadsLikeAFile() {
        val source = InMemoryAudioDataSource(ByteArray(10) { it.toByte() })
        assertEquals(10L, source.size)
        val buffer = ByteArray(8)
        // 끝에 걸치면 남은 만큼만 읽는다.
        assertEquals(4, source.readAt(6, buffer, 2, 6))
        assertArrayEquals(byteArrayOf(0, 0, 6, 7, 8, 9, 0, 0), buffer)
        assertEquals("끝", -1, source.readAt(10, buffer, 0, 4))
        assertEquals(0, source.readAt(0, buffer, 0, 0))
    }

    /** 0 은 원래 클립을 그대로 튼다 — 풀지도 굽지도 않는다. */
    @Test
    fun zeroPitchIsNotBaked() {
        assertNull(VoiceTuningRenderer.render(context, Uri.EMPTY, 0f))
    }

    /** 굽기에 실패하면 null — 부르는 쪽이 원래 소리를 튼다(그때 들은 높이는 0). */
    @Test
    fun undecodableSourceIsNotBaked() {
        val missing = Uri.fromFile(File(context.cacheDir, "missing-preview.mp3"))
        assertNull(VoiceTuningRenderer.render(context, missing, -2f))
    }
}
