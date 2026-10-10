package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.FreeBucketOrder
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.StockClipListResponse
import com.alarmtalk.app.sync.StockClipPrefetchWorker
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **기본 목소리 진행률을 한 번 세는 데 캐시 디렉터리를 한 번만 읽고, 길이는 재지 않는다**
 * (2026-09-29 A32).
 *
 * 고치기 전 `StockClipPrefetchWorker.defaultVoiceProgress` 는 클립마다
 * `AlarmAudioStore.getCachedAudio` 를 불렀고, 그 함수는 한 번에 디렉터리를 **두 번** 통째로
 * 읽고(낡음 확인 + 파일 찾기) `MediaMetadataRetriever` 로 **길이까지 쟀다**. 76개면 한 번 세는 데
 * 1.4~1.8초였고, 알람 관문이 그걸 **메인 스레드에서** ＋ 한 번에 두 번 불러 화면이 3.5초 멎었다
 * (연타하면 15.8초).
 *
 * 이 테스트는 **횟수**(`AudioCacheProbeCounter`)로 그 회귀를 고정한다. 함께 고정하는 것 둘:
 * 세는 **값이 그대로일 것**(관문이 잘못 열리거나, 퍼센트가 뒤로 가거나 100% 에 못 닿으면 안
 * 된다 — 답은 클립마다 `getCachedAudio == null` 을 물은 것과 같아야 한다), 그리고 **memo 를
 * 얹지 않을 것**(방금 받은 클립이 다음 질문에서 곧바로 보여야 한다).
 * iOS 짝은 `AlarmTalkTests/StockClipProgressScanTests`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AlarmAudioStoreProbeCountTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val store = AlarmAudioStore(context)

    // AlarmAudioStore.AUDIO_DIR 과 같은 값(private 이라 여기서 직접 쓴다).
    private val audioDir = File(context.filesDir, "alarm-audio").apply { mkdirs() }

    /** 관문이 쓰는 것과 같은 방식으로 고른 기기 언어 — 대상 클립이 이 언어여야 센다. */
    private val language: String = appVoiceLanguageOf(
        context.resources.configuration.locales.let { if (it.isEmpty) null else it[0] }?.language,
    )

    private val systemVoiceId = SYSTEM_VOICE_ID_PREFIX + "000000000101"
    private val userId = "user-probe"

    @Before
    fun clean() {
        audioDir.listFiles()?.forEach { it.delete() }
        StockClipManifestStore.clearAndInvalidate(context)
    }

    /** 매니페스트가 주는 모양 그대로 — 기본(시스템) 목소리의 무료 테마 클립 한 건. */
    private fun stockClip(messageId: String, audioUrl: String?, variant: Int = 0) = StockClip(
        messageId = messageId,
        voiceProfileId = systemVoiceId,
        category = FreeBucketOrder.first(),
        language = language,
        variant = variant,
        text = "오늘은 맑아요",
        audioUrl = audioUrl,
    )

    private fun stockKey(messageId: String) = "${AlarmAudioStore.STOCK_CACHE_KEY_PREFIX}$messageId"

    /** 받아 둔 클립 한 건(본체 + 메타). `rawAudioUri` 가 null 이면 **세대 표식이 없는 옛 캐시**다. */
    private fun putCachedClip(messageId: String, rawAudioUri: String?) {
        store.cacheGeneratedAudio(
            bytes = ByteArray(4 * 1024) { 7 },
            format = "mp3",
            rawAudioUri = rawAudioUri,
            cacheKey = stockKey(messageId),
            messageId = messageId,
        )
    }

    /**
     * ⚠ 캐시를 **먼저** 깔고 매니페스트를 나중에 공개한다. 반대로 하면 캐시 쓰기가 "지나간
     * 매니페스트의 응답" 으로 거절된다(`SupersededAudioException` — 교체된 클립을 깔 때).
     */
    private fun publishManifest(clips: List<StockClip>) {
        val result = StockClipManifestStore.save(
            context,
            StockClipListResponse(clips = clips),
            StockClipManifestStore.beginFetch(),
            userId,
        )
        assertEquals(StockClipManifestStore.PublishResult.PUBLISHED, result)
    }

    @Test
    fun progressReadsTheDirectoryOnceAndNeverProbesDuration() {
        val clips = (0 until 12).map { stockClip("msg-$it", "https://r2.example/$it.mp3", variant = it) }
        clips.take(5).forEach { putCachedClip(it.messageId, it.audioUrl) }
        publishManifest(clips)

        val (progress, counts) = AudioCacheProbeCounter.measuring {
            StockClipPrefetchWorker.defaultVoiceProgress(context, userId)
        }

        // 세는 값은 그대로다 — 받아 둔 다섯이 done 이다.
        assertEquals(5 to 12, progress)
        // 고치기 전: 클립당 전량 읽기 2회 + 길이 1회 = 24회 + 12회였다.
        assertEquals("클립 수와 무관하게 디렉터리는 한 번만 읽어야 한다", 1, counts.directoryListings)
        assertEquals("진행률을 세는 데 길이를 잴 이유가 없다", 0, counts.durationReads)
    }

    /**
     * ⚠ **진짜 불변식은 '클립 수와 무관' 이다.** 숫자 1 만 재면 "클립당 한 번" 으로 되돌아가도
     * 클립 하나짜리 경우는 통과한다. 개수를 다섯 배로 벌려 **같은 횟수**인지로 못 박는다.
     */
    @Test
    fun listingCountDoesNotGrowWithClipCount() {
        val few = (0 until 8).map { stockClip("few-$it", "https://r2.example/few-$it.mp3", variant = it) }
        val many = (0 until 40).map { stockClip("many-$it", "https://r2.example/many-$it.mp3", variant = it) }
        // 절반은 이미 받아 둔다 — 캐시에 있는 갈래도 추가로 디렉터리를 읽지 않아야 한다.
        many.take(20).forEach { putCachedClip(it.messageId, it.audioUrl) }

        publishManifest(few)
        val (fewProgress, fewCounts) = AudioCacheProbeCounter.measuring {
            StockClipPrefetchWorker.defaultVoiceProgress(context, userId)
        }
        publishManifest(many)
        val (manyProgress, manyCounts) = AudioCacheProbeCounter.measuring {
            StockClipPrefetchWorker.defaultVoiceProgress(context, userId)
        }

        assertEquals(0 to 8, fewProgress)
        assertEquals(20 to 40, manyProgress)
        assertEquals(
            "클립이 다섯 배가 됐는데 디렉터리 읽기가 늘었다 = 다시 클립마다 묻고 있다",
            fewCounts.directoryListings,
            manyCounts.directoryListings,
        )
        assertEquals(1, manyCounts.directoryListings)
        assertEquals(0, manyCounts.durationReads)
    }

    /**
     * ⚠ **memo 를 얹으면 여기서 깨진다.** 진행률은 받는 도중에 계속 묻는 값이라, 목록을
     * 들고 있으면 방금 받은 클립이 안 보여 퍼센트가 멈추고 관문이 영영 안 열린다.
     */
    @Test
    fun aClipJustDownloadedIsSeenByTheNextQuestion() {
        val clip = stockClip("msg-fresh", "https://r2.example/fresh.mp3")
        publishManifest(listOf(clip))

        assertEquals(0 to 1, StockClipPrefetchWorker.defaultVoiceProgress(context, userId))
        assertFalse(StockClipPrefetchWorker.defaultVoicesReady(context, userId))

        putCachedClip(clip.messageId, clip.audioUrl)

        assertEquals(1 to 1, StockClipPrefetchWorker.defaultVoiceProgress(context, userId))
        assertTrue(StockClipPrefetchWorker.defaultVoicesReady(context, userId))
    }

    /**
     * 한꺼번에 묻는 답이 **한 키씩 `getCachedAudio == null` 로 물은 답과 같다** — 낡음 판정의
     * 뜻(모르면 낡지 않았다)까지 포함해서.
     */
    @Test
    fun batchAnswerMatchesGetCachedAudioKeyByKey() {
        // 교체됨 — 저장된 주소와 지금 주소가 다르다.
        putCachedClip("msg-replaced", "https://r2.example/old.mp3")
        // 세대 표식이 없는 옛 캐시 — **모르는 것이지 낡은 것이 아니다.**
        putCachedClip("msg-unknown", null)
        // 제자리 그대로.
        putCachedClip("msg-same", "https://r2.example/same.mp3")
        // 서버가 주소를 안 준 클립 — 판단 근거가 없어 다시 받지 않는다.
        putCachedClip("msg-no-url", "https://r2.example/kept.mp3")
        // 목록 밖 확장자로 남은 옛 파일(이름 목록으로만 찾힌다).
        File(audioDir, "${AlarmAudioStore.safeCacheKey(stockKey("msg-odd"))}.xyz").writeBytes(ByteArray(16))
        // 쓰다 죽은 staging 과 별칭 메타만 있는 키는 오디오가 아니다.
        File(audioDir, "${AlarmAudioStore.safeCacheKey(stockKey("msg-partial"))}.mp3.123.part")
            .writeBytes(ByteArray(16))
        File(audioDir, "${AlarmAudioStore.safeCacheKey(stockKey("msg-meta-only"))}.meta")
            .writeText("aliasOf=x\n")

        val requests = listOf(
            stockKey("msg-replaced") to "https://r2.example/new.mp3",
            stockKey("msg-unknown") to "https://r2.example/whatever.mp3",
            stockKey("msg-same") to "https://r2.example/same.mp3",
            stockKey("msg-no-url") to null,
            stockKey("msg-odd") to null,
            stockKey("msg-partial") to null,
            stockKey("msg-meta-only") to null,
            stockKey("msg-never") to "https://r2.example/never.mp3",
        )

        val expected = requests
            .filter { (key, url) -> store.getCachedAudio(key, url) == null }
            .map { it.first }
            .toSet()
        val batch = store.missingOrStaleCacheKeys(requests)

        assertEquals(expected, batch)
        assertEquals(
            setOf(stockKey("msg-replaced"), stockKey("msg-partial"), stockKey("msg-meta-only"), stockKey("msg-never")),
            batch,
        )
        // 한 키씩 묻는 `hasCachedAudio` 도 같은 답이다.
        requests.forEach { (key, url) ->
            assertEquals(key, key !in batch, store.hasCachedAudio(key, url))
        }
        // 선다운로드 워커가 쓰는 스냅숏의 '낡음'(파일이 **있는데** 주소가 바뀜)도 한 키씩 물은 답과 같다.
        val snapshot = store.snapshot()
        requests.forEach { (key, url) ->
            assertEquals(key, store.isCachedAudioStale(key, url), snapshot.isStale(key, url))
            assertEquals(key, key in batch, snapshot.isMissingOrStale(key, url))
        }
        assertEquals(
            setOf(stockKey("msg-replaced")),
            requests.filter { (key, url) -> snapshot.isStale(key, url) }.map { it.first }.toSet(),
        )
    }

    /** 이름으로 찾으므로 흔한 확장자는 디렉터리를 읽지 않는다. 길이는 `getCachedAudio` 만 잰다. */
    @Test
    fun singleLookupResolvesByNameAndOnlyGetCachedAudioProbesDuration() {
        putCachedClip("msg-hit", "https://r2.example/hit.mp3")
        val key = stockKey("msg-hit")

        val (has, hasCounts) = AudioCacheProbeCounter.measuring {
            store.hasCachedAudio(key, "https://r2.example/hit.mp3")
        }
        assertTrue(has)
        assertEquals("흔한 확장자는 이름으로 곧장 찾는다", 0, hasCounts.directoryListings)
        assertEquals("있는지만 물을 때는 길이를 재지 않는다", 0, hasCounts.durationReads)

        val (audio, getCounts) = AudioCacheProbeCounter.measuring {
            store.getCachedAudio(key, "https://r2.example/hit.mp3")
        }
        assertNotNull(audio)
        assertEquals(0, getCounts.directoryListings)
        assertEquals("결과를 오디오로 쓰는 쪽만 길이를 잰다", 1, getCounts.durationReads)
    }

    /** 목록 밖 확장자는 느려질 뿐 **못 찾지는 않는다**(이름 목록 폴백). */
    @Test
    fun unknownExtensionIsStillFound() {
        val key = stockKey("msg-legacy")
        val legacy = File(audioDir, "${AlarmAudioStore.safeCacheKey(key)}.xyz").apply { writeBytes(ByteArray(16)) }

        val (audio, counts) = AudioCacheProbeCounter.measuring { store.getCachedAudio(key) }

        assertEquals(legacy.name, audio?.displayName)
        assertEquals(1, counts.directoryListings)
    }

    /** 물을 것이 없으면 디스크를 건드리지 않는다(매니페스트에 대상이 없을 때). */
    @Test
    fun emptyRequestTouchesNothing() {
        val (missing, counts) = AudioCacheProbeCounter.measuring { store.missingOrStaleCacheKeys(emptyList()) }

        assertTrue(missing.isEmpty())
        assertEquals(0, counts.directoryListings)
        assertEquals(0, counts.durationReads)
    }
}
