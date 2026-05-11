package com.voicealarm.nativeapp

import com.google.gson.Gson
import com.voicealarm.nativeapp.network.FamilyGroupMember
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
}
