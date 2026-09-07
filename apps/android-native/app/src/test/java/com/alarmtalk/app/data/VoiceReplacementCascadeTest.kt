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

    /**
     * ⚠ **표식과 비교하는 것은 오디오를 만든 시각이지 알람 행의 수정 시각이 아니다.**
     * 행의 `updatedAtMillis` 는 시각·이름만 고쳐도, **울리기만 해도**(`markRinging`)
     * 앞으로 간다 — 그걸 보면 매일 울리는 알람이 스스로 면제를 받아 지운 사람의 목소리로
     * 계속 울고, 표식은 0건 강등에도 확정되므로 다음 회차에 다시 잡히지도 않는다.
     */
    @Test
    fun replacementUsesAudioAgeNotRowUpdateTime() = runBlocking {
        val markerMillis = 2_000_000L
        // 오디오는 표식보다 **먼저** 만들었다 = 낡은 목소리다.
        writeCachedAudio("old-audio", createdAtMillis = markerMillis - 60_000L)
        // 그런데 그 뒤에 한 번 울려서 행의 수정 시각만 앞으로 갔다.
        dao.upsert(
            alarm(id = "rang-after-marker", voiceProfileId = "clone-1", cacheKey = "old-audio")
                .copy(updatedAtMillis = markerMillis + 60_000L),
        )
        // 이쪽은 표식 **뒤에** 만든 오디오다 = 새 목소리라 건드리면 안 된다.
        writeCachedAudio("new-audio", createdAtMillis = markerMillis + 30_000L)
        dao.upsert(
            alarm(id = "made-after-marker", voiceProfileId = "clone-1", cacheKey = "new-audio")
                .copy(updatedAtMillis = markerMillis - 60_000L),
        )

        val degraded = repository.degradeCustomMessageAlarmsUsingVoiceProfile(
            voiceProfileId = "clone-1",
            expectedOwnerUserId = "user-a",
            invalidatedBeforeMillis = markerMillis,
        )

        assertEquals(1, degraded)
        assertNull("울렸다는 이유로 면제되면 안 된다", dao.getById("rang-after-marker")?.voiceProfileId)
        assertEquals(
            "표식 뒤에 만든 오디오는 새 목소리다 — 건드리지 않는다",
            "clone-1",
            dao.getById("made-after-marker")?.voiceProfileId,
        )
    }

    /**
     * 표식을 넘기지 않으면 **표식 뒤에 만든 오디오까지** 깎인다. 전경 수렴 경로가 실제로
     * 그랬다(iOS 는 넘기고 있었다) — 강등은 되돌릴 수 없으므로 그 갈래를 고정한다.
     */
    @Test
    fun replacementWithoutWindowDegradesEvenFreshAudio() = runBlocking {
        val markerMillis = 2_000_000L
        writeCachedAudio("new-audio", createdAtMillis = markerMillis + 30_000L)
        dao.upsert(alarm(id = "fresh", voiceProfileId = "clone-1", cacheKey = "new-audio"))

        // 창을 넘기면 남는다.
        assertEquals(
            0,
            repository.degradeCustomMessageAlarmsUsingVoiceProfile(
                voiceProfileId = "clone-1",
                expectedOwnerUserId = "user-a",
                invalidatedBeforeMillis = markerMillis,
            ),
        )
        assertEquals("clone-1", dao.getById("fresh")?.voiceProfileId)

        // 안 넘기면 깎인다 — 그래서 전경 수렴 경로도 반드시 넘겨야 한다.
        assertEquals(
            1,
            repository.degradeCustomMessageAlarmsUsingVoiceProfile("clone-1", "user-a"),
        )
        assertNull(dao.getById("fresh")?.voiceProfileId)
    }

    private fun writeCachedAudio(cacheKey: String, createdAtMillis: Long) {
        val dir = java.io.File(context.filesDir, "alarm-audio").also { it.mkdirs() }
        val file = java.io.File(dir, "${AlarmAudioStore.safeCacheKey(cacheKey)}.mp3")
        file.writeBytes(byteArrayOf(1, 2, 3))
        file.setLastModified(createdAtMillis)
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
