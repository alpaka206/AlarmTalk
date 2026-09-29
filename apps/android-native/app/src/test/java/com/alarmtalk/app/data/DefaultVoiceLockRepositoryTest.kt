package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.StockClip
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
    private var lastUsedVoice: String? = TEST_SECOND_SYSTEM_VOICE_ID
    private var manifest: List<StockClip>? = null

    private val repository by lazy {
        AlarmRepository(
            alarmDao = dao,
            holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
            holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
            alarmScheduler = AlarmScheduler(context),
            alarmAudioStore = AlarmAudioStore(context),
            context = context,
            currentUserIdProvider = { currentUser },
            defaultVoiceClipSource = DefaultVoiceClipSource(
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
                manifestClips = { manifest },
                lastUsedVoiceId = { lastUsedVoice },
                deviceVoiceLanguage = { "ko" },
            ),
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
        assertEquals("마지막에 쓴 기본 목소리", TEST_SECOND_SYSTEM_VOICE_ID, locked.voiceProfileId)
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
        assertNull(locked.bucketId)
        assertNull(locked.localAudioUri)
        assertTrue("울릴 때 강등 대상이 아니다 — 그 목소리의 클립·인사말을 찾는다", locked.usesFreeSystemVoiceAlarm())
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

    @Test
    fun aStillAccessibleOriginalVoiceKeepsTheLock() = runBlocking {
        dao.upsert(rehearsalCloneAlarm())
        repository.lockPaidAlarmTalks()

        repository.degradeAlarmsWithInaccessibleVoice(setOf(TEST_CLONE_VOICE_ID), expectedOwnerUserId = "user-a")

        assertTrue("보관 기간 안이면 복원할 수 있어야 한다", dao.getById("rehearsal-1")!!.hasLockedPaidVoice())
    }
}
