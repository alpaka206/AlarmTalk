package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VibrationPatterns
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 편집기의 **날짜 지정(한 번)** — `docs/spec/alarm-editor.md` §2-1, `alarm-lifecycle.md` §4-3.
 * 요일과 배타적이고, 저장을 누르는 순간 지난 시각·같은 시각 알람을 알럿으로 막는다(교체를 묻지 않는다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DatedAlarmEditorTest {
    private val seoul: ZoneId = ZoneId.of("Asia/Seoul")

    private fun millis(value: String, zone: ZoneId = seoul): Long =
        LocalDateTime.parse(value).atZone(zone).toInstant().toEpochMilli()

    @Test
    fun `날짜 고르기의 오늘은 알람의 시간대로 잰다`() {
        // 서울은 10/27 01:00 인데 로스앤젤레스는 아직 10/26 09:00 — 로스앤젤레스 알람은 10/26 을 고를 수 있어야 한다(코덱스 #955).
        val now = millis("2026-10-27T01:00")
        assertEquals(LocalDate.of(2026, 10, 26), datedPickerToday("America/Los_Angeles", now))
        assertEquals(LocalDate.of(2026, 10, 27), datedPickerToday("Asia/Seoul", now))
    }

    private fun editor(hour: Int = 7, minute: Int = 30): AlarmEditorState =
        AlarmEditorState.from(null, defaultPlayMode = AlarmPlayModes.ALARM_ONLY).also {
            it.hour = hour
            it.minute = minute
        }

    @Test
    fun 새_알람은_날짜_지정_없이_열린다() {
        val state = editor()
        assertFalse(state.isDated)
        assertNull(state.toDraft().targetDate)
    }

    @Test
    fun 날짜_지정을_켜면_요일이_풀리고_아직이면_오늘_지났으면_내일로_시작한다() {
        val state = editor(hour = 7, minute = 30)
        state.repeatDaysMask = 0b0111110
        state.holidayOff = true

        state.enterDatedMode(nowMillis = millis("2026-10-26T06:00:00"), zoneId = seoul)
        assertTrue(state.isDated)
        assertEquals(0, state.repeatDaysMask)
        assertFalse(state.holidayOff)
        assertEquals(LocalDate.of(2026, 10, 26), state.targetDate)
        assertEquals("Asia/Seoul", state.targetTimezone)

        state.enterDatedMode(nowMillis = millis("2026-10-26T08:00:00"), zoneId = seoul)
        assertEquals(LocalDate.of(2026, 10, 27), state.targetDate)
    }

    @Test
    fun 요일을_누르면_날짜_지정이_꺼진다() {
        val state = editor()
        state.enterDatedMode(nowMillis = millis("2026-10-26T06:00:00"), zoneId = seoul)

        state.toggleRepeatDay(1)

        assertFalse(state.isDated)
        assertEquals(0b0000010, state.repeatDaysMask)
        assertNull(state.toDraft().targetDate)
    }

    @Test
    fun 날짜를_다시_골라도_시간대는_확인한_값이다() {
        val state = editor()
        state.enterDatedMode(nowMillis = millis("2026-10-26T06:00:00"), zoneId = seoul)

        state.selectTargetDate(LocalDate.of(2026, 11, 3))

        val draft = state.toDraft()
        assertEquals("2026-11-03", draft.targetDate)
        assertEquals("Asia/Seoul", draft.targetTimezone)
        assertEquals(0, draft.repeatDaysMask)
    }

    @Test
    fun 저장된_날짜_알람은_그_날짜와_시간대로_열린다() {
        val state = AlarmEditorState.from(
            alarmEntity(targetDate = "2026-11-03", targetTimezone = "Europe/London"),
        )
        assertTrue(state.isDated)
        assertEquals(LocalDate.of(2026, 11, 3), state.targetDate)
        assertEquals("Europe/London", state.targetTimezone)
    }

    @Test
    fun 누르는_순간_지난_시각이면_막는다() {
        val state = editor(hour = 7, minute = 30)
        state.enterDatedMode(nowMillis = millis("2026-10-26T06:00:00"), zoneId = seoul)

        assertNull(datedSaveBlockReason(state, emptySet(), nowMillis = millis("2026-10-26T07:29:00")))
        // 편집하는 사이 그 시각이 지났다.
        assertEquals(
            SaveBlockReason.DATED_TIME_PASSED,
            datedSaveBlockReason(state, emptySet(), nowMillis = millis("2026-10-26T07:30:00")),
        )
    }

    @Test
    fun 같은_시각의_다른_알람이_있으면_교체하지_않고_막는다() {
        val state = editor(hour = 7, minute = 30)
        state.enterDatedMode(nowMillis = millis("2026-10-26T06:00:00"), zoneId = seoul)

        assertEquals(
            SaveBlockReason.DATED_TIME_CONFLICT,
            datedSaveBlockReason(state, setOf(7 to 30), nowMillis = millis("2026-10-26T06:00:00")),
        )
        assertNull(datedSaveBlockReason(state, setOf(7 to 31), nowMillis = millis("2026-10-26T06:00:00")))
    }

    @Test
    fun 날짜_알람이_아니면_날짜_사유가_없다() {
        assertNull(datedSaveBlockReason(editor(), setOf(7 to 30)))
    }

    @Test
    fun 날짜_알람_막기_알럿은_전용_문구를_쓴다() {
        assertEquals(
            R.string.editor_block_dated_past_title to R.string.editor_block_dated_past_message,
            saveBlockAlertStrings(SaveBlockReason.DATED_TIME_PASSED),
        )
        assertEquals(
            R.string.editor_block_dated_conflict_title to R.string.editor_block_dated_conflict_message,
            saveBlockAlertStrings(SaveBlockReason.DATED_TIME_CONFLICT),
        )
    }

    private fun alarmEntity(targetDate: String?, targetTimezone: String?): AlarmEntity {
        val draft = AlarmDraft(
            label = "",
            hour = 7,
            minute = 30,
            repeatDaysMask = 0,
            snoozeMinutes = 5,
            vibrationPattern = VibrationPatterns.DEFAULT,
            playMode = AlarmPlayModes.ALARM_ONLY,
        )
        return AlarmEntity(
            id = "dated",
            label = draft.label,
            hour = draft.hour,
            minute = draft.minute,
            fireAtMillis = 0L,
            repeatDaysMask = 0,
            holidayOff = false,
            snoozeEnabled = true,
            snoozeMinutes = 5,
            snoozeRepeatLimit = draft.snoozeRepeatLimit,
            snoozeCount = 0,
            vibrationPattern = draft.vibrationPattern,
            playMode = draft.playMode,
            defaultAlarmSoundId = draft.defaultAlarmSoundId,
            localAudioUri = null,
            audioCacheKey = null,
            rawAudioUri = null,
            voiceSource = draft.voiceSource,
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
            syncState = "local_only",
            origin = "local_owned",
            alarmVolumePercent = 100,
            alarmSoundUri = null,
            alarmSoundLabel = null,
            enabled = false,
            state = "dismissed",
            createdAtMillis = 0L,
            updatedAtMillis = 0L,
            targetDate = targetDate,
            targetTimezone = targetTimezone,
        )
    }
}
