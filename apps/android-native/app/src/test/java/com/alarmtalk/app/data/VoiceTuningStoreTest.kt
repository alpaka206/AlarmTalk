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
    fun `원래 목소리가 사라지면 모든 계정의 그 목소리 값만 지운다`() {
        val store = VoiceTuningStore(context)
        store.write("user-a", "voice-gone", VoiceTuning(pitchSemitones = -2f))
        store.write("user-b", "voice-gone", VoiceTuning(pitchSemitones = -1f))
        store.write("user-a", "voice-kept", VoiceTuning(pitchSemitones = 1f))

        store.removeVoice("voice-gone")

        assertNull(store.read("user-a", "voice-gone"))
        assertNull(store.read("user-b", "voice-gone"))
        assertEquals(1f, store.read("user-a", "voice-kept")!!.pitchSemitones, 0f)
    }

    /** 권위 있는 목록으로 접근을 잃은 목소리의 값은 — 알람이 없어도 — 지운다(Codex #870). */
    @Test
    fun `접근을 잃은 목소리 값은 그 계정에서만 지운다`() {
        val store = VoiceTuningStore(context)
        store.write("user-a", "kept", VoiceTuning(pitchSemitones = -2f))
        store.write("user-a", "lost", VoiceTuning(pitchSemitones = -1f))
        store.write("user-b", "lost", VoiceTuning(pitchSemitones = -3f))

        assertTrue(store.retainOnly("user-a", setOf("kept")))
        assertEquals(-2f, store.read("user-a", "kept")!!.pitchSemitones, 0f)
        assertNull(store.read("user-a", "lost"))
        assertEquals("다른 계정은 그 계정의 목록으로만 판정한다", -3f, store.read("user-b", "lost")!!.pitchSemitones, 0f)
        assertFalse(store.retainOnly("user-a", setOf("kept")))
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
        copies.mkdirs()
        File(copies, "old_m3_0.wav").writeBytes(ByteArray(64))

        // 내릴 알람이 하나도 없어도(강등 0) 옛 목소리의 사본까지 지운다(Codex #870).
        markers.applyIfNotApplied("user-m", "voice-m", "2026-10-07 00:00:00") { 0 }
        assertNull(tuning.read("user-m", "voice-m"))
        assertFalse(copies.exists())

        // 이 기기에서 교체하며 고른 값(같은 세대)은 뒤늦은 같은 세대 신호가 지우지 않는다.
        tuning.write("user-m", "voice-m", VoiceTuning(pitchSemitones = -1f, generation = "2026-10-08 00:00:00"))
        markers.applyIfNotApplied("user-m", "voice-m", "2026-10-08 00:00:00") { 0 }
        assertEquals(-1f, tuning.read("user-m", "voice-m")!!.pitchSemitones, 0f)
    }

    /** 버린 초안의 미리듣기 클립처럼 **그 원본으로 구운 사본만** 지울 수 있다(Codex #870). */
    @Test
    fun `원본 하나의 사본만 지운다`() {
        val source = File(context.filesDir, "draft_preview.mp3").apply { writeBytes(ByteArray(128)) }
        val sourceUri = android.net.Uri.fromFile(source)
        copies.mkdirs()
        val prefix = VoiceTuningRenderer.cacheKey(sourceUri)
        val mine = listOf(File(copies, "${prefix}_m3_0.wav"), File(copies, "${prefix}_p1_5.wav"))
        val other = File(copies, "otherkey000_m3_0.wav")
        (mine + other).forEach { it.writeBytes(ByteArray(64)) }

        VoiceTuningRenderer.deleteCopiesOf(context, sourceUri)

        assertTrue(mine.none { it.exists() })
        assertTrue(other.exists())
        source.delete()
    }

    /** 지운 **뒤에** 끝난 굽기는 게시하지 않는다 — 원본 하나를 지우면 그 원본의 굽기만, 전부 지우면 모두(Codex #870). */
    @Test
    fun `지운 뒤에 끝난 굽기는 버린다`() {
        val a = File(context.filesDir, "draft_a.mp3").apply { writeBytes(ByteArray(128)) }
        val b = File(context.filesDir, "clip_b.mp3").apply { writeBytes(ByteArray(256)) }
        val uriA = android.net.Uri.fromFile(a)
        val uriB = android.net.Uri.fromFile(b)
        val ticketA = VoiceTuningRenderer.ticketFor(uriA)
        val ticketB = VoiceTuningRenderer.ticketFor(uriB)

        VoiceTuningRenderer.deleteCopiesOf(context, uriA)
        assertFalse("초안을 버렸다 — 그 굽기는 버린다", ticketA.isCurrent())
        assertTrue("그 순간 울리는 다른 알람의 굽기는 그대로", ticketB.isCurrent())

        VoiceTuningRenderer.clearAll(context)
        assertFalse(ticketB.isCurrent())
        assertTrue(VoiceTuningRenderer.ticketFor(uriB).isCurrent())
        a.delete(); b.delete()
    }

    /** 늦은 굽기는 제 임시 파일만 버린다 — 그 사이 같은 이름으로 게시된 새 굽기의 사본은 그대로(Codex #870). */
    @Test
    fun `늦은 굽기는 새 굽기의 사본을 지우지 않는다`() {
        val src = File(context.filesDir, "late.mp3").apply { writeBytes(ByteArray(64)) }
        val uri = android.net.Uri.fromFile(src)
        val stale = VoiceTuningRenderer.ticketFor(uri)
        VoiceTuningRenderer.deleteCopiesOf(context, uri)
        val dir = File(context.noBackupFilesDir, "voice_tuning").apply { mkdirs() }
        val out = File(dir, "${VoiceTuningRenderer.cacheKey(uri)}_m20.wav")

        val fresh = File(dir, "fresh.tmp").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        assertTrue(VoiceTuningRenderer.publish(fresh, out, VoiceTuningRenderer.ticketFor(uri)))
        val staleTmp = File(dir, "stale.tmp").apply { writeBytes(byteArrayOf(9)) }
        assertFalse(VoiceTuningRenderer.publish(staleTmp, out, stale))

        assertFalse("늦은 굽기의 임시 파일은 버린다", staleTmp.exists())
        assertEquals("새 굽기의 사본은 그대로", listOf<Byte>(1, 2, 3), out.readBytes().toList())
        src.delete()
    }

    /** 울리는 순간에는 굽지 않는다 — 구워 둔 사본만 찾고, 없으면 null(원래 목소리로 곧바로 운다, Codex #870). */
    @Test
    fun `울림은 구워 둔 사본만 찾는다`() {
        val src = File(context.filesDir, "ring.mp3").apply { writeBytes(ByteArray(64)) }
        val uri = android.net.Uri.fromFile(src)
        val tuning = VoiceTuning(pitchSemitones = -2f)
        assertNull("구운 적 없으면 굽지 않고 null", VoiceTuningRenderer.cachedCopy(context, uri, tuning))
        assertNull("0 이면 사본이 없다", VoiceTuningRenderer.cachedCopy(context, uri, VoiceTuning.NEUTRAL))

        val dir = File(context.noBackupFilesDir, "voice_tuning").apply { mkdirs() }
        val out = File(dir, "${VoiceTuningRenderer.cacheKey(uri)}_${VoiceTuningRenderer.pitchTag(-2f)}.wav")
        out.writeBytes(ByteArray(256))
        assertEquals(android.net.Uri.fromFile(out), VoiceTuningRenderer.cachedCopy(context, uri, tuning))
        src.delete()
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
