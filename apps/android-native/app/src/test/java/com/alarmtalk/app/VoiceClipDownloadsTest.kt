package com.alarmtalk.app

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 목소리 하나의 클립은 **한 번에 한 벌**, **클립마다 한 번만 묻고**, **동시에 4개**씩 받는다
 * (2026-09-29 효율 감사 M4).
 *
 * 고치기 전에는 클론 등록 직후 드라이브와 목소리 탭이 같은 클립을 동시에, 둘 다 순차로 받았고
 * (같은 클립을 두 번 받았다), 탭 쪽은 클립마다 캐시를 두 번 물었다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoiceClipDownloadsTest {

    /** 디스크 대신 — 받은 클립 이름을 적어 둔다. */
    private class FakeCache(initial: Set<String> = emptySet()) {
        val cached = initial.toMutableSet()
        var missingCalls = 0
        val downloads = mutableListOf<String>()
        var inFlight = 0
        var maxInFlight = 0

        fun missing(clips: List<String>): List<String> {
            missingCalls += 1
            return clips.filterNot { it in cached }
        }

        suspend fun download(clip: String) {
            inFlight += 1
            maxInFlight = maxOf(maxInFlight, inFlight)
            try {
                delay(10)
                if (clip.startsWith("bad")) error("network")
                downloads += clip
                cached += clip
            } finally {
                inFlight -= 1
            }
        }
    }

    @Test
    fun asksOncePerRunAndDownloadsOnlyWhatIsMissing() = runTest {
        val cache = FakeCache(initial = setOf("c0", "c1"))
        val progress = mutableListOf<Pair<Int, Int>>()
        val clips = (0 until 6).map { "c$it" }

        val ok = VoiceClipDownloads().cache("v1", clips, cache::missing, cache::download) { d, t -> progress += d to t }

        assertTrue(ok)
        assertEquals("한 번에 클립마다 한 번만 물어야 한다(세려고 한 번, 받기 전에 또 한 번이었다).", 1, cache.missingCalls)
        assertEquals(listOf("c2", "c3", "c4", "c5"), cache.downloads.sorted())
        // 처음엔 이미 있는 수, 받을 때마다 하나씩 — 뒤로 가지 않는다.
        assertEquals(2 to 6, progress.first())
        assertEquals(6 to 6, progress.last())
        assertEquals(progress.map { it.first }.sorted(), progress.map { it.first })
    }

    @Test
    fun downloadsAtMostFourAtOnce() = runTest {
        val cache = FakeCache()
        val clips = (0 until 21).map { "c$it" }

        assertTrue(VoiceClipDownloads().cache("v1", clips, cache::missing, cache::download))

        assertEquals(21, cache.downloads.size)
        assertEquals("동시에 받는 수는 4개여야 한다(순차는 1분을 넘기고, 과하면 서버·기기가 힘들다).", 4, cache.maxInFlight)
    }

    @Test
    fun aSecondRunForTheSameVoiceWaitsAndDoesNotDownloadTwice() = runTest {
        val cache = FakeCache()
        val downloads = VoiceClipDownloads()
        val clips = (0 until 8).map { "c$it" }

        // 드라이브와 목소리 탭이 같은 목소리를 거의 동시에 받기 시작한다.
        val drive = async { downloads.cache("v1", clips, cache::missing, cache::download) }
        val panel = async { downloads.cache("v1", clips.take(5), cache::missing, cache::download) }

        assertTrue(drive.await())
        assertTrue(panel.await())
        assertEquals(clips.toSet(), cache.downloads.toSet())
        assertEquals("같은 클립을 두 번 받았다.", 8, cache.downloads.size)
    }

    @Test
    fun differentVoicesDoNotWaitForEachOther() = runTest {
        val gate = CompletableDeferred<Unit>()
        val downloads = VoiceClipDownloads()
        var otherDone = false

        val slow = async {
            downloads.cache("v1", listOf("a"), { it }, { gate.await() })
        }
        runCurrent()
        val other = async {
            downloads.cache("v2", listOf("b"), { it }, { otherDone = true })
        }
        runCurrent()
        assertTrue("다른 목소리가 앞 목소리를 기다렸다.", otherDone)
        assertTrue(other.await())
        gate.complete(Unit)
        assertTrue(slow.await())
    }

    @Test
    fun oneFailureDoesNotStopTheRestButIsReported() = runTest {
        val cache = FakeCache()
        val clips = listOf("c0", "bad1", "c2", "c3")

        val ok = VoiceClipDownloads().cache("v1", clips, cache::missing, cache::download)

        assertFalse("실패가 있는데 다 받았다고 답했다.", ok)
        assertEquals(listOf("c0", "c2", "c3"), cache.downloads.sorted())
    }

    @Test
    fun nothingToDoMeansNoDownloadAndNoProgressForAnEmptyList() = runTest {
        val cache = FakeCache()
        var progressCalls = 0
        assertTrue(VoiceClipDownloads().cache("v1", emptyList(), cache::missing, cache::download) { _, _ -> progressCalls += 1 })
        assertEquals(0, progressCalls)
        assertTrue(cache.downloads.isEmpty())
    }
}
