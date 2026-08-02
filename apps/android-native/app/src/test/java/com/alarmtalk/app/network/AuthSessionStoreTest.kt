package com.alarmtalk.app.network

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthSessionStoreTest {
    /**
     * 이 표시는 새로 생긴 키라, 예전 버전에서 로그아웃한 기기에는 값이 없다. 그때 '안 떼어냄'
     * 으로 보면 업데이트하는 순간 소유자 있는 알람이 로그인 화면 뒤에서 되살아난다 —
     * 사용자가 끌 수 없다(Codex #665 P1). 세션이 없으면 '떼어냄' 쪽으로 기운다.
     */
    @Test
    fun signedOutDeviceWithoutMarkerIsTreatedAsDetached() {
        assertEquals(true, resolveInitialAlarmsDetached(hasStoredToken = false))
    }

    /** 반대로 세션이 살아 있으면 떼어낸 적이 없다 — 정상 경로로 재예약돼야 한다. */
    @Test
    fun signedInDeviceWithoutMarkerIsNotDetached() {
        assertEquals(false, resolveInitialAlarmsDetached(hasStoredToken = true))
    }

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

        // 백엔드가 dynamic_prompt_settings 를 null 로 보내도 기본값으로 정규화돼야 한다.
        // (실제 user copy 는 AuthSessionStore.normalizeUser 가 deletionStatus 등 모든 누락
        //  non-null 필드를 null-안전하게 채우므로, 여기서는 핵심인 정규화 결과만 검증한다.)
        assertEquals(
            DynamicPromptSettings(),
            normalizeDynamicPromptSettings(user.dynamicPromptSettings),
        )
    }
}
