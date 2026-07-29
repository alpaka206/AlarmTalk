package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
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
 * 같은 기기에 남아 있는 **앞 계정** 알람을, 지금 로그인한 계정 기준으로 건드리면 안 된다
 * (Codex #646 P1 두 건).
 *
 * 로컬 알람은 로그아웃해도 지우지 않는다(원본이 기기다). 그래서 A 가 로그아웃하고 B 가
 * 로그인해도 A 의 행이 Room 에 그대로 있고, 전체 테이블을 훑는 작업은 그걸 B 의 것으로
 * 오인한다. 이 테스트는 두 경로를 막는다:
 *
 *  1. 목소리 강등 — B 의 접근 가능 목소리 목록에 A 의 프로필이 없는 건 당연한데, 그걸
 *     '접근권 상실'로 읽으면 A 의 목소리·캐시가 **영구히** 지워진다(되돌릴 수 없다).
 *  2. 아웃바운드 동기화 — A 가 오프라인에서 만든 LOCAL_ONLY 행을 B 의 JWT 로 올리면
 *     B 계정에 A 의 알람이 생기거나 404 재생성이 A 의 remoteAlarmId 를 갈아치운다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AlarmOwnerScopedOperationsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao
    private var currentUser: String? = null

    /** 아직 소유자를 못 새긴 알람의 임자(실제로는 AuthSessionStore prefs). */
    private var pendingOwner: String? = null

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
    )

    /** claimUnownedAlarms 만 실패하는 DAO — 임자 확정 실패 경로 재현용. */
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

    private suspend fun seedVoiceAlarm(
        id: String,
        owner: String?,
        voiceProfileId: String = "clone-a",
        syncState: String = AlarmSyncStates.SYNCED,
    ): AlarmEntity {
        val alarm = voiceAlarm(id, owner, voiceProfileId, syncState)
        dao.upsert(alarm)
        return alarm
    }

    private fun voiceAlarm(
        id: String,
        owner: String?,
        voiceProfileId: String? = "clone-a",
        syncState: String = AlarmSyncStates.SYNCED,
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
        playMode = AlarmPlayModes.ALARM_VOICE,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = null,
        audioCacheKey = null,
        rawAudioUri = null,
        voiceSource = if (voiceProfileId == null) VoiceSources.LOCAL_AUDIO else VoiceSources.TTS_PROFILE,
        voiceProfileId = voiceProfileId,
        voiceListenerTitle = null,
        voiceText = "좋은 아침",
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
        syncState = syncState,
        origin = AlarmOrigins.LOCAL_OWNED,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 1_000L,
        updatedAtMillis = 1_000L,
        ownerUserId = owner,
    )

    private suspend fun voiceOf(id: String): String? = dao.getById(id)?.voiceProfileId

    // ---------------------------------------------------------------- 목소리 강등

    @Test
    fun degradationSkipsAlarmsOwnedByAnotherAccount() = runBlocking {
        // A 가 로그아웃하고 B 가 로그인. A 의 알람은 Room 에 그대로 남는다.
        seedVoiceAlarm(id = "a-1", owner = "user-a", voiceProfileId = "clone-a")
        currentUser = "user-b"

        // B 의 접근 가능 목록에는 당연히 clone-a 가 없다.
        val degraded = repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-b"))

        assertEquals(0, degraded)
        assertEquals("clone-a", voiceOf("a-1"))
    }

    @Test
    fun degradationStillAppliesToTheActiveAccountsAlarms() = runBlocking {
        seedVoiceAlarm(id = "a-1", owner = "user-a", voiceProfileId = "clone-a")
        seedVoiceAlarm(id = "b-1", owner = "user-b", voiceProfileId = "clone-gone")
        currentUser = "user-b"

        val degraded = repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-b"))

        assertEquals("B 의 접근 불가 목소리만 강등된다", 1, degraded)
        assertNull(voiceOf("b-1"))
        assertEquals("A 의 알람은 그대로", "clone-a", voiceOf("a-1"))
        // 강등 마커(목록 배지)도 남아야 한다.
        assertEquals(AlarmPlayModes.ALARM_ONLY, dao.getById("b-1")?.playMode)
        assertEquals(AlarmPlayModes.ALARM_VOICE, dao.getById("b-1")?.preLockPlayMode)
    }

    @Test
    fun degradationAdoptsOwnerlessAlarmsWhenOwnershipIsSettled() = runBlocking {
        // 소유자 미기록(레거시) 행은 다른 규칙(observeAlarms·reschedulePendingAlarms)과 같이
        // 현재 계정 것으로 본다 — 임자 표시가 없다면 물려받을 앞 계정도 없다.
        seedVoiceAlarm(id = "legacy-1", owner = null, voiceProfileId = "clone-gone")
        currentUser = "user-b"
        pendingOwner = null

        assertEquals(1, repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-b")))
        assertNull(voiceOf("legacy-1"))
    }

    @Test
    fun degradationSettlesPendingOwnershipBeforeJudging() = runBlocking {
        // 401 로 A 의 세션만 끊겨 미기록 행이 남았고, 임자 표시는 A 다. B 가 로그인해 강등이
        // 돌면 먼저 A 로 새기고, 그 뒤엔 A 소유라 건드리지 않아야 한다.
        seedVoiceAlarm(id = "legacy-1", owner = null, voiceProfileId = "clone-a")
        currentUser = "user-b"
        pendingOwner = "user-a"

        val degraded = repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-b"))

        assertEquals(0, degraded)
        assertEquals("user-a", dao.getById("legacy-1")?.ownerUserId)
        assertEquals("clone-a", voiceOf("legacy-1"))
        assertNull("정리가 끝났으니 표시는 지워진다", pendingOwner)
    }

    @Test
    fun degradationSkipsOwnerlessAlarmsWhenSettlementFails() = runBlocking {
        // 임자 확정이 실패하면 그 null 이 누구 것인지 모른다 — 되돌릴 수 없는 강등은 미룬다.
        seedVoiceAlarm(id = "legacy-1", owner = null, voiceProfileId = "clone-a")
        currentUser = "user-b"
        pendingOwner = "user-a"

        val degraded = repositoryWith(ClaimFailingDao(dao))
            .degradeAlarmsWithInaccessibleVoice(setOf("clone-b"))

        assertEquals(0, degraded)
        assertEquals("clone-a", voiceOf("legacy-1"))
        assertNull("소유자는 아직 미기록", dao.getById("legacy-1")?.ownerUserId)
        assertEquals("표시가 남아 다음 기회에 다시 시도한다", "user-a", pendingOwner)
    }

    @Test
    fun degradationDoesNothingWithoutASignedInAccount() = runBlocking {
        seedVoiceAlarm(id = "a-1", owner = "user-a", voiceProfileId = "clone-a")
        currentUser = null

        assertEquals(0, repository.degradeAlarmsWithInaccessibleVoice(setOf("clone-b")))
        assertEquals("clone-a", voiceOf("a-1"))
    }

    @Test
    fun deletingAVoiceOnlyDegradesTheActiveAccountsAlarms() = runBlocking {
        // 같은 목소리 id 를 쓰는 앞 계정 알람이 남아 있어도, 삭제한 계정의 알람만 강등한다.
        seedVoiceAlarm(id = "a-1", owner = "user-a", voiceProfileId = "clone-x")
        seedVoiceAlarm(id = "b-1", owner = "user-b", voiceProfileId = "clone-x")
        currentUser = "user-b"

        assertEquals(1, repository.degradeAlarmsUsingVoiceProfile("clone-x"))

        assertNull(voiceOf("b-1"))
        assertEquals("clone-x", voiceOf("a-1"))
    }

    @Test
    fun systemVoiceAlarmsAreNeverDegraded() = runBlocking {
        // 회귀 방지: 소유자 게이트를 넣으면서 시스템(스톡) 보이스 보존 규칙이 깨지면 안 된다.
        val systemVoiceId = SYSTEM_VOICE_ID_PREFIX + "000000000001"
        seedVoiceAlarm(id = "b-1", owner = "user-b", voiceProfileId = systemVoiceId)
        currentUser = "user-b"

        assertEquals(0, repository.degradeAlarmsWithInaccessibleVoice(emptySet()))
        assertEquals(systemVoiceId, voiceOf("b-1"))
    }

    // ------------------------------------------------------------ 아웃바운드 동기화

    @Test
    fun outboundSyncSkipsRowsOwnedByAnotherAccount() {
        val a = voiceAlarm("a-1", owner = "user-a", syncState = AlarmSyncStates.LOCAL_ONLY)

        assertFalse(
            isOutboundSyncCandidate(a, ownerUserId = "user-b", adoptOwnerlessAlarms = true),
        )
    }

    @Test
    fun outboundSyncSendsTheActiveAccountsDirtyRows() {
        val mine = voiceAlarm("b-1", owner = "user-b", syncState = AlarmSyncStates.DIRTY)

        assertTrue(
            isOutboundSyncCandidate(mine, ownerUserId = "user-b", adoptOwnerlessAlarms = false),
        )
    }

    @Test
    fun outboundSyncAdoptsOwnerlessRowsOnlyWhenOwnershipIsSettled() {
        val legacy = voiceAlarm("legacy-1", owner = null, syncState = AlarmSyncStates.FAILED)

        assertTrue(
            isOutboundSyncCandidate(legacy, ownerUserId = "user-b", adoptOwnerlessAlarms = true),
        )
        assertFalse(
            "임자 미정인 행을 이 계정 서버에 올리면 안 된다",
            isOutboundSyncCandidate(legacy, ownerUserId = "user-b", adoptOwnerlessAlarms = false),
        )
    }

    @Test
    fun outboundSyncWithoutASessionOnlyConsidersOwnerlessRows() {
        val owned = voiceAlarm("a-1", owner = "user-a", syncState = AlarmSyncStates.LOCAL_ONLY)
        val legacy = voiceAlarm("legacy-1", owner = null, syncState = AlarmSyncStates.LOCAL_ONLY)

        assertFalse(isOutboundSyncCandidate(owned, ownerUserId = null, adoptOwnerlessAlarms = true))
        assertTrue(isOutboundSyncCandidate(legacy, ownerUserId = null, adoptOwnerlessAlarms = true))
    }

    @Test
    fun outboundSyncStillIgnoresSyncedAndReceivedRows() {
        // 회귀 방지: 소유자 게이트를 넣으면서 원래 조건(미반영 상태 · 내 소유 origin)이 느슨해지면 안 된다.
        val synced = voiceAlarm("b-1", owner = "user-b", syncState = AlarmSyncStates.SYNCED)
        val received = voiceAlarm("r-1", owner = "user-b", syncState = AlarmSyncStates.DIRTY)
            .copy(origin = AlarmOrigins.RECEIVED_REMOTE)

        assertFalse(isOutboundSyncCandidate(synced, "user-b", adoptOwnerlessAlarms = true))
        assertFalse(isOutboundSyncCandidate(received, "user-b", adoptOwnerlessAlarms = true))
    }

    // ------------------------------------------------- 같은 시각(HH:mm) 충돌 판정

    @Test
    fun anotherAccountsAlarmDoesNotBlockThisAccountsTimeSlot() = runBlocking {
        // A 의 07:30 알람은 B 에게 보이지 않는다(observeAlarms). 그런데 충돌 판정이 그걸
        // 세면 B 는 07:30 을 쓸 수 없고, 목록에 없으니 지울 수도 없다.
        seedVoiceAlarm(id = "a-1", owner = "user-a")
        currentUser = "user-b"

        assertEquals(0, dao.countAtTime(hour = 7, minute = 30, callerUserId = "user-b"))
        assertNull(dao.findAtTime(hour = 7, minute = 30, callerUserId = "user-b"))
    }

    @Test
    fun sameAccountAndLegacyAlarmsStillBlockTheTimeSlot() = runBlocking {
        // 회귀 방지: "한 시각에 알람 하나" 정책 자체는 그대로여야 한다.
        seedVoiceAlarm(id = "b-1", owner = "user-b")
        dao.upsert(voiceAlarm(id = "legacy-1", owner = null).copy(hour = 8))

        assertEquals(1, dao.countAtTime(hour = 7, minute = 30, callerUserId = "user-b"))
        assertEquals("b-1", dao.findAtTime(hour = 7, minute = 30, callerUserId = "user-b")?.id)
        // 소유자 미기록(레거시) 행도 현재 계정 것으로 본다 — 목록 노출 규칙과 같다.
        assertEquals(1, dao.countAtTime(hour = 8, minute = 30, callerUserId = "user-b"))
        assertEquals("legacy-1", dao.findAtTime(hour = 8, minute = 30, callerUserId = "user-b")?.id)
    }

    @Test
    fun excludingTheEditedAlarmStillWorksWithTheOwnerScope() = runBlocking {
        // 편집 시 자기 자신은 충돌 대상에서 빠져야 한다(기존 동작).
        seedVoiceAlarm(id = "b-1", owner = "user-b")

        assertEquals(
            0,
            dao.countAtTime(hour = 7, minute = 30, callerUserId = "user-b", excludeId = "b-1"),
        )
    }

    // -------------------------------------------- 무료 강등 잠금의 소유자 backfill

    @Test
    fun lockingDoesNotClaimAlarmsPendingForAnotherAccount() = runBlocking {
        // 잠금은 미기록 행에 소유자를 '영구히' 새긴다. 임자가 A 인데 B 로 새겨 버리면
        // 뒤늦은 확정(null 행만 대상)이 못 고쳐 A 가 알람을 영영 잃는다.
        seedVoiceAlarm(id = "legacy-1", owner = null, voiceProfileId = "clone-a")
        currentUser = "user-b"
        pendingOwner = "user-a"

        assertEquals(0, repository.lockPaidAlarmTalks())
        assertEquals("user-a", dao.getById("legacy-1")?.ownerUserId)
        assertNull(dao.getById("legacy-1")?.preLockPlayMode)
    }

    @Test
    fun lockingStillClaimsGenuinelyOwnerlessAlarms() = runBlocking {
        // 회귀 방지: 임자 표시가 없는 진짜 레거시 행은 예전대로 현재 계정으로 잠기고 새겨진다.
        seedVoiceAlarm(id = "legacy-1", owner = null, voiceProfileId = "clone-a")
        currentUser = "user-b"
        pendingOwner = null

        assertEquals(1, repository.lockPaidAlarmTalks())
        assertEquals("user-b", dao.getById("legacy-1")?.ownerUserId)
        assertEquals(AlarmPlayModes.ALARM_ONLY, dao.getById("legacy-1")?.playMode)
    }

    @Test
    fun ownerlessRowsStayPendingInsteadOfBeingClaimedByTheSyncPath() = runBlocking {
        // syncWithBackend 는 올리기 전에 임자를 확정한다. 확정에 성공하면 그 행은 주인 것이 되고,
        // 이번 세션의 후보에서 빠진다(위 isOutboundSyncCandidate 판정과 이어지는 부분).
        seedVoiceAlarm(id = "legacy-1", owner = null, syncState = AlarmSyncStates.LOCAL_ONLY)
        currentUser = "user-b"
        pendingOwner = "user-a"

        assertTrue(repository.settlePendingAlarmOwnership())

        assertEquals("user-a", dao.getById("legacy-1")?.ownerUserId)
        assertNotNull(dao.getById("legacy-1"))
        assertFalse(
            isOutboundSyncCandidate(dao.getById("legacy-1")!!, "user-b", adoptOwnerlessAlarms = true),
        )
    }
}
