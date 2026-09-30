package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.HolidayApi
import com.alarmtalk.app.network.HolidayDto
import com.alarmtalk.app.network.HolidayResponse
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 공휴일 국가(= 지역의 나라)가 바뀌면 **이미 잡힌** '공휴일엔 끄기' 알람을 새 달력으로 다시 잡는가
 * (`AlarmRepository.refreshHolidayOffAlarms`).
 *
 * 다음 발생은 저장·해제 순간의 달력으로 행에 박힌다. 나라만 바뀌고 다시 잡지 않으면 **옛 나라의
 * 달력**으로 한 번 더 돈다 — 새 나라의 공휴일에 울리고, 옛 나라의 공휴일(이제 평일)은 건너뛴다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HolidayCountryRescheduleTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val zone: ZoneId = ZoneId.systemDefault()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao
    private lateinit var holidayCountry: HolidayCountryPreferenceStore

    /** 나라별로 서버가 돌려줄 공휴일. 받은 요청 수도 센다. */
    private val serverHolidays = mutableMapOf<String, List<LocalDate>>()
    private val holidayRequests = mutableListOf<String>()

    private val fakeHolidayApi = object : HolidayApi {
        override suspend fun getHolidays(country: String, from: String, to: String, lang: String?): HolidayResponse {
            holidayRequests += country
            return HolidayResponse(
                holidays = serverHolidays[country].orEmpty().map { date ->
                    HolidayDto(date = date.toString(), name = "holiday", type = "public")
                },
            )
        }
    }

    private val repository by lazy {
        AlarmRepository(
            alarmDao = dao,
            holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
            holidayCountryPreferenceStore = holidayCountry,
            alarmScheduler = AlarmScheduler(context),
            alarmAudioStore = AlarmAudioStore(context),
            context = context,
            holidayApiProvider = { fakeHolidayApi },
            currentUserIdProvider = { OWNER },
            ringingAlarmIdsProvider = { emptySet() },
        )
    }

    // 세 시간 뒤의 시·분 — 매일 반복 알람의 '공휴일이 없을 때' 다음 발생(D)이 오늘이든 내일이든 미래다.
    private val alarmTime: ZonedDateTime = ZonedDateTime.now(zone).plusHours(3)
    private val hour = alarmTime.hour
    private val minute = alarmTime.minute

    /** 공휴일이 하나도 없을 때의 다음 발생(D). */
    private val nextWithoutHolidays: Long = AlarmTimeCalculator.nextFireAtMillis(
        hour = hour,
        minute = minute,
        repeatDaysMask = EVERY_DAY,
        holidayOff = true,
        isHoliday = { false },
    )
    private val nextDay: Long = Instant.ofEpochMilli(nextWithoutHolidays).atZone(zone).plusDays(1)
        .toInstant().toEpochMilli()

    private fun dateOf(millis: Long): LocalDate = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(context, AlarmDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.alarmDao()
        holidayCountry = HolidayCountryPreferenceStore(context)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun 새_나라의_공휴일에_잡혀_있던_알람은_그날을_건너뛴다() = runBlocking {
        seed(id = "holiday-off", fireAtMillis = nextWithoutHolidays, holidayOff = true)
        // 지역을 도쿄로 옮겼다 — D 가 일본의 공휴일이다(한국 달력에서는 평일이라 D 로 잡혀 있었다).
        serverHolidays["JP"] = listOf(dateOf(nextWithoutHolidays))
        holidayCountry.setCountry("JP")

        repository.refreshHolidayOffAlarms()

        val moved = requireNotNull(dao.getById("holiday-off"))
        assertEquals(nextDay, moved.fireAtMillis)
        assertEquals(AlarmStates.SCHEDULED, moved.state)
        // 사용자의 편집이 아니다 — 받은 가족 알람이 '수신자가 고쳤다' 로 읽히면 안 된다.
        assertEquals(SEEDED_UPDATED_AT, moved.updatedAtMillis)
        assertEquals(listOf("JP"), holidayRequests)
    }

    @Test
    fun 옛_나라의_공휴일이라_건너뛰었던_날은_되돌아온다() = runBlocking {
        // 옛 나라에서는 D 가 공휴일이라 D+1 로 잡혀 있었다. 새 나라(미국)에는 그날 공휴일이 없다.
        seed(id = "holiday-off", fireAtMillis = nextDay, holidayOff = true)
        serverHolidays["US"] = emptyList()
        holidayCountry.setCountry("US")

        repository.refreshHolidayOffAlarms()

        assertEquals(nextWithoutHolidays, dao.getById("holiday-off")?.fireAtMillis)
    }

    @Test
    fun 다시_불러도_결과가_같고_받은_달력을_다시_받지_않는다() = runBlocking {
        seed(id = "holiday-off", fireAtMillis = nextWithoutHolidays, holidayOff = true)
        serverHolidays["JP"] = listOf(dateOf(nextWithoutHolidays))
        holidayCountry.setCountry("JP")

        repository.refreshHolidayOffAlarms()
        val first = requireNotNull(dao.getById("holiday-off"))
        repository.refreshHolidayOffAlarms()
        val second = requireNotNull(dao.getById("holiday-off"))

        assertEquals(first, second)
        // 두 번째에는 캐시가 있어 서버를 부르지 않는다.
        assertEquals(listOf("JP"), holidayRequests)
    }

    @Test
    fun 공휴일_끄기가_아닌_알람과_일회성_알람은_건드리지_않는다() = runBlocking {
        seed(id = "every-day", fireAtMillis = nextWithoutHolidays, holidayOff = false)
        seed(id = "one-shot", fireAtMillis = nextWithoutHolidays, holidayOff = true, repeatDaysMask = 0)
        serverHolidays["JP"] = listOf(dateOf(nextWithoutHolidays))
        holidayCountry.setCountry("JP")

        repository.refreshHolidayOffAlarms()

        assertEquals(nextWithoutHolidays, dao.getById("every-day")?.fireAtMillis)
        assertEquals(nextWithoutHolidays, dao.getById("one-shot")?.fireAtMillis)
        assertEquals(SEEDED_UPDATED_AT, dao.getById("every-day")?.updatedAtMillis)
    }

    @Test
    fun 다시_울림_중인_알람은_그_마감_그대로_둔다() = runBlocking {
        val snoozeDeadline = System.currentTimeMillis() + 5 * 60_000L
        seed(
            id = "snoozed",
            fireAtMillis = snoozeDeadline,
            holidayOff = true,
            state = AlarmStates.SNOOZED,
        )
        serverHolidays["JP"] = listOf(dateOf(snoozeDeadline))
        holidayCountry.setCountry("JP")

        repository.refreshHolidayOffAlarms()

        assertEquals(snoozeDeadline, dao.getById("snoozed")?.fireAtMillis)
    }

    private suspend fun seed(
        id: String,
        fireAtMillis: Long,
        holidayOff: Boolean,
        repeatDaysMask: Int = EVERY_DAY,
        state: String = AlarmStates.SCHEDULED,
    ) {
        dao.upsert(
            AlarmEntity(
                id = id,
                label = id,
                hour = hour,
                minute = minute,
                fireAtMillis = fireAtMillis,
                repeatDaysMask = repeatDaysMask,
                holidayOff = holidayOff,
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
                createdAtMillis = SEEDED_UPDATED_AT,
                updatedAtMillis = SEEDED_UPDATED_AT,
                ownerUserId = OWNER,
            ),
        )
    }

    private companion object {
        const val OWNER = "owner"
        const val EVERY_DAY = 0x7f
        const val SEEDED_UPDATED_AT = 1_000L
    }
}
