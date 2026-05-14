package com.voicealarm.nativeapp

import com.google.gson.Gson
import com.voicealarm.nativeapp.network.FamilyAlarmQuietWindow
import com.voicealarm.nativeapp.network.FamilyGroupMember
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmEditorScreenTest {
    @Test
    fun familyAlarmQuietScheduleFallsBackWhenQuietWindowsIsNull() {
        val member = Gson().fromJson(
            """
            {
              "id": "member-id",
              "user_id": "recipient-id",
              "role": "member",
              "joined_at": "2026-05-11T00:00:00.000Z",
              "email": "recipient@example.com",
              "name": "Recipient",
              "allow_family_alarms": true,
              "family_alarm_quiet_days": [1, 2, 3, 4, 5],
              "family_alarm_quiet_start": "09:00",
              "family_alarm_quiet_end": "18:30",
              "family_alarm_quiet_windows": null
            }
            """.trimIndent(),
            FamilyGroupMember::class.java,
        )

        val label = familyAlarmQuietScheduleLabel(member)

        assertTrue(label.contains("09:00-18:30"))
    }

    @Test
    fun familyAlarmTimeUnavailableWhenSelectedTimeIsInsideRecipientQuietWindow() {
        val member = member(
            windows = listOf(FamilyAlarmQuietWindow(days = listOf(1, 2, 3, 4, 5), start = "09:00", end = "18:30")),
        )

        assertTrue(
            isFamilyAlarmTimeUnavailable(
                member = member,
                hour = 10,
                minute = 0,
                repeatDaysMask = 1 shl 1,
            ),
        )
    }

    @Test
    fun familyAlarmTimeAvailableWhenSelectedTimeIsOutsideRecipientQuietWindow() {
        val member = member(
            windows = listOf(FamilyAlarmQuietWindow(days = listOf(1, 2, 3, 4, 5), start = "09:00", end = "18:30")),
        )

        assertFalse(
            isFamilyAlarmTimeUnavailable(
                member = member,
                hour = 6,
                minute = 0,
                repeatDaysMask = 1 shl 1,
            ),
        )
    }

    @Test
    fun familyAlarmLeadRequiresAtLeastThirtyMinutes() {
        val nowMillis = LocalDateTime.of(2026, 5, 11, 6, 0)
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()

        assertTrue(
            isFamilyAlarmLeadTooSoon(
                hour = 6,
                minute = 20,
                repeatDaysMask = 0,
                holidayOff = false,
                nowMillis = nowMillis,
            ),
        )
        assertFalse(
            isFamilyAlarmLeadTooSoon(
                hour = 6,
                minute = 30,
                repeatDaysMask = 0,
                holidayOff = false,
                nowMillis = nowMillis,
            ),
        )
    }

    @Test
    fun repeatSummaryShowsNextOneShotDateOrWeeklyDays() {
        val zoneId = ZoneId.of("UTC")
        val nowMillis = LocalDateTime.of(2026, 5, 13, 8, 0)
            .atZone(zoneId)
            .toInstant()
            .toEpochMilli()

        assertEquals("오늘 - 5월 13일(수)", repeatSummaryLabel(8, 30, 0, nowMillis, zoneId))
        assertEquals("내일 - 5월 14일(목)", repeatSummaryLabel(7, 30, 0, nowMillis, zoneId))
        assertEquals(
            "매주 월, 화, 수",
            repeatSummaryLabel(7, 30, (1 shl 1) or (1 shl 2) or (1 shl 3), nowMillis, zoneId),
        )
    }

    @Test
    fun voicePreviewContentDescriptionShowsPlaybackState() {
        assertEquals("미리듣기 재생", voicePreviewContentDescription(active = false, preparing = false))
        assertEquals("미리듣기 준비 중", voicePreviewContentDescription(active = false, preparing = true))
        assertEquals("미리듣기 일시정지", voicePreviewContentDescription(active = true, preparing = false))
    }

    private fun member(
        windows: List<FamilyAlarmQuietWindow>? = listOf(FamilyAlarmQuietWindow()),
    ): FamilyGroupMember =
        FamilyGroupMember(
            id = "member-id",
            userId = "recipient-id",
            role = "member",
            joinedAt = "2026-05-11T00:00:00.000Z",
            email = "recipient@example.com",
            name = "Recipient",
            allowFamilyAlarms = true,
            familyAlarmQuietWindows = windows,
        )
}
