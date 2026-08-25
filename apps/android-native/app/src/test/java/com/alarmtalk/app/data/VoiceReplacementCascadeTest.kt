package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **제자리 목소리 교체 — 직접 입력 알람만 내린다** (Codex #703 P1 회귀 방지).
 *
 * 교체는 옛 프로필 **행을 재사용**한다(id 가 그대로다). 그래서 접근권 대조
 * (`degradeAlarmsWithInaccessibleVoice`)로는 영원히 안 걸리고, 본인 소유 알람은 pull 대상도
 * 아니라 서버가 행을 내려도 그 기기에 닿지 않는다 — 놔두면 **지운 사람의 목소리로 계속 운다.**
 *
 * 반대로 넓히면 안 된다: 프리셋(버킷) 알람은 서버가 같은 message id 로 새 목소리를 다시 만들어
 * 게시하므로, 여기서 벗기면 되돌릴 수 없이 잃는다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceReplacementCascadeTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao
    private var currentUser: String? = "user-a"

    private val repository by lazy {
        AlarmRepository(
            alarmDao = dao,
            holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
            holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
            alarmScheduler = AlarmScheduler(context),
            alarmAudioStore = AlarmAudioStore(context),
            context = context,
            currentUserIdProvider = { currentUser },
            pendingOwnerUserIdProvider = { null },
            onOwnershipSettled = {},
        )
    }

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(context, AlarmDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.alarmDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun replacementDegradesOnlyCustomMessageAlarms() = runBlocking {
        dao.upsert(alarm(id = "custom", voiceProfileId = "clone-1"))
        dao.upsert(alarm(id = "bucket", voiceProfileId = "clone-1", bucketId = "medication"))
        dao.upsert(alarm(id = "random", voiceProfileId = "clone-1", randomPrompt = true))
        dao.upsert(alarm(id = "other-voice", voiceProfileId = "clone-2"))
        // 버킷 없이 프리셋 클립 하나만 물린 **옛 행** — 세 값이 직접 입력과 똑같아 보인다.
        dao.upsert(alarm(id = "legacy-clip", voiceProfileId = "clone-1", cacheKey = "stock_m-legacy"))

        val degraded = repository.degradeCustomMessageAlarmsUsingVoiceProfile("clone-1", "user-a")

        assertEquals("직접 입력 알람 하나만 내려야 한다", 1, degraded)
        assertNull(dao.getById("custom")?.voiceProfileId)
        assertEquals(AlarmPlayModes.ALARM_ONLY, dao.getById("custom")?.playMode)
        assertEquals(
            "프리셋(버킷) 알람은 새 목소리로 다시 만들어진다 — 벗기면 되돌릴 수 없다",
            "clone-1",
            dao.getById("bucket")?.voiceProfileId,
        )
        assertEquals("clone-1", dao.getById("random")?.voiceProfileId)
        assertEquals("clone-2", dao.getById("other-voice")?.voiceProfileId)
        assertEquals(
            "프리셋 클립 옛 행은 캐시 키(stock_)로 갈린다 — 벗기면 되돌릴 수 없다",
            "clone-1",
            dao.getById("legacy-clip")?.voiceProfileId,
        )
    }

    @Test
    fun replacementSkipsAnotherAccountsAlarms() = runBlocking {
        dao.upsert(alarm(id = "theirs", voiceProfileId = "clone-1", owner = "user-b"))
        currentUser = "user-a"

        val degraded = repository.degradeCustomMessageAlarmsUsingVoiceProfile("clone-1", "user-a")

        assertEquals(0, degraded)
        assertEquals("clone-1", dao.getById("theirs")?.voiceProfileId)
    }

    @Test
    fun replacementStopsWhenTheAccountChangedMidFlight() = runBlocking {
        dao.upsert(alarm(id = "mine", voiceProfileId = "clone-1"))
        currentUser = "user-b"

        // 목록을 확정한 계정과 지금 계정이 다르면 되돌릴 수 없는 강등을 하지 않는다.
        val degraded = repository.degradeCustomMessageAlarmsUsingVoiceProfile("clone-1", "user-a")

        assertEquals(0, degraded)
        assertEquals("clone-1", dao.getById("mine")?.voiceProfileId)
    }

    private fun alarm(
        id: String,
        voiceProfileId: String,
        owner: String? = "user-a",
        bucketId: String? = null,
        randomPrompt: Boolean = false,
        cacheKey: String? = null,
    ) = AlarmEntity(
        id = id,
        label = "voice alarm",
        hour = 7,
        minute = 30,
        fireAtMillis = 1_000L,
        repeatDaysMask = 0x7f,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 5,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
        snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = null,
        audioCacheKey = cacheKey,
        rawAudioUri = null,
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = voiceProfileId,
        voiceListenerTitle = null,
        voiceText = "좋은 아침",
        voiceCategory = "custom",
        voiceLanguage = null,
        voiceRandomPrompt = randomPrompt,
        voiceRandomContext = null,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = "m-$id",
        remoteAlarmId = null,
        lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.SYNCED,
        origin = AlarmOrigins.LOCAL_OWNED,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 1_000L,
        updatedAtMillis = 1_000L,
        ownerUserId = owner,
        bucketId = bucketId,
    )
}
