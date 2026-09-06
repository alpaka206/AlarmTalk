package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **교체가 끝난 뒤 옛 스톡 클립 파일을 지운다**(2026-09-03 지시) — 파일을 실제로 **지우는**
 * 코드라 남기는 조건을 못 박는다.
 *
 * 순서가 안전장치다: 다 받고 → 다 묶고 → **그 다음에** 지운다. 여기서는 마지막 단계만
 * 검증한다(앞 두 단계의 판정은 `StockClipRebindDecisionTest`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StockAudioPruneTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var store: AlarmAudioStore
    private lateinit var dir: File

    @Before
    fun setUp() {
        store = AlarmAudioStore(context)
        dir = File(context.filesDir, "alarm-audio").also { it.deleteRecursively(); it.mkdirs() }
    }

    private fun put(name: String) = File(dir, name).apply { writeText("x") }

    @Test
    fun 참조도_안_되고_매니페스트에도_없는_옛_클립만_지운다() {
        val stale = put("stock_old.mp3")
        val referenced = put("stock_bound.mp3")
        val live = put("stock_new.mp3")

        val deleted = store.pruneReplacedStockAudio(
            referencedKeys = setOf("stock_bound"),
            liveKeys = setOf("stock_new"),
        )

        assertEquals(1, deleted)
        assertFalse("옛 클립은 지운다", stale.exists())
        // ⚠ **여러 알람이 같은 클립을 공유한다** — 하나라도 물고 있으면 남긴다.
        assertTrue("알람이 물고 있는 클립은 남긴다", referenced.exists())
        // ⚠ 알람이 아직 안 물었어도 편집기에서 골라야 하므로 남긴다.
        assertTrue("매니페스트에 있는 클립은 남긴다", live.exists())
    }

    @Test
    fun 메타_사이드카도_함께_지운다() {
        put("stock_old.mp3")
        val meta = put("stock_old.meta")
        store.pruneReplacedStockAudio(setOf(), setOf("stock_new"))
        assertFalse(meta.exists())
    }

    /** 스톡이 아닌 캐시(녹음·직접입력·생성 TTS)는 이 스윕의 대상이 아니다. */
    @Test
    fun 스톡이_아닌_파일은_건드리지_않는다() {
        val recording = put("recording_1.m4a")
        val generated = put("abc123hash.mp3")
        val remote = put("remote-message-xyz.mp3")
        store.pruneReplacedStockAudio(setOf(), setOf("stock_new"))
        assertTrue(recording.exists())
        assertTrue(generated.exists())
        assertTrue(remote.exists())
    }

    /**
     * ⚠ **매니페스트를 못 받았으면 아무것도 지우지 않는다.** 빈 집합을 '살아 있는 클립이
     * 없다' 로 읽으면 네트워크가 한 번 죽은 것만으로 받아 둔 클립을 전부 날린다.
     */
    @Test
    fun 매니페스트를_못_받으면_아무것도_안_지운다() {
        val a = put("stock_a.mp3")
        val b = put("stock_b.mp3")
        assertEquals(0, store.pruneReplacedStockAudio(setOf(), setOf()))
        assertTrue(a.exists())
        assertTrue(b.exists())
    }

    /** 쓰다 만 잔재(.partial)는 다른 스윕이 맡는다 — 여기서 건드리면 진행 중인 쓰기를 깬다. */
    @Test
    fun 쓰는_중인_파일은_건드리지_않는다() {
        val partial = put("stock_writing.part")
        store.pruneReplacedStockAudio(setOf(), setOf("stock_new"))
        assertTrue(partial.exists())
    }
}
