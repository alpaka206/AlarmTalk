package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **재바인딩이 올린 `DIRTY` 를 DAO 가 도로 내리지 않는지** 고정한다(2026-09-03 리뷰 6차).
 *
 * `upsertPreservingServerSyncFields` 는 이름 그대로 **서버가 발급한 필드**를 보존한다.
 * 거기에 `syncState` 를 끼워 넣으면 재바인딩이 세운 `DIRTY` 가 매번 옛 `SYNCED` 로
 * 되돌아가, 고친 알람이 **영영 서버에 안 올라간다** — 화면에는 아무 표시도 안 난다.
 *
 * 이 저장소가 반복해서 밟은 모양이다: 한쪽에서 고친 값을 다른 쪽이 조용히 되덮는다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RebindSyncStatePersistenceTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao

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
    fun 재바인딩이_세운_DIRTY_는_보존_병합을_지나도_남는다() = runBlocking {
        val synced = alarm(syncState = AlarmSyncStates.SYNCED, remoteAlarmId = "remote-1")
        dao.upsert(synced)

        // 재바인더가 하는 일 — 클립을 갈아 끼우고 동기 상태를 다시 센다.
        val rebound = synced.copy(
            bucketClipKeysJson = encodeBucketClipKeys(listOf("stock_new-0", "stock_new-1")),
            ttsMessageId = "new-0",
        )
        dao.upsertPreservingServerSyncFields(
            rebound.copy(syncState = rebound.nextLocalSyncState()),
        )

        val stored = dao.getById(synced.id)!!
        assertEquals(AlarmSyncStates.DIRTY, stored.syncState)
        // 서버 발급 필드는 그대로 보존된다 — 그게 이 헬퍼의 본래 일이다.
        assertEquals("remote-1", stored.remoteAlarmId)
        assertEquals("new-0", stored.ttsMessageId)
    }

    @Test
    fun 받은_알람은_재바인딩해도_올리지_않는다() = runBlocking {
        val received = alarm(
            id = "b",
            syncState = AlarmSyncStates.SYNCED,
            remoteAlarmId = "remote-2",
            origin = AlarmOrigins.RECEIVED_REMOTE,
        )
        dao.upsert(received)
        dao.upsertPreservingServerSyncFields(
            received.copy(syncState = received.nextLocalSyncState()),
        )
        assertEquals(AlarmSyncStates.SYNCED, dao.getById(received.id)!!.syncState)
    }

    private fun alarm(
        id: String = "a",
        syncState: String,
        remoteAlarmId: String?,
        origin: String = AlarmOrigins.LOCAL_OWNED,
    ) = AlarmEntity(
        id = id,
        label = "bucket",
        hour = 7,
        minute = 0,
        fireAtMillis = 0L,
        repeatDaysMask = 0,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 5,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
        snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = "file://clip0.mp3",
        audioCacheKey = "stock_old-0",
        rawAudioUri = "r2://clip0.mp3",
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = "clone-profile",
        voiceListenerTitle = null,
        voiceText = "클립 문구",
        voiceCategory = "custom",
        voiceLanguage = "ko",
        voiceRandomPrompt = false,
        voiceRandomContext = "wake_weather",
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = "old-0",
        bucketId = "cheer",
        bucketClipKeysJson = encodeBucketClipKeys(listOf("stock_old-0")),
        remoteAlarmId = remoteAlarmId,
        lastSyncedAtMillis = 1L,
        syncState = syncState,
        origin = origin,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 0L,
        updatedAtMillis = 0L,
    )
}
