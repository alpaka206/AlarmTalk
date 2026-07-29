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

    /** 마지막 로그인 계정 마커(실제로는 AuthSessionStore prefs). */
    private var lastSessionUser: String? = null

    private val repository by lazy { repositoryWith(dao) }

    private fun repositoryWith(alarmDao: AlarmDao) = AlarmRepository(
        alarmDao = alarmDao,
        holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
        holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
        alarmScheduler = AlarmScheduler(context),
        alarmAudioStore = AlarmAudioStore(context),
        context = context,
        currentUserIdProvider = { currentUser },
        previousSessionUserIdProvider = { lastSessionUser },
        onOwnershipSettled = { userId -> lastSessionUser = userId },
    )

    private val shadowAlarmManager
        get() = org.robolectric.Shadows.shadowOf(
            context.getSystemService(android.app.AlarmManager::class.java),
        )

    /** claimUnownedAlarms 만 실패하는 DAO — 소유자 정리 실패 경로 재현용. */
    private class ClaimFailingDao(real: AlarmDao) : AlarmDao by real {
        override suspend fun claimUnownedAlarms(userId: String): Int =
            throw android.database.sqlite.SQLiteException("disk full")
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

    /** 기본값은 ownerUserId 컬럼이 생기기 전에 만들어진 '소유자 미기록' 알람. */
    private suspend fun seedLegacyAlarm(
        id: String = "legacy-1",
        owner: String? = null,
    ): AlarmEntity {
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
            ownerUserId = owner,
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

    /**
     * 로그아웃의 안전 필수 단계는 '예약 취소'다. 소유자 새기기가 실패해도 취소는 반드시
     * 돌아야 한다 — 로그아웃하면 목록에서 감춰져 사용자가 끌 수 없는데 AlarmReceiver 는
     * Room 에서 바로 읽어 울린다(Codex #650).
     */
    @Test
    fun signOutCancelsReservationsEvenWhenOwnerStampingFails() = runBlocking {
        seedLegacyAlarm()
        currentUser = "account-A"
        repository.reschedulePendingAlarms()
        assertNotNull("전제: 알람이 예약돼 있다", shadowAlarmManager.peekNextScheduledAlarm())

        repositoryWith(ClaimFailingDao(dao)).detachAlarmsOnSignOut("account-A")

        assertNull(
            "떠나는 계정의 예약이 남으면 안 된다",
            shadowAlarmManager.peekNextScheduledAlarm(),
        )
    }

    /** 명시 로그아웃 경로도 같은 함수를 쓰도록 정리했으므로 그쪽 동작도 함께 고정한다. */
    @Test
    fun explicitSignOutAlsoStampsOwnerlessAlarms() = runBlocking {
        seedLegacyAlarm(id = "legacy-1")
        seedLegacyAlarm(id = "owned-by-b", owner = "account-B")

        val detached = repository.detachAlarmsOnSignOut("account-A")

        assertEquals("예약은 전부 내린다", 2, detached)
        assertEquals("account-A", ownerOf("legacy-1"))
        assertEquals("account-B", ownerOf("owned-by-b"))
    }

    /**
     * 401 이 알람 편집·스누즈·반복 알람 해제와 겹치면, 그쪽은 '소유자 없음' 스냅샷을 먼저
     * 읽고 claim 뒤에 전체행을 커밋한다. 그때 소유자가 null 로 되돌아가면 다음 계정이 다시
     * 물려받아 울린다 — 이 수정이 막으려던 그 경로 그대로다(Codex #650).
     */
    @Test
    fun staleWholeRowWriteCannotUndoTheClaim() = runBlocking {
        // 편집기/스누즈가 401 이전에 읽어 둔 스냅샷.
        val staleSnapshot = seedLegacyAlarm()
        repository.claimUnownedAlarmsFor("account-A")

        // 그 뒤에 커밋되는 전체행 쓰기.
        dao.upsert(
            staleSnapshot.copy(
                fireAtMillis = 999_000L,
                state = AlarmStates.SNOOZED,
                snoozeCount = 1,
            ),
        )

        val after = dao.getById("legacy-1")
        assertEquals("소유자가 null 로 되돌아가면 안 된다", "account-A", after?.ownerUserId)
        assertEquals("그 쓰기의 정상 변경은 그대로 반영된다", 999_000L, after?.fireAtMillis)
        assertEquals(AlarmStates.SNOOZED, after?.state)
    }

    /**
     * 로그인 뒤처리가 끝나기 전에 프로세스가 죽으면 마커가 그대로 남는다. 다음 콜드스타트는
     * 로그인 뒤처리를 타지 않고 곧장 재예약으로 가므로, 재예약 자체가 소유자를 먼저 확정해야
     * 앞 계정 알람을 새 계정이 물려받지 않는다(Codex #650).
     */
    @Test
    fun coldStartRescheduleSettlesOwnershipBeforeScheduling() = runBlocking {
        seedLegacyAlarm()
        lastSessionUser = "account-A"   // 앞 세션은 A 였고 소유자를 못 새긴 채 끝났다
        currentUser = "account-B"       // 이번 콜드스타트는 B 세션으로 복원된다

        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("B 세션에서 A 의 알람이 예약되면 안 된다", 0, scheduled)
        assertEquals("소유자는 앞 계정으로 확정된다", "account-A", ownerOf("legacy-1"))
        assertEquals("정리가 끝났으니 마커는 현재 계정으로 옮겨간다", "account-B", lastSessionUser)
    }

    /** 같은 계정이 다시 들어오면 레거시 알람은 그대로 자기 것이 된다(마커만 갱신). */
    @Test
    fun coldStartKeepsOwnerlessAlarmsForTheSameAccount() = runBlocking {
        seedLegacyAlarm()
        lastSessionUser = "account-A"
        currentUser = "account-A"

        val scheduled = repository.reschedulePendingAlarms()

        assertEquals(1, scheduled)
        assertNull("같은 계정이면 소유자를 억지로 박지 않는다", ownerOf("legacy-1"))
    }

    /**
     * 소유자 정리가 실패하면 (a) 미기록 행을 이번 회차에 예약하지 않고 (b) 마커를 그대로 둬
     * 다음 기회에 다시 시도해야 한다. 마커를 잃으면 재시도 근거가 영영 사라진다(Codex #650).
     */
    @Test
    fun failedSettlementSkipsOwnerlessAlarmsAndKeepsTheMarker() = runBlocking {
        seedLegacyAlarm()
        seedLegacyAlarm(id = "mine", owner = "account-B")
        lastSessionUser = "account-A"
        currentUser = "account-B"

        val scheduled = repositoryWith(ClaimFailingDao(dao)).reschedulePendingAlarms()

        assertEquals("내 알람만 예약된다 — 주인 모를 알람은 제외", 1, scheduled)
        assertNull("소유자는 여전히 미기록", ownerOf("legacy-1"))
        assertEquals("마커가 남아야 다음에 다시 시도할 수 있다", "account-A", lastSessionUser)
    }

    @Test
    fun claimIsNoOpWithoutASession() = runBlocking {
        seedLegacyAlarm()

        assertEquals(0, repository.claimUnownedAlarmsFor(null))
        assertEquals(0, repository.claimUnownedAlarmsFor("  "))
        assertNull("세션이 없으면 새길 계정도 없다", ownerOf("legacy-1"))
    }

    @Test
    fun claimTargetsOnlyOwnerlessRows() = runBlocking {
        seedLegacyAlarm(id = "legacy-1")
        seedLegacyAlarm(id = "legacy-2")
        seedLegacyAlarm(id = "owned-by-b", owner = "account-B")

        assertEquals(2, repository.claimUnownedAlarmsFor("account-A"))
        assertEquals("account-A", ownerOf("legacy-1"))
        assertEquals("account-A", ownerOf("legacy-2"))
        assertEquals("이미 소유자가 있는 행은 덮어쓰지 않는다", "account-B", ownerOf("owned-by-b"))
    }

    /**
     * 세션 만료 처리 중에도 리시버(발사·스누즈)·동기화 워커·사용자 편집이 같은 행을 쓴다.
     * 행 전체를 되쓰는 방식이면 그 사이 변경(fireAtMillis·enabled·state)이 옛 값으로
     * 되돌아가므로, 소유자 컬럼 하나만 바뀌는지 고정한다. updatedAtMillis 도 그대로여야
     * 한다 — 올리면 AlarmSyncService 의 낙관적 동시성이 '사용자 편집'으로 오인한다.
     */
    @Test
    fun claimOnlyTouchesTheOwnerColumn() = runBlocking {
        val before = seedLegacyAlarm()

        repository.claimUnownedAlarmsFor("account-A")

        val after = dao.getById(before.id)
        assertEquals(before.copy(ownerUserId = "account-A"), after)
    }
}
