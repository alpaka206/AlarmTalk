package com.alarmtalk.app.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.RemoteAlarm
import com.alarmtalk.app.network.RemoteAlarmResponse
import java.lang.reflect.Proxy
import kotlinx.coroutines.runBlocking
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AlarmSyncServiceTest {
    private lateinit var database: AlarmDatabase
    private lateinit var dao: AlarmDao

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AlarmDatabase::class.java)
            .allowMainThreadQueries().build()
        dao = database.alarmDao()
    }

    @After
    fun tearDown() { database.close() }

    private fun api(handler: (String) -> Any): AlarmTalkApi = Proxy.newProxyInstance(
        AlarmTalkApi::class.java.classLoader, arrayOf(AlarmTalkApi::class.java),
    ) { _, method, _ -> handler(method.name) } as AlarmTalkApi

    @Test
    fun unauthorizedStopsBeforeRemainingAlarms() = runBlocking {
        repeat(3) { dao.upsert(alarm("alarm-$it")) }
        var requests = 0
        val client = api {
            requests += 1
            throw HttpException(Response.error<Any>(401, "{}".toResponseBody()))
        }

        val result = AlarmSyncService(dao).syncWithBackend(client, "expired", "owner", false)

        assertEquals(1, requests)
        assertEquals(1, result.failed)
        assertEquals(2, dao.getAllAlarms().count { it.syncState == AlarmSyncStates.LOCAL_ONLY })
    }

    @Test
    fun serverErrorsDoNotPreventOtherAlarmsFromSyncing() = runBlocking {
        repeat(3) { dao.upsert(alarm("alarm-$it")) }
        var requests = 0
        val client = api {
            requests += 1
            throw HttpException(Response.error<Any>(500, "{}".toResponseBody()))
        }
        AlarmSyncService(dao).syncWithBackend(client, "token", "owner", false)
        assertEquals(3, requests)
    }

    @Test
    fun replayedCreatePatchesCurrentLocalSnapshot() = runBlocking {
        dao.upsert(alarm("local"))
        val requests = mutableListOf<String>()
        val client = api { method ->
            requests.add(method)
            RemoteAlarmResponse(RemoteAlarm(id = "remote", creationReplayed = method == "createAlarm"))
        }
        AlarmSyncService(dao).syncWithBackend(client, "token", "owner", false)
        assertEquals(listOf("createAlarm", "updateAlarm"), requests)
        assertEquals("remote", dao.getById("local")?.remoteAlarmId)
        assertEquals(AlarmSyncStates.SYNCED, dao.getById("local")?.syncState)
    }

    private fun alarm(id: String) = AlarmEntity(
        id = id, label = "alarm", hour = 7, minute = 0, fireAtMillis = 0L,
        repeatDaysMask = 0, holidayOff = false, snoozeEnabled = true, snoozeMinutes = 5,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE, snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT, playMode = AlarmPlayModes.ALARM_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = null, audioCacheKey = null, rawAudioUri = null,
        voiceSource = VoiceSources.TTS_PROFILE, voiceProfileId = null,
        voiceListenerTitle = null, voiceText = null, voiceCategory = null, voiceLanguage = "ko",
        voiceRandomPrompt = false, voiceRandomContext = null, voiceWeatherCountry = null,
        voiceWeatherCity = null, voiceFortuneGender = null, voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null, dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true, voiceVolumePercent = 100, ttsMessageId = null,
        remoteAlarmId = null, lastSyncedAtMillis = null, syncState = AlarmSyncStates.LOCAL_ONLY,
        origin = AlarmOrigins.LOCAL_OWNED, alarmVolumePercent = 100,
        alarmSoundUri = null, alarmSoundLabel = null, enabled = true, state = AlarmStates.SCHEDULED,
        createdAtMillis = 0L, updatedAtMillis = 0L, ownerUserId = "owner",
    )
}
