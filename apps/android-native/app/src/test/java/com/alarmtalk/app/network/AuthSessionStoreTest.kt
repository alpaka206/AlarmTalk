package com.alarmtalk.app.network

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthSessionStoreTest {
    @Test
    fun normalizeDynamicPromptSettingsAllowsBackendNullBeforeUserCopy() {
        val user = Gson().fromJson(
            """
            {
              "id": "user-id",
              "email": "user@example.com",
              "name": "User",
              "plan": "free",
              "allow_family_alarms": false,
              "family_alarm_quiet_days": [1, 2, 3, 4, 5],
              "family_alarm_quiet_start": "09:00",
              "family_alarm_quiet_end": "18:30",
              "family_alarm_quiet_windows": [
                { "days": [1, 2, 3, 4, 5], "start": "09:00", "end": "18:30" }
              ],
              "dynamic_prompt_settings": null
            }
            """.trimIndent(),
            AuthUser::class.java,
        )

        val normalized = user.copy(
            dynamicPromptSettings = normalizeDynamicPromptSettings(user.dynamicPromptSettings),
        )

        assertEquals(DynamicPromptSettings(), normalized.dynamicPromptSettings)
    }
}
