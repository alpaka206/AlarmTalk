package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
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

    /** 지금 실제로 울리는 중인 알람(실제로는 RingingService.activeRingingAlarmId). */
    private var ringingAlarmId: String? = null

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
        ringingAlarmIdProvider = { ringingAlarmId },
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
        repeatDaysMask: Int = 0x7f,
        state: String = AlarmStates.SCHEDULED,
    ): AlarmEntity {
        val alarm = AlarmEntity(
            id = id,
            label = "legacy alarm",
            hour = 7,
            minute = 30,
            // 기본값은 반복 알람이라 과거 시각이어도 다음 발생으로 재계산돼 예약된다.
            fireAtMillis = 1_000L,
            repeatDaysMask = repeatDaysMask,
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
            state = state,
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

    /**
     * 회귀 방지: 소유자 각인 쓰기가 실패해도, **비로그인이면** 재예약을 막지 않는다.
     *
     * 이 가지는 "미기록 행을 지금 계정 것으로 볼 근거가 없다" 를 막으려는 것인데, 지금 계정이
     * 없으면 잘못 넘겨줄 상대도 없다. 업데이트 직후에 여기 걸리면 지울 예약도 이미 없는 채로
     * 재예약만 통째로 건너뛰어 알람이 안 울린다.
     *
     * 단, 명시적 로그아웃에서 각인까지 실패한 행은 임자가 미정인 채 떼어진 상태다. 그걸
     * '비로그인이니 이 기기 것' 으로 보면 워커가 다음 회차에 로그인 화면 뒤에서 되살린다
     * (Codex #666 P1).
     */
    @Test
    fun ownershipWriteFailureStaysUnscheduledAfterExplicitLogout() = runBlocking {
        seedLegacyAlarm() // 소유자 미기록
        pendingOwner = "account-A"
        currentUser = null
        sessionExpiredOwner = null // 명시적 로그아웃 — 복원 대상이 없다

        val failing = repositoryWith(ClaimFailingDao(dao))

        assertEquals("로그아웃 뒤 각인 실패 행은 되살리면 안 된다", 0, failing.reschedulePendingAlarms())
    }

    /**
     * 회귀 방지: **굳어 버린 RINGING 행이 영구히 배제되면 안 된다.**
     *
     * RINGING 을 벗어나게 하는 쓰기는 dismiss/snooze/토글/편집뿐인데, 울리는 도중 FGS 가
     * 죽거나 재부팅되면 그 쓰기가 일어나지 않는다. `state == RINGING` 만 보고 건너뛰면
     * 이 함수가 유일한 복구 길목이라 그 알람은 다시는 안 울린다 — 목록에는 켜져 보인다.
     * 실제로 울리는 중인지로 판정해야 자가치유가 유지된다.
     */
    @Test
    fun staleRingingRowStillGetsRescheduled() = runBlocking {
        seedLegacyAlarm(owner = "account-A", state = AlarmStates.RINGING)
        currentUser = "account-A"

        // 지금 울리는 알람은 없다(서비스가 죽은 뒤 남은 상태).
        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("굳어 버린 RINGING 행도 다시 예약돼야 한다", 1, scheduled)
        val after = dao.getById("legacy-1")
        assertEquals("다음 발생으로 재계산돼 정상 상태로 돌아온다", AlarmStates.SCHEDULED, after?.state)
    }

    /**
     * 로그아웃 **뒤에** 복원이 돌면 아무것도 되살리지 않는다(순차 경로).
     *
     * 로그아웃은 예약만 취소하고 행은 enabled 로 남기므로, 워커가 그 뒤에 다시 예약하면
     * 로그인 화면 뒤에서 끌 수 없는 알람이 울린다.
     *
     * 이 테스트는 **겹침을 검증하지 않는다** — 두 호출이 순차라서 락이 없어도 통과한다.
     * 이름이 `logoutAndRestoreDoNotInterleave` 였을 때는 그걸 검증하는 것처럼 읽혀,
     * `restoreMutex` 를 통째로 지워도 초록인데 아무도 몰랐다. 진짜 직렬화 검증은
     * [restoreParkedMidwayCannotResurrectWhatSignOutJustCancelled] 다.
     */
    @Test
    fun sequentialLogoutThenRestoreSchedulesNothing() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        currentUser = "account-A"
        repository.reschedulePendingAlarms()
        assertNotNull("전제: 예약이 잡혀 있다", shadowAlarmManager.peekNextScheduledAlarm())

        // 로그아웃: 복원 대상을 지우고 예약을 떼어낸다(MainViewModel.clearSignedInSession 순서).
        currentUser = null
        sessionExpiredOwner = null
        repository.detachAlarmsOnSignOut("account-A")

        // 그 뒤에 워커가 돌아도 되살아나면 안 된다.
        val scheduled = repository.reschedulePendingAlarms()

        assertEquals("로그아웃 뒤 복원은 아무것도 예약하지 않는다", 0, scheduled)
        assertNull(
            "떼어낸 예약이 되살아나면 안 된다",
            shadowAlarmManager.peekNextScheduledAlarm(),
        )
    }

    /**
     * 회귀 방지: **복원이 한창일 때 로그아웃이 끼어들지 못한다**(Codex #666 P1).
     *
     * 이 겹침이 실제 버그의 모양이다 — 워커가 '내 알람이다' 까지 판정한 뒤 사용자가 로그아웃하면,
     * detach 가 예약을 취소해도 워커가 이어서 다시 예약한다. 행은 enabled 로 남으므로 '쓰기 직전
     * 재조회' 로는 못 잡고 직렬화만이 답이다.
     *
     * 복원을 소유자 판정 **이후**(`getById`) 에 세워 두는 이유: `getEnabledAlarms` 에 세우면
     * 아직 `currentUser` 를 읽기 전이라 락이 없어도 통과해 버려, 테스트가 또 착시가 된다.
     *
     * `restoreMutex` 를 지우면 첫 단언(로그아웃이 못 끝난다)이 먼저 깨지고, 그걸 통과시켜도
     * 복원이 재개돼 예약을 다시 걸므로 두 번째 단언이 깨진다.
     */
    @Test
    fun restoreParkedMidwayCannotResurrectWhatSignOutJustCancelled() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        currentUser = "account-A"

        val insideRestore = CompletableDeferred<Unit>()
        val releaseRestore = CompletableDeferred<Unit>()
        val gated = object : AlarmDao by dao {
            override suspend fun getById(id: String): AlarmEntity? {
                val row = dao.getById(id)
                // 첫 호출만 세운다(complete 는 최초 1회만 true).
                if (insideRestore.complete(Unit)) releaseRestore.await()
                return row
            }
        }
        // ★ 두 호출이 **같은 인스턴스**여야 한다 — Mutex 는 인스턴스별이다.
        val repo = repositoryWith(gated)

        val restore = launch(Dispatchers.Default) { repo.reschedulePendingAlarms() }
        insideRestore.await()

        // 복원이 소유자 판정을 끝내고 멈춰 있는 지금, 사용자가 로그아웃한다.
        val signOut = launch(Dispatchers.Default) {
            repo.detachAlarmsOnSignOut("account-A") {
                currentUser = null
                sessionExpiredOwner = null
            }
        }
        assertNull(
            "락이 있으면 로그아웃은 복원이 끝나기 전엔 시작조차 못 한다",
            withTimeoutOrNull(300) { signOut.join() },
        )

        releaseRestore.complete(Unit)
        restore.join()
        signOut.join()

        assertNull(
            "떼어낸 예약이 되살아나면 안 된다",
            shadowAlarmManager.peekNextScheduledAlarm(),
        )
    }

    /**
     * 회귀 방지: **로그아웃은 세션 정리까지 락 안에서 끝낸다**(Codex #666).
     *
     * 세션 비우기를 락 밖(호출 반환 뒤)으로 빼면, 락을 기다리던 복원이 깨어났을 때 prefs 를
     * 아직 '로그인됨' 으로 읽어 방금 떼어낸 알람을 전부 되살린다. 예약 취소와 세션 전환이
     * 한 임계구역이어야 하는 이유다.
     *
     * 이 테스트는 세션 전환을 **오직 `clearSessionInsideLock` 람다 안에서만** 한다. 본문에서
     * `currentUser` 를 손으로 먼저 바꾸면 그 순간 이 불변식은 검증 불가능해진다 — 락이
     * 세션 전환을 덮든 말든 결과가 같아지기 때문이다.
     */
    @Test
    fun signOutClearsTheSessionBeforeReleasingTheRestoreLock() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        currentUser = "account-A"

        val insideDetach = CompletableDeferred<Unit>()
        val releaseDetach = CompletableDeferred<Unit>()
        val gated = object : AlarmDao by dao {
            override suspend fun getAllAlarms(): List<AlarmEntity> {
                val rows = dao.getAllAlarms()
                if (insideDetach.complete(Unit)) releaseDetach.await()
                return rows
            }
        }
        val repo = repositoryWith(gated)

        repo.reschedulePendingAlarms()
        assertNotNull("전제: 예약이 잡혀 있다", shadowAlarmManager.peekNextScheduledAlarm())

        val signOut = launch(Dispatchers.Default) {
            repo.detachAlarmsOnSignOut("account-A") {
                // 세션 전환은 여기서만 일어난다 — 락 안이다.
                currentUser = null
                sessionExpiredOwner = null
            }
        }
        insideDetach.await()

        // 락을 기다리는 복원(정합성 워커에 해당).
        val worker = launch(Dispatchers.Default) { repo.reschedulePendingAlarms() }
        releaseDetach.complete(Unit)
        signOut.join()
        worker.join()

        assertNull(
            "락을 이어받은 복원은 이미 비로그인 상태를 봐야 한다",
            shadowAlarmManager.peekNextScheduledAlarm(),
        )
    }

    /**
     * 회귀 방지: 세션 정리 람다가 던져도 로그아웃의 예약 해제는 그대로 유효하다.
     *
     * 저장소 쓰기 실패(디스크 가득참 등)로 예약이 살아남으면, 사용자는 로그인 화면 뒤에서
     * 끌 수 없는 알람을 맞는다 — 세션 정리 실패가 알람 해제까지 되돌려선 안 된다.
     */
    @Test
    fun sessionClearFailureStillLeavesAlarmsDetached() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        currentUser = "account-A"
        repository.reschedulePendingAlarms()
        assertNotNull("전제: 예약이 잡혀 있다", shadowAlarmManager.peekNextScheduledAlarm())

        val detached = repository.detachAlarmsOnSignOut("account-A") {
            currentUser = null
            sessionExpiredOwner = null
            throw IllegalStateException("session store write failed")
        }

        assertEquals("떼어낸 알람 수는 그대로 보고된다", 1, detached)
        assertNull(
            "세션 정리가 실패해도 예약은 내려가 있어야 한다",
            shadowAlarmManager.peekNextScheduledAlarm(),
        )
    }

    /**
     * 회귀 방지: 워커가 목록을 읽은 뒤 사용자가 끈 알람을 되살리지 않는다(Codex #666 P2).
     * 여기서는 그 창을 좁히는 '쓰기 직전 재조회' 가 실제로 도는지를, DAO 를 갈아 끼워 본다.
     */
    @Test
    fun alarmDisabledAfterSnapshotIsNotRescheduled() = runBlocking {
        seedLegacyAlarm(owner = "account-A")
        currentUser = "account-A"

        // getEnabledAlarms 는 켜진 스냅샷을 주지만, 그 뒤 getById 는 '방금 꺼진' 행을 준다.
        val racing = object : AlarmDao by dao {
            override suspend fun getById(id: String): AlarmEntity? =
                dao.getById(id)?.copy(enabled = false)
        }

        assertEquals("스냅샷 뒤 꺼진 알람은 예약하지 않는다", 0, repositoryWith(racing).reschedulePendingAlarms())
    }

    @Test
    fun ownershipWriteFailureDoesNotBlockRescheduleWhileSignedOut() = runBlocking {
        seedLegacyAlarm() // 소유자 미기록
        pendingOwner = "account-A" // 각인 대상이 있으나
        currentUser = null // 지금 로그인한 계정은 없다
        sessionExpiredOwner = "account-A" // 자동 401 — 그 임자가 곧 복원 대상이다

        // claimUnownedAlarms 가 실패하는 DAO — ownershipSettled = false 가 된다.
        val failing = repositoryWith(ClaimFailingDao(dao))
        val scheduled = failing.reschedulePendingAlarms()

        assertEquals("각인 실패와 무관하게 이 기기 알람은 예약돼야 한다", 1, scheduled)
    }

    /**
     * 회귀 방지: **지금 울리는 중인 알람을 꺼 버리지 않는다.**
     *
     * RINGING 은 enabled=true 이고 fireAtMillis 가 이미 과거라, 반복 없는 알람이면 '놓친 알람'
     * 가지로 떨어져 enabled=false·FAILED 가 된다. 예약 정합성 워커가 주기적으로 이 함수를
     * 부르면서 사용자가 듣고 있는 알람과 겹칠 수 있다.
     */
    @Test
    fun ringingOneShotAlarmIsNotDisabledByReschedule() = runBlocking {
        seedLegacyAlarm(
            owner = "account-A",
            repeatDaysMask = 0, // 반복 없음 — 과거 시각이면 원래 꺼지는 조건
            state = AlarmStates.RINGING,
        )
        currentUser = "account-A"
        ringingAlarmId = "legacy-1" // 지금 실제로 울리는 중

        val scheduled = repository.reschedulePendingAlarms()

        val after = dao.getById("legacy-1")
        assertEquals("울리는 중인 알람은 그대로 켜져 있어야 한다", true, after?.enabled)
        assertEquals("상태도 RINGING 그대로", AlarmStates.RINGING, after?.state)
        // 과거 시각 그대로 다시 예약하면 즉시 재발화한다 — 사용자가 그 사이 껐다면 되살아난다.
        assertEquals("울리는 중인 알람은 예약 대상이 아니다", 0, scheduled)
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
