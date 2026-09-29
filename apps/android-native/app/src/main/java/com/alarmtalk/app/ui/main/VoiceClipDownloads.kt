package com.alarmtalk.app

import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit

/**
 * 목소리 하나의 클립을 받는 일은 **한 번에 한 벌**이다(2026-09-29 효율 감사 M4).
 *
 * 예전에는 클론 등록 직후 드라이브(`startPrerenderDrive` → `downloadAllPresetClips`)와 목소리 탭의
 * 폴링(`VoiceProfileManagementPanel` 의 `downloadCloneBuckets`)이 **같은 클립을 동시에, 둘 다
 * 순차로** 받았다 — 4분 동안 status 43회, 같은 클립을 두 번 받았다. 게다가 탭 쪽은 클립마다
 * 캐시를 두 번 물었다(세려고 한 번, 받기 전에 또 한 번).
 *
 * 지키는 것:
 *  - **목소리마다 한 벌.** 뒤에 온 쪽은 앞 벌이 끝나기를 기다렸다가 **빠진 것만** 본다 —
 *    앞 벌이 받은 클립은 다시 받지 않는다.
 *  - **클립마다 한 번만 묻는다.** 빠진 것을 [cache] 의 `missing` 한 번으로 고르고, 받은 것은
 *    받았다고 센다(다시 묻지 않는다).
 *  - **동시에 [parallelism] 개.** 클립당 HTTP 왕복 1회라 순차로는 약전파에서 1분을 넘긴다.
 *  - 한 클립이 실패해도 나머지는 계속 받는다. 실패가 하나라도 있으면 false.
 */
internal class VoiceClipDownloads(private val parallelism: Int = DEFAULT_PARALLELISM) {
    private val locks = ConcurrentHashMap<String, Mutex>()

    /**
     * @param missing [clips] 중 **받아야 하는 것**만 돌려준다. 한 번만 부른다.
     * @param download 클립 하나를 받아 캐시에 쓴다. 던지면 그 클립만 실패로 센다.
     * @param onProgress (캐시에 있는 수, 전체). 처음 한 번, 그리고 하나 받을 때마다 — 한 번에
     *   하나씩, 값이 뒤로 가지 않게 부른다. [clips] 가 비었으면 부르지 않는다.
     * @return 빠진 것 없이 다 캐시됐는가.
     */
    suspend fun <T> cache(
        voiceId: String,
        clips: List<T>,
        missing: (List<T>) -> List<T>,
        download: suspend (T) -> Unit,
        onProgress: (done: Int, total: Int) -> Unit = { _, _ -> },
    ): Boolean = locks.computeIfAbsent(voiceId) { Mutex() }.withLock {
        val toFetch = missing(clips)
        val total = clips.size
        var done = total - toFetch.size
        if (total > 0) onProgress(done, total)
        if (toFetch.isEmpty()) return@withLock true
        val permits = Semaphore(parallelism)
        val progressLock = Mutex()
        coroutineScope {
            toFetch.map { clip ->
                async {
                    permits.withPermit {
                        val ok = try {
                            download(clip)
                            true
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Exception) {
                            false
                        }
                        if (ok) {
                            progressLock.withLock {
                                done += 1
                                onProgress(done, total)
                            }
                        }
                        ok
                    }
                }
            }.awaitAll()
        }.all { it }
    }

    companion object {
        /** 동시에 받는 클립 수. 기본 목소리 선다운로드(`prefetchFreeBucketClips`)와 같은 값이다. */
        const val DEFAULT_PARALLELISM = 4
    }
}
