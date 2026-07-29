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
 * 자동 401 로 세션이 끊긴 뒤 **다른** 계정이 로그인했을 때, 앞 계정의 알람이 울리면 안 된다
 * (Codex #646 P1).
 *
 * 소유자 미기록(레거시 null) 행은 reschedulePendingAlarms·observeAlarms 가 '현재 계정 것'으로
 * 보는데, 로그인 시 정리를 맡는 cancelAlarmsNotOwnedBy 는 소유자 없는 행을 건너뛴다. 401 은
 * 예약을 일부러 살려 두므로, 그 사이 소유자를 안 새기면 다음 계정이 앞 계정 알람을 물려받아
 * 예약·발사한다. claimUnownedAlarmsFor 가 세션 종료 시점에 그 창을 닫는다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AlarmOwnershipOnSessionExpiryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao
    private var currentUser: String? = null

    private val repository by lazy {
        AlarmRepository(
            alarmDao = dao,
            holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
            holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
            alarmScheduler = AlarmScheduler(context),
            alarmAudioStore = AlarmAudioStore(context),
            context = context,
            currentUserIdProvider = { currentUser },
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

    /** ownerUserId 컬럼이 생기기 전에 만들어진 '소유자 미기록' 알람. */
    private suspend fun seedLegacyAlarm(id: String = "legacy-1"): AlarmEntity {
        val alarm = AlarmEntity(
            id = id,
            label = "legacy alarm",
            hour = 7,
            minute = 30,
            // 반복 알람이라 과거 시각이어도 다음 발생으로 재계산돼 예약된다.
            fireAtMillis = 1_000L,
            repeatDaysMask = 0x7f,
            holidayOff = false,
            snoozeEnabled = true,
            snoozeMinutes = 5,
            snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
            snoozeCount = 0,
            vibrationPattern = VibrationPatterns.DEFAULT,
            playMode = AlarmPlayModes.ALARM_ONLY,
            defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
            localAudioUri = null,
            audioCacheKey = null,
            rawAudioUri = null,
            voiceSource = VoiceSources.LOCAL_AUDIO,
            voiceProfileId = null,
            voiceListenerTitle = null,
            voiceText = null,
            voiceCategory = null,
            voiceLanguage = null,
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
            syncState = AlarmSyncStates.LOCAL_ONLY,
            origin = AlarmOrigins.LOCAL_OWNED,
            alarmVolumePercent = 100,
            alarmSoundUri = null,
            alarmSoundLabel = null,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = 1_000L,
            updatedAtMillis = 1_000L,
            // 레거시 행의 핵심 조건.
            ownerUserId = null,
        )
        dao.upsert(alarm)
        return alarm
    }

    private suspend fun ownerOf(id: String): String? = dao.getById(id)?.ownerUserId

    @Test
    fun sessionExpiryStampsLeavingAccountOnOwnerlessAlarms() = runBlocking {
        seedLegacyAlarm()
        assertNull("전제: 레거시 행은 소유자가 없다", ownerOf("legacy-1"))

        val claimed = repository.claimUnownedAlarmsFor("account-A")

        assertEquals(1, claimed)
        assertEquals("account-A", ownerOf("legacy-1"))
    }

    @Test
    fun otherAccountCannotAdoptAlarmsAfterSessionExpiry() = runBlocking {
        seedLegacyAlarm()
        // A 의 세션이 401 로 끊긴다 — 예약은 그대로 두고 소유자만 새긴다.
        repository.claimUnownedAlarmsFor("account-A")

        // 이제 B 가 로그인한다.
        currentUser = "account-B"
        val cancelled = repository.cancelAlarmsNotOwnedBy("account-B")
        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("B 로그인 시 A 의 알람 예약이 내려가야 한다", 1, cancelled)
        assertEquals("A 의 알람이 B 세션에서 재예약되면 안 된다", 0, scheduled)
        assertEquals("소유자는 A 그대로", "account-A", ownerOf("legacy-1"))
    }

    @Test
    fun sameAccountKeepsItsAlarmsAfterSigningBackIn() = runBlocking {
        seedLegacyAlarm()
        repository.claimUnownedAlarmsFor("account-A")

        // 같은 사람이 다시 로그인하는 흔한 경우 — 알람이 그대로 살아나야 한다.
        currentUser = "account-A"
        val cancelled = repository.cancelAlarmsNotOwnedBy("account-A")
        val scheduled = repository.reschedulePendingAlarms()

        assertEquals(0, cancelled)
        assertEquals("본인 재로그인 시에는 그대로 재예약된다", 1, scheduled)
    }

    @Test
    fun claimIsNoOpWithoutASession() = runBlocking {
        seedLegacyAlarm()

        assertEquals(0, repository.claimUnownedAlarmsFor(null))
        assertEquals(0, repository.claimUnownedAlarmsFor("  "))
        assertNull("세션이 없으면 새길 계정도 없다", ownerOf("legacy-1"))
    }

    @Test
    fun claimDoesNotOverwriteAnExistingOwner() = runBlocking {
        val alarm = seedLegacyAlarm()
        dao.upsert(alarm.copy(ownerUserId = "account-A"))

        assertEquals(0, repository.claimUnownedAlarmsFor("account-B"))
        assertEquals("account-A", ownerOf("legacy-1"))
    }
}
