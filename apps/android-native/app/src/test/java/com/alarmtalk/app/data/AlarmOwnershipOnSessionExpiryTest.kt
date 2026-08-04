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

    /** 아직 소유자를 못 새긴 알람의 임자(실제로는 AuthSessionStore prefs). */
    private var pendingOwner: String? = null

    /** 자동으로 세션이 끊긴 계정(실제로는 AuthSessionStore prefs). 비로그인 복원 대상. */
    private var sessionExpiredOwner: String? = null

    private val repository by lazy { repositoryWith(dao) }

    private fun repositoryWith(alarmDao: AlarmDao) = AlarmRepository(
        alarmDao = alarmDao,
        holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
        holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
        alarmScheduler = AlarmScheduler(context),
        alarmAudioStore = AlarmAudioStore(context),
        context = context,
        currentUserIdProvider = { currentUser },
        pendingOwnerUserIdProvider = { pendingOwner },
        onOwnershipSettled = { pendingOwner = null },
        sessionExpiredOwnerUserIdProvider = { sessionExpiredOwner },
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

    /**
     * 회귀 방지: **스토어 업데이트 뒤 세션이 끊겨 있어도 본인 알람은 다시 예약돼야 한다.**
     *
     * 업데이트는 OS 의 AlarmManager 등록을 전부 지우고 MY_PACKAGE_REPLACED 로 이 함수를
     * 부른다. 예전에는 비로그인일 때 취소만 건너뛰고 재예약까지 함께 건너뛰어서, 등록이
     * 이미 지워진 업데이트 직후에는 알람이 영영 울리지 않았다. 목록도 로그인 화면에 가려
     * 사용자가 되살릴 수단이 없었다.
     */
    @Test
    fun updateReschedulesOwnedAlarmsEvenWithoutSession() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        // 세션 만료(401) — 로그인은 끊겼지만 이 기기의 알람은 그대로다.
        currentUser = null
        sessionExpiredOwner = "account-A"
        // 업데이트 직후를 그대로 재현한다 — DB 에 행만 있고 OS 예약은 하나도 없는 상태.
        assertNull("전제: OS 예약이 비어 있다", shadowAlarmManager.peekNextScheduledAlarm())

        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("비로그인이어도 이 기기 알람은 재예약돼야 한다", 1, scheduled)
        assertEquals("소유자를 함부로 바꾸지 않는다", "account-A", ownerOf("legacy-1"))
    }

    /**
     * 위 완화가 '남의 알람이 남의 폰에서 울린다' 를 되살리지 않는지 함께 못 박는다.
     * 정리는 **다른 계정이 실제로 로그인한** 시점에 한다.
     */
    @Test
    fun anotherAccountSigningInStillLosesForeignAlarms() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        currentUser = null
        sessionExpiredOwner = "account-A"
        assertEquals("비로그인 구간에서는 살아 있다", 1, repository.reschedulePendingAlarms())

        currentUser = "account-B"
        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("B 가 로그인하면 A 의 알람은 재예약되지 않는다", 0, scheduled)
    }

    /**
     * 회귀 방지: **명시적 로그아웃으로 떼어낸 알람은 재로그인 전까지 되살리지 않는다.**
     *
     * detachAlarmsOnSignOut 은 예약만 취소하고 행은 enabled=1 로 남긴다(재로그인하면 그대로
     * 되살리려고). 그걸 '비로그인이니 이 기기 것' 으로 다루면 콜드스타트·부팅·업데이트마다
     * 되살아나, 로그인 화면 뒤에서 끌 수도 없이 울린다(Codex #665 P1).
     */
    @Test
    fun explicitlyDetachedAlarmsStayUnscheduledWhileSignedOut() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        currentUser = null
        sessionExpiredOwner = null // 명시적 로그아웃은 복원 대상을 지운다

        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("로그아웃으로 떼어낸 알람은 되살아나면 안 된다", 0, scheduled)
        assertEquals("행 자체는 남는다 — 재로그인하면 되살아나야 한다", "account-A", ownerOf("legacy-1"))
    }

    /**
     * 이 빌드 이전에 로그아웃한 기기 — 표시가 없다. 그 상태를 '떼어냄' 으로 보지 않으면
     * 업데이트하는 순간 소유자 있는 알람이 로그인 화면 뒤에서 되살아난다(Codex #665 P1).
     * 표시 자체의 기본값은 AuthSessionStore 가 세션 유무로 정해 주고, 여기서는 그 값이
     * 게이트에 그대로 먹히는지만 본다.
     */
    @Test
    fun legacySignedOutDeviceIsTreatedAsDetached() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        currentUser = null
        sessionExpiredOwner = null // 표시가 없던 기기 → 복원 대상 없음

        assertEquals("표시가 없던 기기도 되살리면 안 된다", 0, repository.reschedulePendingAlarms())
    }

    /**
     * 회귀 방지: 한 기기에 여러 계정이 오갔을 때, 되살아나는 건 **방금 만료된 계정** 것뿐이다.
     *
     * A 가 명시적으로 로그아웃 → B 가 로그인 → B 의 세션만 자동 만료. 복원 대상을 불리언으로
     * 두면 이 순간 A 의 알람까지 로그인 화면 뒤에서 함께 살아난다(Codex #665 P1).
     */
    @Test
    fun onlyTheExpiredAccountsAlarmsComeBackOnMultiAccountDevice() = runBlocking {
        seedLegacyAlarm(id = "a-1", owner = "account-A") // A 가 로그아웃하며 두고 간 행
        seedLegacyAlarm(id = "b-1", owner = "account-B") // B 가 쓰던 행

        // B 의 세션이 자동 만료됐다.
        currentUser = null
        sessionExpiredOwner = "account-B"

        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("B 것 하나만 되살아나야 한다", 1, scheduled)
        assertEquals("A 의 행은 그대로 남는다", "account-A", ownerOf("a-1"))
    }

    /** 그리고 그 사람이 다시 로그인하면 원래대로 되살아난다. */
    @Test
    fun detachedAlarmsComeBackAfterSigningInAgain() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        sessionExpiredOwner = null
        currentUser = null
        assertEquals("전제: 로그아웃 상태에서는 안 살아난다", 0, repository.reschedulePendingAlarms())

        // 다시 로그인 — onSignedIn 이 표시를 지우고 소유자가 일치한다.
        currentUser = "account-A"

        assertEquals("본인이 다시 로그인하면 그대로 되살아난다", 1, repository.reschedulePendingAlarms())
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

    /**
     * A 의 소유권이 미해결인 채로 B 가 들어와 쓰다 나가는 경우. 그 미기록 행들은 여전히
     * A 것이므로, 로그아웃이 떠나는 계정(B) 것으로 새기면 A 가 알람을 영영 잃는다(Codex #650).
     */
    @Test
    fun signOutDoesNotStealAlarmsPendingForAnotherAccount() = runBlocking {
        seedLegacyAlarm()
        pendingOwner = "account-A"
        currentUser = "account-B"

        repository.detachAlarmsOnSignOut("account-B")

        assertEquals("미기록 행은 임자(A) 것으로 확정돼야 한다", "account-A", ownerOf("legacy-1"))
        assertNull("정리가 끝났으니 임자 표시는 지워진다", pendingOwner)
    }

    /** 확정이 실패하면 떠나는 계정으로도 새기지 않고 표시를 남겨 다음 기회로 넘긴다. */
    @Test
    fun signOutKeepsPendingOwnerWhenSettlementFails() = runBlocking {
        seedLegacyAlarm()
        pendingOwner = "account-A"
        currentUser = "account-B"

        repositoryWith(ClaimFailingDao(dao)).detachAlarmsOnSignOut("account-B")

        assertNull("누구 것인지 모르면 아무에게도 새기지 않는다", ownerOf("legacy-1"))
        assertEquals("표시가 남아야 다음에 다시 시도할 수 있다", "account-A", pendingOwner)
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
        pendingOwner = "account-A"   // 앞 세션은 A 였고 소유자를 못 새긴 채 끝났다
        currentUser = "account-B"       // 이번 콜드스타트는 B 세션으로 복원된다

        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("B 세션에서 A 의 알람이 예약되면 안 된다", 0, scheduled)
        assertEquals("소유자는 앞 계정으로 확정된다", "account-A", ownerOf("legacy-1"))
        assertNull("정리가 끝났으니 임자 표시는 지워진다", pendingOwner)
    }

    /** 같은 계정이 다시 들어오면 레거시 알람은 그대로 자기 것이 된다(마커만 갱신). */
    @Test
    fun coldStartKeepsOwnerlessAlarmsForTheSameAccount() = runBlocking {
        seedLegacyAlarm()
        pendingOwner = "account-A"
        currentUser = "account-A"

        val scheduled = repository.reschedulePendingAlarms()

        assertEquals(1, scheduled)
        assertNull("같은 계정이면 소유자를 억지로 박지 않는다", ownerOf("legacy-1"))
    }

    /**
     * 소유자 확정이 이 함수 안에서야 성공하는 경우가 있다(로그인 뒤처리의 첫 시도가 실패한 뒤
     * 재시도가 성공). 그때 앞서 돈 cancelAlarmsNotOwnedBy 는 아직 미기록이던 행을 건너뛴 뒤라,
     * 재예약이 '건너뛰기'만 하면 앞 계정의 OS 예약이 살아남아 이 계정 폰에서 울린다(Codex #650).
     */
    @Test
    fun rescheduleCancelsReservationsOwnedByAnotherAccount() = runBlocking {
        seedLegacyAlarm()
        currentUser = "account-A"
        repository.reschedulePendingAlarms()
        assertNotNull("전제: A 세션에서 예약이 잡혀 있다", shadowAlarmManager.peekNextScheduledAlarm())

        // A 세션이 끝날 때 소유자 새기기가 실패해 임자 표시만 남은 상태.
        pendingOwner = "account-A"
        // B 로그인 — 이 재예약 안에서 소유자가 A 로 확정된다.
        currentUser = "account-B"
        val scheduled = repository.reschedulePendingAlarms()

        assertEquals(0, scheduled)
        assertEquals("account-A", ownerOf("legacy-1"))
        assertNull("남의 계정 예약은 내려가야 한다", shadowAlarmManager.peekNextScheduledAlarm())
    }

    /**
     * 자동 401 은 예약을 일부러 살려 둔다 — 알람 전달이 서버 인증 상태에 묶이면 안 된다.
     * 위 취소가 비로그인 상태까지 번지면 본인 알람이 조용히 안 울린다.
     */
    @Test
    fun signedOutRescheduleKeepsExistingReservations() = runBlocking {
        seedLegacyAlarm(id = "legacy-1", owner = "account-A")
        currentUser = "account-A"
        repository.reschedulePendingAlarms()
        assertNotNull("전제: 예약이 잡혀 있다", shadowAlarmManager.peekNextScheduledAlarm())

        currentUser = null   // 401 로 세션만 끊긴 상태
        sessionExpiredOwner = "account-A"
        repository.reschedulePendingAlarms()

        assertNotNull(
            "비로그인 상태에서 본인 예약을 내리면 안 된다",
            shadowAlarmManager.peekNextScheduledAlarm(),
        )
    }

    /**
     * 소유자 정리가 실패하면 (a) 미기록 행을 이번 회차에 예약하지 않고 (b) 마커를 그대로 둬
     * 다음 기회에 다시 시도해야 한다. 마커를 잃으면 재시도 근거가 영영 사라진다(Codex #650).
     */
    @Test
    fun failedSettlementSkipsOwnerlessAlarmsAndKeepsTheMarker() = runBlocking {
        seedLegacyAlarm()
        seedLegacyAlarm(id = "mine", owner = "account-B")
        pendingOwner = "account-A"
        currentUser = "account-B"

        val scheduled = repositoryWith(ClaimFailingDao(dao)).reschedulePendingAlarms()

        assertEquals("내 알람만 예약된다 — 주인 모를 알람은 제외", 1, scheduled)
        assertNull("소유자는 여전히 미기록", ownerOf("legacy-1"))
        assertEquals("표시가 남아야 다음에 다시 시도할 수 있다", "account-A", pendingOwner)
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
