package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.StockClipListResponse
import kotlinx.coroutines.runBlocking
import org.junit.After
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
 * 전경·백그라운드 무료 잠금이 알람을 **기본 목소리 알람**으로 바꾸고, 다시 유료가 되면 되돌리는가
 * (`docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」).
 *
 * 2026-09-29 dev 리허설: 앱을 연 순간 `Locked paid voice alarms on free plan count=1` 이 그 알람을
 * '알람' 모드로 바꿔 목록·편집기에서 **그냥 기본 알람**이 됐고, 울릴 때는 아무 소리도 없었다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DefaultVoiceLockRepositoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao
    private var currentUser: String? = "user-a"
    private var manifest: List<StockClip>? = null
    private var expectedVariants: ExpectedVariantCounts? = ExpectedVariantCounts(system = mapOf("weather" to 9))

    private fun clipSource() = DefaultVoiceClipSource(
        context = context,
        cachedAudio = { key, url ->
            CachedAlarmAudio(
                localAudioUri = "file:///audio/$key.mp3",
                rawAudioUri = url,
                displayName = key,
                durationMillis = 3_000L,
                cacheKey = key,
            )
        },
        manifest = { manifest?.let { StockClipListResponse(clips = it, expectedVariants = expectedVariants) } },
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

    private fun weatherClips(voice: String) = (0..8).map { variant ->
        StockClip(
            messageId = "$voice-weather-$variant",
            voiceProfileId = voice,
            category = "weather",
            language = "ko",
            variant = variant,
            text = "날씨 $variant",
            audioUrl = "https://cdn.example/$voice/weather/$variant.mp3",
        )
    }

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(context, AlarmDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.alarmDao()
        manifest = weatherClips(TEST_SYSTEM_VOICE_ID) + weatherClips(TEST_SECOND_SYSTEM_VOICE_ID)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun lockTurnsTheRehearsalAlarmIntoADefaultVoiceAlarm() = runBlocking {
        dao.upsert(rehearsalCloneAlarm())

        assertEquals(1, repository.lockPaidAlarmTalks(expectedOwnerUserId = "user-a"))

        val locked = dao.getById("rehearsal-1")!!
        assertEquals("목록·편집기에서 기본 알람이 되지 않는다", AlarmPlayModes.VOICE_ONLY, locked.playMode)
        assertEquals("대체 기본 목소리는 미나", SUBSTITUTE_SYSTEM_VOICE_ID, locked.voiceProfileId)
        assertEquals("weather", locked.bucketId)
        assertEquals(
            (0..8).map { "stock_$TEST_SECOND_SYSTEM_VOICE_ID-weather-$it" },
            locked.bucketClipKeys(),
        )
        assertEquals("$TEST_SECOND_SYSTEM_VOICE_ID-weather-0", locked.ttsMessageId)
        assertTrue(locked.hasLockedPaidVoice())
        assertEquals(AlarmPlayModes.VOICE_ONLY, locked.preLockPlayMode)
        // 잠금은 로컬만 고친다.
        assertEquals(AlarmSyncStates.SYNCED, locked.syncState)
        // 보관본의 원래 오디오는 참조로 센다 — 다른 경로의 정리가 지우지 않게.
        assertTrue(dao.countByAudioCacheKey("stock_clone-weather-0") >= 1)
    }

    @Test
    fun aSecondLockRunChangesNothingAndCountsNothing() = runBlocking {
        dao.upsert(rehearsalCloneAlarm())
        repository.lockPaidAlarmTalks()
        val first = dao.getById("rehearsal-1")

        assertEquals("강등 안내가 매번 뜨지 않는다", 0, repository.lockPaidAlarmTalks())
        assertEquals(first, dao.getById("rehearsal-1"))
    }

    @Test
    fun oldShapeLocksAreConvertedWithoutBeingCountedAgain() = runBlocking {
        dao.upsert(rehearsalCloneAlarm(playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = AlarmPlayModes.VOICE_ONLY))

        assertEquals(0, repository.lockPaidAlarmTalks())

        val converted = dao.getById("rehearsal-1")!!
        assertEquals(AlarmPlayModes.VOICE_ONLY, converted.playMode)
        assertTrue(isSystemVoiceId(converted.voiceProfileId))
        assertEquals(TEST_CLONE_VOICE_ID, converted.lockedPaidVoice()?.voiceProfileId)
    }

    @Test
    fun withoutDownloadedClipsTheLockLeavesAnAudiolessDefaultVoiceAlarm() = runBlocking {
        manifest = null
        dao.upsert(rehearsalCloneAlarm())

        assertEquals(1, repository.lockPaidAlarmTalks())

        val locked = dao.getById("rehearsal-1")!!
        assertEquals(AlarmPlayModes.VOICE_ONLY, locked.playMode)
        assertEquals(TEST_SECOND_SYSTEM_VOICE_ID, locked.voiceProfileId)
        assertEquals("테마는 남긴다 — 편집기가 종류를 잃지 않는다", "weather", locked.bucketId)
        assertNull(locked.bucketClipKeysJson)
        assertNull(locked.localAudioUri)
        assertTrue("울릴 때 강등 대상이 아니다 — 그 목소리의 클립·인사말을 찾는다", locked.usesFreeSystemVoiceAlarm())
    }

    /**
     * 매니페스트가 가운데 variant 를 빠뜨렸다(Codex #820) — 받아 둔 것을 순서대로 묶으면 뒤 자리가
     * 밀려 다른 날씨 조건을 튼다. 묶지 않고 테마만 남긴 오디오 없는 기본 목소리 알람이 된다.
     */
    @Test
    fun aManifestWithAMissingVariantIsNotBoundByPosition() = runBlocking {
        manifest = weatherClips(TEST_SECOND_SYSTEM_VOICE_ID).filter { it.variant != 4 }
        dao.upsert(rehearsalCloneAlarm())

        assertEquals(1, repository.lockPaidAlarmTalks())

        val locked = dao.getById("rehearsal-1")!!
        assertEquals(TEST_SECOND_SYSTEM_VOICE_ID, locked.voiceProfileId)
        assertEquals("weather", locked.bucketId)
        assertNull("밀린 세트를 묶지 않는다", locked.bucketClipKeysJson)
        assertNull(locked.ttsMessageId)
    }

    /**
     * 울릴 때도 같다 — 모자란 세트로 자리를 세지 않고 내장 인사말로 간다. 온전한 세트면 알람에
     * 적힌 날씨 조건 자리(1)의 클립이다.
     */
    @Test
    fun ringTimeFallbackNeverCountsPositionsInAnIncompleteWeatherSet() {
        val alarm = rehearsalCloneAlarm(voiceProfileId = TEST_SECOND_SYSTEM_VOICE_ID)

        manifest = weatherClips(TEST_SECOND_SYSTEM_VOICE_ID)
        assertEquals(
            "file:///audio/stock_$TEST_SECOND_SYSTEM_VOICE_ID-weather-1.mp3",
            clipSource().ringUri(alarm, "user-a"),
        )

        manifest = weatherClips(TEST_SECOND_SYSTEM_VOICE_ID).filter { it.variant != 0 }
        val uri = clipSource().ringUri(alarm, "user-a")
        assertTrue("다른 조건 대신 내장 인사말: $uri", uri!!.startsWith("android.resource://"))
    }

    @Test
    fun unlockRestoresThePaidVoiceAndQueuesASync() = runBlocking {
        val original = rehearsalCloneAlarm()
        dao.upsert(original)
        repository.lockPaidAlarmTalks()

        assertEquals(1, repository.unlockPaidAlarmTalks(expectedOwnerUserId = "user-a"))

        val restored = dao.getById("rehearsal-1")!!
        assertEquals(AlarmPlayModes.VOICE_ONLY, restored.playMode)
        assertEquals(TEST_CLONE_VOICE_ID, restored.voiceProfileId)
        assertEquals(original.localAudioUri, restored.localAudioUri)
        assertEquals(original.ttsMessageId, restored.ttsMessageId)
        assertEquals(original.bucketId, restored.bucketId)
        assertNull(restored.preLockPlayMode)
        assertFalse(restored.hasLockedPaidVoice())
        assertEquals(AlarmSyncStates.DIRTY, restored.syncState)
        assertEquals("원격 id 는 그대로", "remote-1", restored.remoteAlarmId)
    }

    @Test
    fun unlockNeverRestoresAnotherAccountsLock() = runBlocking {
        dao.upsert(rehearsalCloneAlarm())
        repository.lockPaidAlarmTalks()
        currentUser = "user-b"

        assertEquals(0, repository.unlockPaidAlarmTalks(expectedOwnerUserId = "user-b"))
        assertTrue(dao.getById("rehearsal-1")!!.hasLockedPaidVoice())
    }

    @Test
    fun whenTheOriginalVoiceIsGoneTheLockBecomesPermanentNotATone() = runBlocking {
        dao.upsert(rehearsalCloneAlarm())
        repository.lockPaidAlarmTalks()

        // 보관 기간이 지나 클론이 지워졌다 — 접근 가능한 목록에 없다.
        val degraded = repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-other"), expectedOwnerUserId = "user-a")

        assertEquals("소리가 바뀌지 않았으니 강등으로 세지 않는다", 0, degraded)
        val finalized = dao.getById("rehearsal-1")!!
        assertEquals(AlarmPlayModes.VOICE_ONLY, finalized.playMode)
        assertEquals(TEST_SECOND_SYSTEM_VOICE_ID, finalized.voiceProfileId)
        assertNull(finalized.preLockPlayMode)
        assertFalse(finalized.hasLockedPaidVoice())
        assertNotNull(finalized.bucketId)
    }

    /**
     * 확정은 보관본이 붙든 오디오를 **전부** 놓는다(Codex #820) — 테마 알람의 보관본은 클립 세트
     * 전체를 가리키는데, 대표 키만 지우면 지워진 목소리의 나머지 생성 음성이 30일 캐시 정리 때까지
     * 남는다. 목소리로 우는 다른 알람이 세트 안의 키를 쓰고 있으면 그것만 남긴다.
     */
    @Test
    fun finalizingReleasesEveryClipTheSnapshotHeld() = runBlocking {
        val store = AlarmAudioStore(context)
        val cloneKeys = (0..2).map { "stock_clone-weather-$it" }
        cloneKeys.forEach { key ->
            store.cacheGeneratedAudio(byteArrayOf(1, 2, 3), "mp3", rawAudioUri = null, cacheKey = key)
        }
        dao.upsert(rehearsalCloneAlarm(bucketClipKeysJson = encodeBucketClipKeys(cloneKeys)))
        repository.lockPaidAlarmTalks()
        // 잠금 뒤에 생긴, 다른(접근 가능한) 목소리의 알람이 세트의 마지막 키를 회전에 쓴다.
        dao.upsert(
            rehearsalCloneAlarm(
                id = "other",
                voiceProfileId = "clone-other",
                audioCacheKey = "stock_other-0",
                bucketClipKeysJson = encodeBucketClipKeys(listOf("stock_other-0", cloneKeys[2])),
            ),
        )

        repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-other"), expectedOwnerUserId = "user-a")

        assertFalse(dao.getById("rehearsal-1")!!.hasLockedPaidVoice())
        assertNull("대표 클립", store.getCachedAudio(cloneKeys[0]))
        assertNull("대표가 아닌 세트 클립도 지운다", store.getCachedAudio(cloneKeys[1]))
        assertNotNull("목소리로 우는 다른 알람이 쓰는 클립은 남긴다", store.getCachedAudio(cloneKeys[2]))
    }

    /**
     * 캐시 키 없이 파일 경로만 든 옛 행(마이그레이션 5→6 이전)의 보관본도 확정 때 놓는다(Codex #820) —
     * 키로는 셀 수 없어 경로(파일 이름)로 센다. 다른 알람이 같은 파일을 쓰면 남긴다.
     */
    @Test
    fun finalizingReleasesAKeylessSnapshotFileToo() = runBlocking {
        manifest = null
        val store = AlarmAudioStore(context)
        val exclusive = store.cacheGeneratedAudio(byteArrayOf(1, 2, 3), "mp3", rawAudioUri = null, cacheKey = "legacy-exclusive")
        val shared = store.cacheGeneratedAudio(byteArrayOf(4, 5, 6), "mp3", rawAudioUri = null, cacheKey = "legacy-shared")
        dao.upsert(rehearsalCloneAlarm(id = "keyless-1", audioCacheKey = null, localAudioUri = exclusive.localAudioUri))
        dao.upsert(rehearsalCloneAlarm(id = "keyless-2", audioCacheKey = null, localAudioUri = shared.localAudioUri))
        repository.lockPaidAlarmTalks()
        assertTrue("전제 — 키 없는 보관본", dao.getById("keyless-1")!!.lockedPaidVoice()?.audioCacheKey == null)
        // 잠금 뒤에 생긴, 다른(접근 가능한) 목소리의 알람이 같은 파일을 쓴다.
        dao.upsert(
            rehearsalCloneAlarm(
                id = "other",
                voiceProfileId = "clone-other",
                audioCacheKey = null,
                localAudioUri = shared.localAudioUri,
            ),
        )

        repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-other"), expectedOwnerUserId = "user-a")

        assertFalse(dao.getById("keyless-1")!!.hasLockedPaidVoice())
        assertNull("키 없는 보관본 파일도 지운다", store.getCachedAudio("legacy-exclusive"))
        assertNotNull("다른 알람이 쓰는 파일은 남긴다", store.getCachedAudio("legacy-shared"))
    }

    /**
     * 테마 없이 잠근 행은 직접 입력 판정에 걸리고 오디오 시각이 0 이다. 그 **대체 기본 목소리**가
     * 제자리 교체되면 낡은 직접 입력 알람으로 잡혀 알람음으로 내려가고 "직접 입력 알람이 기본
     * 알람음으로 바뀌었어요" 가 떴다 — 이 행에는 낡은 오디오가 하나도 없는데.
     */
    @Test
    fun theSubstituteVoicesInPlaceReplacementLeavesAnUnboundLockAlone() = runBlocking {
        manifest = null
        // 기본 인사말 종류 — 기본 목소리 테마가 없어 테마 없이 잠긴다.
        dao.upsert(rehearsalCloneAlarm(bucketId = "greeting", voiceRandomContext = "preset"))
        repository.lockPaidAlarmTalks()
        assertTrue("전제 — 이 행은 직접 입력 판정에 걸린다", dao.getById("rehearsal-1")!!.usesCustomMessageVoice())

        val degraded = repository.degradeCustomMessageAlarmsUsingVoiceProfile(
            voiceProfileId = TEST_SECOND_SYSTEM_VOICE_ID,
            expectedOwnerUserId = "user-a",
            allowSystemVoice = true,
            invalidatedBeforeMillis = System.currentTimeMillis() + 60_000L,
        )

        assertEquals("강등 안내에 세지 않는다", 0, degraded)
        val after = dao.getById("rehearsal-1")!!
        assertEquals(AlarmPlayModes.VOICE_ONLY, after.playMode)
        assertEquals("그대로 기본 목소리로 운다", TEST_SECOND_SYSTEM_VOICE_ID, after.voiceProfileId)
        assertEquals("복원할 원래 목소리도 그대로", TEST_CLONE_VOICE_ID, after.lockedPaidVoice()?.voiceProfileId)
    }

    /**
     * 기본 목소리로 친 직접 입력(유료 — 생성 오디오)을 잠근 뒤 그 기본 목소리가 제자리 교체되면
     * 보관본의 오디오가 낡았다 — 잠금을 **확정**한다. 같은 회차에 방금 풀린 그 행을 다시 강등
     * 후보로 읽으면 알람음으로 내려가 버린다(확정은 "기본 목소리로 남긴다" 가 규칙이다).
     */
    @Test
    fun aLockedManualAlarmOfTheReplacedVoiceIsFinalizedNotToned() = runBlocking {
        manifest = null
        dao.upsert(
            rehearsalCloneAlarm(
                voiceProfileId = TEST_SYSTEM_VOICE_ID,
                bucketId = null,
                voiceRandomContext = null,
                localAudioUri = "file:///tts/manual-1.mp3",
                audioCacheKey = "tts-manual-1",
                ttsMessageId = "manual-1",
            ),
        )
        assertEquals(1, repository.lockPaidAlarmTalks())

        val degraded = repository.degradeCustomMessageAlarmsUsingVoiceProfile(
            voiceProfileId = TEST_SYSTEM_VOICE_ID,
            expectedOwnerUserId = "user-a",
            allowSystemVoice = true,
            invalidatedBeforeMillis = System.currentTimeMillis() + 60_000L,
        )

        assertEquals(0, degraded)
        val after = dao.getById("rehearsal-1")!!
        assertEquals(AlarmPlayModes.VOICE_ONLY, after.playMode)
        assertEquals(TEST_SYSTEM_VOICE_ID, after.voiceProfileId)
        assertFalse("낡은 원래 오디오는 되살리지 않는다", after.hasLockedPaidVoice())
        assertNull(after.preLockPlayMode)
    }

    /**
     * 대체 목소리는 **미나 하나**다(2026-09-29 "미나로 통일도 해") — 그 계정이 마지막에 쓴 기본
     * 목소리(시우)를 따르지 않는다. 예전에는 잠금만 그 기억값을 따라, 같은 계정의 알람이 잠금이면
     * 시우·삭제면 미나처럼 경로마다 다른 목소리가 됐다.
     */
    @Test
    fun lockIgnoresTheLastUsedDefaultVoiceAndUsesMina() = runBlocking {
        DefaultVoicePreferenceStore(context).set("user-a", TEST_SYSTEM_VOICE_ID)
        dao.upsert(rehearsalCloneAlarm())

        assertEquals(1, repository.lockPaidAlarmTalks(expectedOwnerUserId = "user-a"))

        val locked = dao.getById("rehearsal-1")!!
        assertEquals("미나", bundledSystemVoiceProfiles().first { it.id == locked.voiceProfileId }.name)
        assertEquals("$SUBSTITUTE_SYSTEM_VOICE_ID-weather-0", locked.ttsMessageId)
    }

    /**
     * 목소리를 **잃은** 알람(삭제·공유 해제)은 알람음이 아니라 **미나**로 운다(2026-09-29 사용자 결정 —
     * "삭제했거나 공유가 해제된 알람은 기본 목소리로, 미나로 해 그냥"). 마지막에 쓴 기본 목소리(시우)를
     * 따르지 않는다. 테마·조건 자리는 그대로이고, 미나의 클립이 다 있으면 편집기와 같은 모양으로 묶는다.
     */
    @Test
    fun deletingTheVoiceTurnsItsAlarmIntoAMinaAlarmWithTheSameTheme() = runBlocking {
        DefaultVoicePreferenceStore(context).set("user-a", TEST_SYSTEM_VOICE_ID)
        val store = AlarmAudioStore(context)
        val cloneKeys = (0..2).map { "stock_clone-weather-$it" }
        cloneKeys.forEach { key ->
            store.cacheGeneratedAudio(byteArrayOf(1, 2, 3), "mp3", rawAudioUri = null, cacheKey = key)
        }
        dao.upsert(rehearsalCloneAlarm(audioCacheKey = cloneKeys[0], bucketClipKeysJson = encodeBucketClipKeys(cloneKeys)))

        assertEquals(1, repository.degradeAlarmsUsingVoiceProfile(TEST_CLONE_VOICE_ID))

        val after = dao.getById("rehearsal-1")!!
        assertEquals("미나", bundledSystemVoiceProfiles().first { it.id == after.voiceProfileId }.name)
        assertEquals(SUBSTITUTE_SYSTEM_VOICE_ID, after.voiceProfileId)
        assertEquals("'알람' 모드로 내리지 않는다", AlarmPlayModes.VOICE_ONLY, after.playMode)
        assertEquals("weather", after.bucketId)
        assertEquals("미나의 날씨 클립을 묶는다", "$SUBSTITUTE_SYSTEM_VOICE_ID-weather-0", after.ttsMessageId)
        assertEquals(9, after.bucketClipKeys().size)
        assertEquals("날씨 조건 자리는 그대로", 1, after.contextVariantIndex)
        assertNull("되돌릴 목소리가 없으니 표시·보관본을 남기지 않는다", after.preLockPlayMode)
        assertFalse(after.hasLockedPaidVoice())
        assertTrue("잃은 목소리의 클립은 전부 지운다", cloneKeys.all { store.getCachedAudio(it) == null })
    }

    /**
     * 기본 인사말·직접 입력 종류는 기본 목소리 테마가 없다 — 오디오 없는 미나 알람으로 두고, 울릴 때
     * 미나의 내장 인사말이 운다. 그 행은 낡을 오디오가 없으니 교체 표식이 다시 세지 않는다.
     */
    @Test
    fun aGreetingAlarmWhoseSharedVoiceWentAwayBecomesAnAudiolessMinaAlarm() = runBlocking {
        manifest = null
        dao.upsert(rehearsalCloneAlarm(bucketId = "greeting", voiceRandomContext = "preset"))

        assertEquals(
            1,
            repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-other"), expectedOwnerUserId = "user-a"),
        )

        val after = dao.getById("rehearsal-1")!!
        assertEquals(SUBSTITUTE_SYSTEM_VOICE_ID, after.voiceProfileId)
        assertEquals(AlarmPlayModes.VOICE_ONLY, after.playMode)
        assertNull("기본 목소리에는 greeting 테마가 없다", after.bucketId)
        assertFalse(after.hasOwnVoiceAudio())
        assertEquals(
            0,
            repository.degradeCustomMessageAlarmsUsingVoiceProfile(
                voiceProfileId = SUBSTITUTE_SYSTEM_VOICE_ID,
                expectedOwnerUserId = "user-a",
                allowSystemVoice = true,
            ),
        )
    }

    @Test
    fun aStillAccessibleOriginalVoiceKeepsTheLock() = runBlocking {
        dao.upsert(rehearsalCloneAlarm())
        repository.lockPaidAlarmTalks()

        repository.degradeAlarmsWithInaccessibleVoice(setOf(TEST_CLONE_VOICE_ID), expectedOwnerUserId = "user-a")

        assertTrue("보관 기간 안이면 복원할 수 있어야 한다", dao.getById("rehearsal-1")!!.hasLockedPaidVoice())
    }
}
