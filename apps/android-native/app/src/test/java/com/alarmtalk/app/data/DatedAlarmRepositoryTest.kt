package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.TimeZone
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **날짜 지정 알람(한 번)** — 저장소 쪽 규칙(`docs/spec/alarm-lifecycle.md` §4).
 *
 * 고른 시간대의 그 시각에 고정되고(기기 시간대가 바뀌어도), 지난 시각은 예약하지 않으며, 같은 시각 알람을 교체하지
 * 않고, 울린 뒤 해제하면 꺼진 채 남는다(다음 날 다시 울지 않는다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DatedAlarmRepositoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao
    private lateinit var originalZone: TimeZone

    private val repository by lazy {
        AlarmRepository(
            alarmDao = dao,
            holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
            holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
            alarmScheduler = AlarmScheduler(context),
            alarmAudioStore = AlarmAudioStore(context),
            context = context,
            currentUserIdProvider = { OWNER },
            ringingAlarmIdsProvider = { emptySet() },
        )
    }

    @Before
    fun setUp() {
        originalZone = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone(SEOUL))
        db = Room.inMemoryDatabaseBuilder(context, AlarmDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.alarmDao()
    }

    @After
    fun tearDown() {
        db.close()
        TimeZone.setDefault(originalZone)
    }

    /** 서울 기준 모레 07:30 — 언제 돌려도 미래다. */
    private val futureDate: LocalDate = ZonedDateTime.now(ZoneId.of(SEOUL)).toLocalDate().plusDays(2)
    private val futureFireAt: Long = ZonedDateTime.of(futureDate.atTime(7, 30), ZoneId.of(SEOUL))
        .toInstant().toEpochMilli()

    private fun datedDraft(date: LocalDate = futureDate, hour: Int = 7, minute: Int = 30) = AlarmDraft(
        label = "",
        hour = hour,
        minute = minute,
        repeatDaysMask = 0,
        snoozeMinutes = 5,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.ALARM_ONLY,
        targetDate = date.toString(),
        targetTimezone = SEOUL,
    )

    @Test
    fun 날짜_알람은_고른_날짜의_고정_시각으로_저장된다() = runBlocking {
        val saved = repository.createAlarm(datedDraft())

        assertEquals(futureFireAt, saved.fireAtMillis)
        assertEquals(0, saved.repeatDaysMask)
        assertFalse(saved.holidayOff)
        assertEquals(futureDate.toString(), saved.targetDate)
        assertEquals(SEOUL, saved.targetTimezone)
        assertEquals(futureDate.toString(), dao.getById(saved.id)?.targetDate)
    }

    @Test
    fun 지난_시각의_날짜_알람은_예약하지_않는다() = runBlocking {
        val yesterday = ZonedDateTime.now(ZoneId.of(SEOUL)).toLocalDate().minusDays(1)
        try {
            repository.createAlarm(datedDraft(date = yesterday))
            fail("지난 시각인데 저장됐다")
        } catch (_: DatedAlarmPastException) {
            // 기대한 거절
        }
        assertTrue(dao.getEnabledAlarms().isEmpty())
    }

    @Test
    fun 같은_시각_알람이_있으면_교체를_허락받아도_바꾸지_않는다() = runBlocking {
        val daily = repository.createAlarm(
            AlarmDraft(
                label = "",
                hour = 7,
                minute = 30,
                repeatDaysMask = 0x7f,
                snoozeMinutes = 5,
                vibrationPattern = VibrationPatterns.DEFAULT,
                playMode = AlarmPlayModes.ALARM_ONLY,
            ),
        )
        try {
            repository.createAlarm(datedDraft(), replaceExisting = true)
            fail("날짜 알람이 같은 시각의 반복 알람을 교체했다")
        } catch (error: DatedAlarmConflictException) {
            assertEquals(7, error.hour)
            assertEquals(30, error.minute)
        }
        val kept = requireNotNull(dao.getById(daily.id))
        assertTrue(kept.enabled)
        assertEquals(0x7f, kept.repeatDaysMask)
        assertEquals(1, dao.getEnabledAlarms().size)
    }

    @Test
    fun 기기_시간대가_바뀌어도_고른_시간대의_그_시각에_운다() = runBlocking {
        val saved = repository.createAlarm(datedDraft())
        // 여행 — 기기가 로스앤젤레스 시간대가 됐다. 반복 알람은 벽시계를 따라가지만 날짜 알람은 서울 07:30 그대로다.
        TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))

        repository.reschedulePendingAlarms(recomputeFireTime = true)

        val after = requireNotNull(dao.getById(saved.id))
        assertEquals(futureFireAt, after.fireAtMillis)
        assertTrue(after.enabled)
        assertEquals(AlarmStates.SCHEDULED, after.state)
    }

    @Test
    fun 울리지_못하고_지난_날짜_알람은_복구에서_끄고_실패로_남긴다() = runBlocking {
        val saved = repository.createAlarm(datedDraft())
        val past = ZonedDateTime.now(ZoneId.of(SEOUL)).toLocalDate().minusDays(1)
        // 폰이 꺼져 있던 사이 그 날짜가 지났다.
        dao.upsert(saved.copy(targetDate = past.toString(), fireAtMillis = 1_000L))

        repository.reschedulePendingAlarms()

        val after = requireNotNull(dao.getById(saved.id))
        assertFalse(after.enabled)
        assertEquals(AlarmStates.FAILED, after.state)
        assertEquals(past.toString(), after.targetDate)
    }

    @Test
    fun 해제하면_꺼진_채_목록에_남고_다음_날로_넘어가지_않는다() = runBlocking {
        val saved = repository.createAlarm(datedDraft())
        repository.markRinging(saved.id)
        repository.snooze(saved.id)
        val snoozed = requireNotNull(dao.getById(saved.id))
        assertEquals(AlarmStates.SNOOZED, snoozed.state)
        // 스누즈는 같은 회차다 — 날짜를 바꾸지 않는다.
        assertEquals(futureDate.toString(), snoozed.targetDate)

        repository.dismiss(saved.id)

        val after = requireNotNull(dao.getById(saved.id))
        assertFalse(after.enabled)
        assertEquals(AlarmStates.DISMISSED, after.state)
        assertEquals(0, after.repeatDaysMask)
        assertEquals(futureDate.toString(), after.targetDate)
    }

    @Test
    fun 날짜가_지난_날짜_알람은_다시_켜지_않는다() = runBlocking {
        val saved = repository.createAlarm(datedDraft())
        val past = ZonedDateTime.now(ZoneId.of(SEOUL)).toLocalDate().minusDays(1)
        dao.upsert(saved.copy(targetDate = past.toString(), enabled = false, state = AlarmStates.DISMISSED))

        try {
            repository.setEnabled(saved.id, enabled = true)
            fail("지난 날짜 알람이 켜졌다")
        } catch (_: DatedAlarmPastException) {
            // 기대한 거절
        }
        val after = requireNotNull(dao.getById(saved.id))
        assertFalse(after.enabled)
        assertEquals(AlarmStates.DISMISSED, after.state)
    }

    @Test
    fun 날짜를_지우고_요일을_고르면_반복_알람이_된다() = runBlocking {
        val saved = repository.createAlarm(datedDraft())

        val updated = repository.updateAlarm(
            saved.id,
            datedDraft().copy(repeatDaysMask = 0b0000010, targetDate = null, targetTimezone = null),
        )

        assertNull(updated.targetDate)
        assertNull(updated.targetTimezone)
        assertEquals(0b0000010, updated.repeatDaysMask)
        assertTrue(updated.fireAtMillis > System.currentTimeMillis())
    }

    private companion object {
        const val OWNER = "owner"
        const val SEOUL = "Asia/Seoul"
    }
}
