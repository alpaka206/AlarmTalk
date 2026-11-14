package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.StockClipListResponse
import com.alarmtalk.app.network.VoicePackClip
import com.alarmtalk.app.network.VoicePackSummary
import com.alarmtalk.app.network.WithdrawnVoicePack
import com.alarmtalk.app.sync.StockClipLanguageRebinder
import com.google.gson.Gson
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 추가 음성팩(`docs/spec/voice-packs.md`) — 팩 목소리를 자리마다 어떻게 보는가, 받은 바이트 대조, 받은 팩 목록(계정별·게시 끝
 * 기한), 기한 뒤 미나로 대체, 서버 사본에 팩 id 를 싣지 않는다, 접근권 대조·언어 재바인딩이 팩 알람을 건드리지 않는다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoicePackTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao
    private var currentUser: String? = "user-a"

    private val packVoiceId = VOICE_PACK_VOICE_ID_PREFIX + "0000000000aa"

    private fun clipSource() = DefaultVoiceClipSource(
        context = context,
        cachedAudio = { key, url ->
            CachedAlarmAudio(localAudioUri = "file:///audio/$key.mp3", rawAudioUri = url, displayName = key, durationMillis = 3_000L, cacheKey = key)
        },
        manifest = {
            StockClipListResponse(
                clips = (0..8).map { v ->
                    StockClip(
                        messageId = "mina-weather-$v",
                        voiceProfileId = SUBSTITUTE_SYSTEM_VOICE_ID,
                        category = "weather",
                        language = "ko",
                        variant = v,
                        text = "날씨 $v",
                        audioUrl = "https://cdn.example/mina/weather/$v.mp3",
                    )
                },
                expectedVariants = ExpectedVariantCounts(system = mapOf("weather" to 9)),
            )
        },
        deviceVoiceLanguage = { "ko" },
    )

    private val repository by lazy {
        AlarmRepository(
            alarmDao = dao,
            holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
            holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
            alarmScheduler = AlarmScheduler(context),
            alarmAudioStore = AlarmAudioStore(context),
            context = context,
            currentUserIdProvider = { currentUser },
            defaultVoiceClipSource = clipSource(),
        )
    }

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(context, AlarmDatabase::class.java).allowMainThreadQueries().build()
        dao = db.alarmDao()
    }

    @After
    fun tearDown() {
        db.close()
        context.getSharedPreferences("voice_packs", Context.MODE_PRIVATE).edit().clear().commit()
    }

    private fun clip(id: String, category: String, variant: Int, bytes: ByteArray = "audio-$id".toByteArray()) =
        VoicePackClip(clipId = id, category = category, language = "ja", variant = variant, text = "t$id", sha256 = sha256Hex(bytes), sizeBytes = bytes.size.toLong(), audioFormat = "mp3")

    private fun heldPack(ready: Boolean = true, withdrawnUntil: Long? = null) = HeldVoicePack(
        packId = "first-pack",
        voiceId = packVoiceId,
        speakerName = "화자",
        language = "ja",
        contentRevision = 3,
        previewClipId = "c-greeting",
        clips = listOf(clip("c-greeting", "greeting", 0), clip("c-w0", "weather", 0), clip("c-w1", "weather", 1)),
        ready = ready,
        withdrawnPlaybackUntilMillis = withdrawnUntil,
    )

    private fun packAlarm(id: String = "pack-alarm") = rehearsalCloneAlarm(
        id = id,
        voiceProfileId = packVoiceId,
        bucketId = "weather",
        bucketClipKeysJson = Gson().toJson(listOf(voicePackCacheKey("c-w0"), voicePackCacheKey("c-w1"))),
        audioCacheKey = voicePackCacheKey("c-w0"),
        ttsMessageId = "c-w0",
        localAudioUri = "file:///audio/pack_c-w0.mp3",
    )

    @Test
    fun packVoicesAreFreeFixedButNotDefaultVoices() {
        assertTrue(isVoicePackVoiceId(packVoiceId))
        assertFalse(isSystemVoiceId(packVoiceId))
        assertTrue(isFreeFixedVoiceId(packVoiceId))
        assertTrue(isFreeFixedVoiceId(SUBSTITUTE_SYSTEM_VOICE_ID))
        assertFalse(isVoicePackVoiceId(SUBSTITUTE_SYSTEM_VOICE_ID))
        assertFalse(isFreeFixedVoiceId(TEST_CLONE_VOICE_ID))
        // 무료로 운다 — 무료 잠금·울릴 때 강등이 팩 알람을 건드리지 않는다.
        assertTrue(packAlarm().usesFreeSystemVoiceAlarm())
        // 대체 목소리는 팩을 '이미 기본 목소리' 로 보지 않는다 — 언제나 미나다.
        assertEquals(SUBSTITUTE_SYSTEM_VOICE_ID, pickDefaultSystemVoiceId(packVoiceId))
    }

    @Test
    fun packClipsUseTheirOwnCacheNamespaceAndLanguage() {
        val clips = heldPack().toStockClips()
        assertEquals(listOf("pack_c-greeting", "pack_c-w0", "pack_c-w1"), clips.map { it.clipCacheKey() })
        assertEquals("stock_m1", StockClip(messageId = "m1", voiceProfileId = SUBSTITUTE_SYSTEM_VOICE_ID).clipCacheKey())
        assertTrue(clips.all { it.voiceProfileId == packVoiceId && it.language == "ja" })
        assertTrue(clips.first().audioUrl!!.startsWith("voice-pack://first-pack/c-greeting?sha256="))
        assertEquals("ja", voicePackLanguageOf(clips, packVoiceId))
        assertNull(voicePackLanguageOf(clips, SUBSTITUTE_SYSTEM_VOICE_ID))
    }

    @Test
    fun downloadedBytesMustMatchHashAndSize() {
        val bytes = "real-audio".toByteArray()
        val good = clip("c1", "weather", 0, bytes)
        assertTrue(voicePackBytesMatch(bytes, good))
        assertFalse("해시가 다르면 넣지 않는다", voicePackBytesMatch("tampered!!".toByteArray(), good))
        assertFalse("크기가 다르면 넣지 않는다", voicePackBytesMatch(bytes, good.copy(sizeBytes = bytes.size + 1L)))
        assertFalse(voicePackBytesMatch(ByteArray(0), good.copy(sha256 = sha256Hex(ByteArray(0)), sizeBytes = 0)))
    }

    @Test
    fun withdrawnPacksKeepPlayingUntilTheDeadline() {
        val pack = heldPack(withdrawnUntil = 10_000L)
        assertFalse("기한 전에는 바꾸지 않는다", pack.retirementDue(9_999L))
        assertTrue("기한이 지나면 대체한다", pack.retirementDue(10_000L))
        assertFalse(heldPack().retirementDue(Long.MAX_VALUE))
    }

    @Test
    fun editorListsReadyListedPacksAndTheEditingAlarmsOwnPack() {
        val ready = heldPack()
        val downloading = heldPack(ready = false).copy(packId = "p2", voiceId = VOICE_PACK_VOICE_ID_PREFIX + "0000000000bb")
        val withdrawn = heldPack(withdrawnUntil = 1L).copy(packId = "p3", voiceId = VOICE_PACK_VOICE_ID_PREFIX + "0000000000cc")
        assertEquals(listOf("first-pack"), editorVoicePacks(listOf(ready, downloading, withdrawn), editingVoiceId = null).map { it.packId })
        // 게시가 끝났어도 그 팩으로 저장된 알람을 열면 그 목소리를 그대로 둔다.
        assertEquals(
            listOf("first-pack", "p3"),
            editorVoicePacks(listOf(ready, downloading, withdrawn), editingVoiceId = withdrawn.voiceId).map { it.packId },
        )
        // 그 알람의 팩이 새 개정을 받는 중이어도 빼지 않는다 — 빼면 편집기가 다른 목소리로 갈아 끼운다(코덱스 #960).
        assertEquals(
            listOf("first-pack", "p2"),
            editorVoicePacks(listOf(ready, downloading, withdrawn), editingVoiceId = downloading.voiceId).map { it.packId },
        )
        assertEquals(true, ready.toVoiceProfile().isSystem)
    }

    @Test
    fun storeIsPerAccountAndAppliesTheCatalog() {
        val store = VoicePackStore(context)
        store.upsert("user-a", heldPack())
        assertEquals(1, store.held("user-a").size)
        assertTrue("다른 계정에는 안 보인다", store.held("user-b").isEmpty())
        assertTrue(store.held(null).isEmpty())

        store.applyCatalog(
            "user-a",
            listedPackIds = emptySet(),
            withdrawn = listOf(WithdrawnVoicePack("first-pack", packVoiceId, "2026-11-01T15:00:00.000Z")),
        )
        assertEquals(java.time.Instant.parse("2026-11-01T15:00:00Z").toEpochMilli(), store.find("user-a", "first-pack")!!.withdrawnPlaybackUntilMillis)
        // 다시 게시돼 목록에 돌아오면 기한을 지운다.
        store.applyCatalog("user-a", listedPackIds = setOf("first-pack"), withdrawn = emptyList())
        assertNull(store.find("user-a", "first-pack")!!.withdrawnPlaybackUntilMillis)
        // 목록 어디에도 없으면(빌드·지역) 건드리지 않는다.
        store.applyCatalog("user-a", listedPackIds = emptySet(), withdrawn = emptyList())
        assertNull(store.find("user-a", "first-pack")!!.withdrawnPlaybackUntilMillis)
        assertTrue(store.find("user-a", "first-pack")!!.ready)
    }

    @Test
    fun fromDetailStartsDownloadingAndKeepsTheDeadline() {
        val detail = VoicePackSummary(
            packId = "first-pack", voiceId = packVoiceId, contentRevision = 4, speakerName = "화자", language = "ja",
            clips = listOf(clip("new", "weather", 0)),
        )
        val next = HeldVoicePack.fromDetail(detail, previous = heldPack(withdrawnUntil = 5L))
        assertFalse(next.ready)
        assertEquals(4, next.contentRevision)
        assertEquals(5L, next.withdrawnPlaybackUntilMillis)
    }

    @Test
    fun accessCheckAndLanguageRebindLeavePackAlarmsAlone() = runBlocking {
        dao.upsert(packAlarm())
        // GET /voice 에 팩 목소리는 원래 없다 — 그걸로 강등하면 안 된다.
        assertEquals(0, repository.degradeAlarmsWithInaccessibleVoice(accessibleVoiceIds = emptySet(), expectedOwnerUserId = "user-a"))
        assertEquals(packVoiceId, dao.getById("pack-alarm")!!.voiceProfileId)
        // 팩은 언어 하나이고 기본 목소리 매니페스트에 없다 — 다시 묶지 않는다.
        assertFalse(StockClipLanguageRebinder.needsRebind(dao.getById("pack-alarm")!!, "ko", liveKeys = emptySet()))
    }

    @Test
    fun retiringAPackTurnsItsAlarmsIntoMina() = runBlocking {
        dao.upsert(packAlarm())
        dao.upsert(rehearsalCloneAlarm(id = "clone-alarm"))
        assertEquals(1, repository.countAlarmsUsingVoice(packVoiceId, "user-a"))
        // 다른 계정이면 아무것도 하지 않는다.
        assertEquals(0, repository.degradeAlarmsUsingVoicePack(packVoiceId, expectedOwnerUserId = "user-b"))
        assertEquals(1, repository.degradeAlarmsUsingVoicePack(packVoiceId, expectedOwnerUserId = "user-a"))
        val degraded = dao.getById("pack-alarm")!!
        assertEquals(SUBSTITUTE_SYSTEM_VOICE_ID, degraded.voiceProfileId)
        assertEquals("weather", degraded.bucketId)
        assertEquals((0..8).map { "stock_mina-weather-$it" }, degraded.bucketClipKeys())
        assertEquals("곧바로 무음이 아니다 — 목소리 알람 그대로", AlarmPlayModes.VOICE_ONLY, degraded.playMode)
        assertEquals("다른 알람은 그대로", TEST_CLONE_VOICE_ID, dao.getById("clone-alarm")!!.voiceProfileId)
        // 팩 목소리가 아닌 id 로는 이 길을 쓸 수 없다.
        assertEquals(0, repository.degradeAlarmsUsingVoicePack(TEST_CLONE_VOICE_ID, expectedOwnerUserId = "user-a"))
    }

    @Test
    fun deletingAPackAlarmKeepsTheClipsAHeldPackOwns() = runBlocking {
        val audioStore = AlarmAudioStore(context)
        val key = voicePackCacheKey("c-w0")
        audioStore.cacheGeneratedAudio(bytes = "audio-c-w0".toByteArray(), format = "mp3", rawAudioUri = null, cacheKey = key)
        try {
            VoicePackStore(context).upsert("user-a", heldPack())
            VoicePackStore(context).upsert("user-b", heldPack())
            assertTrue(key in VoicePackStore(context).heldClipCacheKeysOnDevice())
            dao.upsert(packAlarm())
            // 일반 알람 삭제는 팩이 쥔 클립을 지우지 않는다 — 지우면 '받음' 인 팩으로 오프라인 저장이 실패한다(코덱스 #960).
            repository.deleteAlarm("pack-alarm")
            assertNull(dao.getById("pack-alarm"))
            assertTrue("받은 팩의 클립은 남는다", audioStore.hasCachedAudio(key))
            // 한 계정이 팩을 지워도 다른 계정이 받아 두었으면 남긴다.
            VoicePackStore(context).remove("user-a", "first-pack")
            repository.releaseUnusedAudio(setOf(key))
            assertTrue("다른 계정이 쥔 팩의 클립은 남는다", audioStore.hasCachedAudio(key))
            // 아무 계정도 쥐지 않으면 놓는 쪽이 지운다.
            VoicePackStore(context).remove("user-b", "first-pack")
            repository.releaseUnusedAudio(setOf(key))
            assertFalse(audioStore.hasCachedAudio(key))
        } finally {
            audioStore.deleteCachedAudioKeys(setOf(key))
        }
    }

    /**
     * 기한은 백그라운드에서도 지난다 — **진입마다** 저장된 기한으로 대체한다(코덱스 #960). 뷰모델은 단위 테스트에서 세울 수 없어
     * (`EntryRefreshKeepsTokenTest` 와 같은 사정) 진입 구독이 대체를 부르는지 소스로 고정한다.
     */
    @Test
    fun everyAppEntryRetiresDuePacksWithoutTheNetwork() {
        val viewModel = java.io.File("src/main/java/com/alarmtalk/app/ui/main/MainViewModel.kt").readText()
        assertTrue(
            "진입 구독(`AppSignals.appEntries`)이 기한 지난 팩 대체를 부르지 않는다",
            Regex("""AppSignals\.appEntries\.collect \{ entry ->\s*if \(entry > 0L\) retireDueVoicePacksOnEntry\(\)""").containsMatchIn(viewModel),
        )
        val actions = java.io.File("src/main/java/com/alarmtalk/app/ui/main/MainViewModelVoicePacks.kt").readText()
        val body = actions.substringAfter("internal fun MainViewModel.retireDueVoicePacksOnEntry()").substringBefore("\n}\n")
        assertTrue("진입 대체는 저장된 기한으로만 한다(`retireDuePacks`)", body.contains("VoicePackDownloader.retireDuePacks("))
        assertFalse("진입 대체는 네트워크를 부르지 않는다", body.contains("api."))
    }

    @Test
    fun unfinishedPacksOfferARetryThatKeepsThePack() {
        // 못 받았거나 받다 멈춘 팩은 지우지 않고 '다시 받기' — 지우고 다시 받으면 그 팩 알람이 미나로 바뀐다(코덱스 #960).
        assertTrue(com.alarmtalk.app.canRetryVoicePackDownload(heldPack(ready = false), percent = null))
        assertFalse("받는 회차가 돌고 있으면 감춘다", com.alarmtalk.app.canRetryVoicePackDownload(heldPack(ready = false), percent = 40))
        assertFalse("다 받은 팩", com.alarmtalk.app.canRetryVoicePackDownload(heldPack(), percent = null))
        assertFalse("게시가 끝난 팩은 새로 받지 않는다", com.alarmtalk.app.canRetryVoicePackDownload(heldPack(ready = false, withdrawnUntil = 5L), percent = null))
        assertFalse("받지 않은 팩은 '받기' 다", com.alarmtalk.app.canRetryVoicePackDownload(null, percent = null))
    }
}
