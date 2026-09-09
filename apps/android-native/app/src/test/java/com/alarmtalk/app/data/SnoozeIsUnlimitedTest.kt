package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **다시 울림은 무제한이다**(2026-09-09 지시. 이미 저장된 한도는 무시한다).
 *
 * ⚠ 이 회귀는 조용하다. 예전에는 `snooze()` 가 `snoozeRepeatLimit` 를 읽어 한도를 넘으면
 * null 을 돌려줬고, `RingingService.snooze` 는 null 을 '스누즈 불가' 로 읽어 **알람을
 * 해제해 버렸다** — 사용자가 '다시 울리기' 를 눌렀는데 알람이 꺼지는 것이다. 화면·알림에서
 * 횟수 UI 를 걷어낸 뒤에도 이 게이트만 남아 있어, **UI 는 무제한이라고 말하는데 4번째에
 * 알람이 끝나는** 상태였다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SnoozeIsUnlimitedTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao

    private val repository by lazy {
        AlarmRepository(
            alarmDao = dao,
            holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
            holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
            alarmScheduler = AlarmScheduler(context),
            alarmAudioStore = AlarmAudioStore(context),
            context = context,
            currentUserIdProvider = { "user-1" },
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
    fun tearDown() = db.close()

    private fun alarm(
        id: String,
        snoozeEnabled: Boolean = true,
        snoozeRepeatLimit: Int = SnoozeRepeatLimits.THREE,
        snoozeCount: Int = 0,
    ) = AlarmEntity(
        id = id,
        label = "아침",
        hour = 7,
        minute = 30,
        fireAtMillis = 1_000L,
        repeatDaysMask = 0,
        holidayOff = false,
        snoozeEnabled = snoozeEnabled,
        snoozeMinutes = 5,
        snoozeRepeatLimit = snoozeRepeatLimit,
        snoozeCount = snoozeCount,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = null,
        audioCacheKey = null,
        rawAudioUri = null,
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = "clone-a",
        voiceListenerTitle = null,
        voiceText = "일어날 시간이에요",
        voiceCategory = null,
        voiceLanguage = "ko",
        voiceRandomPrompt = false,
        voiceRandomContext = null,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = null,
        remoteAlarmId = null,
        lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.SYNCED,
        origin = AlarmOrigins.LOCAL_OWNED,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.RINGING,
        createdAtMillis = 0L,
        updatedAtMillis = 0L,
        ownerUserId = "user-1",
    )

    @Test
    fun 저장된_한도를_이미_넘겨도_계속_미룰_수_있다() = runBlocking {
        // 한도 3 에 이미 99번 미룬 알람 — 옛 규칙이라면 여기서 null 이 나고 알람이 꺼졌다.
        dao.upsert(alarm("a1", snoozeRepeatLimit = SnoozeRepeatLimits.THREE, snoozeCount = 99))

        val snoozed = repository.snooze("a1")

        assertNotNull("저장된 한도를 이유로 다시 울림이 거부됐다 — 무제한이어야 한다", snoozed)
        assertEquals(100, snoozed!!.snoozeCount)
        assertEquals(AlarmStates.SNOOZED, snoozed.state)
        assertTrue("다시 울림이 미래로 잡히지 않았다", snoozed.fireAtMillis > System.currentTimeMillis())
    }

    @Test
    fun 몇_번을_눌러도_계속_미뤄진다() = runBlocking {
        dao.upsert(alarm("a2", snoozeRepeatLimit = SnoozeRepeatLimits.THREE))

        repeat(10) { round ->
            assertNotNull("${round + 1}번째 다시 울림이 거부됐다", repository.snooze("a2"))
        }

        assertEquals(10, dao.getById("a2")!!.snoozeCount)
    }

    @Test
    fun 옛_행의_꺼진_스위치도_무시한다() = runBlocking {
        // 편집기에서 '다시 울림' 설정 자체를 없앴다(2026-09-09). 저장된 snoozeEnabled=false 는
        // 옛 행에만 남아 있고, 그걸 읽으면 그 알람만 '다시 울리기' 를 눌렀을 때 조용히 꺼진다 —
        // 켤 방법이 화면에 없으므로 영영 못 고친다.
        dao.upsert(alarm("a3", snoozeEnabled = false))

        assertNotNull("옛 행의 꺼진 스위치가 다시 울림을 막았다", repository.snooze("a3"))
    }

    @Test
    fun 없는_알람은_거부된다() = runBlocking {
        assertNull(repository.snooze("does-not-exist"))
    }
}
