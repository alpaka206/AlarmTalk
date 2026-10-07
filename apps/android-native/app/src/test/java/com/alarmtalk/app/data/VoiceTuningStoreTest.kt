package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 목소리 높이 보정값과 높이를 바꾼 사본이 **지워져야 할 때 지워지는지**(스펙 voice-and-message §4-3).
 * 사본은 사용자 목소리의 복사본이라, 원본을 지우는 때 같이 사라져야 한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceTuningStoreTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val copies = File(context.noBackupFilesDir, "voice_tuning")

    @After
    fun tearDown() {
        copies.deleteRecursively()
    }

    @Test
    fun `값은 계정과 목소리마다 따로 저장되고 0 은 적지 않는다`() {
        val store = VoiceTuningStore(context)
        store.write("user-a", "voice-1", VoiceTuning(pitchSemitones = -3f, source = VoiceTuning.SOURCE_MANUAL))

        assertEquals(-3f, store.read("user-a", "voice-1")!!.pitchSemitones, 0f)
        assertNull(store.read("user-b", "voice-1"))
        assertNull(store.read("user-a", "voice-2"))

        store.write("user-a", "voice-1", VoiceTuning.NEUTRAL)
        assertNull("0 은 키를 지운다 — '없음' 과 '0' 이 한 상태다", store.read("user-a", "voice-1"))
    }

    @Test
    fun `목소리를 지우면 그 목소리 값만 사라진다`() {
        val store = VoiceTuningStore(context)
        store.write("user-a", "voice-1", VoiceTuning(pitchSemitones = -2f))
        store.write("user-a", "voice-2", VoiceTuning(pitchSemitones = 1.5f))

        store.remove("user-a", "voice-1")

        assertNull(store.read("user-a", "voice-1"))
        assertEquals(1.5f, store.read("user-a", "voice-2")!!.pitchSemitones, 0f)
    }

    @Test
    fun `로그아웃하면 그 계정 값만 모두 사라진다`() {
        val store = VoiceTuningStore(context)
        store.write("user-a", "voice-1", VoiceTuning(pitchSemitones = -2f))
        store.write("user-a", "voice-2", VoiceTuning(pitchSemitones = -1f))
        store.write("user-ab", "voice-3", VoiceTuning(pitchSemitones = -4f))

        store.clearUser("user-a")

        assertNull(store.read("user-a", "voice-1"))
        assertNull(store.read("user-a", "voice-2"))
        // 접두가 겹치는 다른 계정('user-ab')은 건드리지 않는다.
        assertEquals(-4f, store.read("user-ab", "voice-3")!!.pitchSemitones, 0f)
    }

    /** 다른 기기의 제자리 교체(새 세대)는 옛 녹음 기준 값을 지우고, 같은 세대로 고른 값은 남긴다(Codex #870). */
    @Test
    fun `새 교체 세대를 보면 옛 값만 지운다`() {
        val store = VoiceTuningStore(context)
        store.write("user-a", "voice-1", VoiceTuning(pitchSemitones = -2f, generation = "g1"))

        store.forgetIfReplaced("user-a", "voice-1", "g1")
        assertEquals("같은 세대 — 이 기기에서 교체하며 고른 값", -2f, store.read("user-a", "voice-1")!!.pitchSemitones, 0f)

        store.forgetIfReplaced("user-a", "voice-1", "g2")
        assertNull("다른 기기에서 다시 교체했다 — 옛 녹음 기준 값", store.read("user-a", "voice-1"))

        store.write("user-a", "voice-2", VoiceTuning(pitchSemitones = 1f))
        store.forgetIfReplaced("user-a", "voice-2", "g1")
        assertNull("교체 전에 처음 등록하며 저장한 값도 첫 교체에서 지운다", store.read("user-a", "voice-2"))
    }

    /** 표식 저장소가 새 세대를 반영할 때 함께 지운다 — 이미 반영한 세대(늦게 온 푸시)는 건드리지 않는다. */
    @Test
    fun `교체 표식이 새 세대를 반영하면 높이 값이 지워진다`() = kotlinx.coroutines.runBlocking {
        val tuning = VoiceTuningStore(context)
        val markers = VoiceReplacementMarkerStore(context)
        tuning.write("user-m", "voice-m", VoiceTuning(pitchSemitones = -3f, generation = "2026-10-01 00:00:00"))

        markers.applyIfNotApplied("user-m", "voice-m", "2026-10-07 00:00:00") { 0 }
        assertNull(tuning.read("user-m", "voice-m"))

        // 이 기기에서 교체하며 고른 값(같은 세대)은 뒤늦은 같은 세대 신호가 지우지 않는다.
        tuning.write("user-m", "voice-m", VoiceTuning(pitchSemitones = -1f, generation = "2026-10-08 00:00:00"))
        markers.applyIfNotApplied("user-m", "voice-m", "2026-10-08 00:00:00") { 0 }
        assertEquals(-1f, tuning.read("user-m", "voice-m")!!.pitchSemitones, 0f)
    }

    @Test
    fun `사본은 통째로 지울 수 있다`() {
        copies.mkdirs()
        File(copies, "abc_m3_0.wav").writeBytes(ByteArray(64))
        File(copies, "def_p1_5.wav").writeBytes(ByteArray(64))

        VoiceTuningRenderer.clearAll(context)

        assertFalse(copies.exists())
    }

    @Test
    fun `앱 시작 정리는 오래 쓰이지 않은 사본과 남은 임시 파일만 지운다`() {
        copies.mkdirs()
        val now = 1_800_000_000_000L
        val day = 24L * 60 * 60 * 1000
        val fresh = File(copies, "fresh_m3_0.wav").apply { writeBytes(ByteArray(64)); setLastModified(now - 2 * day) }
        val stale = File(copies, "stale_m3_0.wav").apply { writeBytes(ByteArray(64)); setLastModified(now - 31 * day) }
        val oldTmp = File(copies, "x.wav.tmp").apply { writeBytes(ByteArray(8)); setLastModified(now - 2 * 60 * 60 * 1000) }
        val newTmp = File(copies, "y.wav.tmp").apply { writeBytes(ByteArray(8)); setLastModified(now - 60 * 1000) }

        VoiceTuningRenderer.pruneStale(context, nowMillis = now)

        assertTrue(fresh.exists())
        assertFalse(stale.exists())
        assertFalse(oldTmp.exists())
        assertTrue("굽는 중일 수 있는 임시 파일은 남긴다", newTmp.exists())
    }
}
