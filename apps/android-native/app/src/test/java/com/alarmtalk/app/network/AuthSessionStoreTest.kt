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
