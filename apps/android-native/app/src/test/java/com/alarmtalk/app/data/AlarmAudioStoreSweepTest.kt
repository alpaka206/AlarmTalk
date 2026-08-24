package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 캐시 스윕이 '지금 쓰고 있는' staging(.part)까지 지우면 쓰던 쪽의 renameTo 가 실패해
 * IOException("Failed to finalize cached audio")으로 프리페치나 알람 저장이 죽는다.
 * 앱 시작 스윕은 StockClipPrefetchWorker·편집기 다운로드와 겹칠 수 있고, 워커는 별도
 * 프로세스일 수 있어 키별 lock 으로도 못 막는다(Codex #646 P2).
 *
 * 갓 쓴 staging 은 살리고 죽어서 남은 잔재만 지우는지 고정한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AlarmAudioStoreSweepTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val store = AlarmAudioStore(context)

    // AlarmAudioStore.AUDIO_DIR 과 같은 값(private 이라 여기서 직접 쓴다).
    private val audioDir = File(context.filesDir, "alarm-audio").apply { mkdirs() }

    private val now = System.currentTimeMillis()
    private val oneHourMillis = 60L * 60 * 1_000

    @Before
    fun clearAudioDir() {
        audioDir.listFiles()?.forEach { it.delete() }
    }

    /** cacheGeneratedAudioLocked 가 만드는 staging 이름 그대로: "<key>.<ext>.<nanos>.part" */
    private fun staging(name: String) = File(audioDir, name).apply { writeBytes(ByteArray(16)) }

    @Test
    fun keepsPartialThatIsStillBeingWritten() {
        val inFlight = staging("abc.mp3.123456789.part")

        val deleted = store.sweepStaleCache(inUseFileNames = emptySet(), nowMillis = now)

        assertTrue("쓰고 있는 staging 은 남아야 한다", inFlight.exists())
        assertEquals(0, deleted)
    }

    @Test
    fun sweepsPartialLeftBehindByACrash() {
        val leftover = staging("abc.mp3.123456789.part")

        // 파일을 만든 지 한참 뒤에 스윕이 돈 상황.
        val deleted = store.sweepStaleCache(
            inUseFileNames = emptySet(),
            nowMillis = now + 2 * oneHourMillis,
        )

        assertFalse("죽어서 남은 잔재는 정리해야 한다", leftover.exists())
        assertEquals(1, deleted)
    }

    @Test
    fun sweepsStockStagingToo() {
        // stock_ 접두사 예외는 '완성된 클립'을 오프라인 재생용으로 지키는 것이다.
        // staging 은 재생할 수 없으니 그 예외에 걸리면 안 된다(.part 검사가 앞에 있어야 한다).
        val leftover = staging("stock_abc.mp3.123456789.part")

        store.sweepStaleCache(inUseFileNames = emptySet(), nowMillis = now + 2 * oneHourMillis)

        assertFalse("완성 클립이 아닌 staging 은 stock 예외 대상이 아니다", leftover.exists())
    }

    @Test
    fun keepsCompletedStockClipRegardlessOfAge() {
        val clip = staging("stock_abc.mp3")

        store.sweepStaleCache(
            inUseFileNames = emptySet(),
            maxAgeMillis = 0,
            nowMillis = now + 365L * 24 * oneHourMillis,
        )

        assertTrue("미리 받아둔 기본 목소리 클립은 TTL 과 무관하게 남는다", clip.exists())
    }

    @Test
    fun keepsOldMessageCacheUntilReplacementIsSecured() {
        val oldBytes = ByteArray(4 * 1024) { 1 }
        val newBytes = ByteArray(4 * 1024) { 2 }
        store.cacheGeneratedAudio(
            bytes = oldBytes,
            format = "mp3",
            rawAudioUri = "r2://old-voice",
            cacheKey = "stock_message-1",
            messageId = "message-1",
        )

        assertNotNull(store.getCachedAudio("stock_message-1", "r2://old-voice"))
        assertNull(store.getCachedAudio("stock_message-1", "r2://new-voice"))
        val oldFile = audioDir.listFiles().orEmpty().single {
            it.nameWithoutExtension == "stock_message-1" && it.extension != "meta"
        }
        assertTrue(oldFile.exists())
        assertEquals(oldBytes.toList(), oldFile.readBytes().toList())

        store.cacheGeneratedAudio(
            bytes = newBytes,
            format = "mp3",
            rawAudioUri = "r2://new-voice",
            cacheKey = "stock_message-1",
            messageId = "message-1",
        )

        assertNotNull(store.getCachedAudio("stock_message-1", "r2://new-voice"))
        assertEquals(newBytes.toList(), oldFile.readBytes().toList())
    }
}
