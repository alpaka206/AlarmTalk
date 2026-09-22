package com.alarmtalk.app.network

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 실제 `EncryptedSharedPreferences` 위에서 — `AuthSessionStore(context)` 를 **두 번** 만들어도
 * 한쪽의 로그인이 다른 쪽 `observeUserId` 에 들리는가.
 *
 * 유닛 테스트(`AuthSessionStoreSharedPrefsTest`)는 AndroidKeyStore 가 없어 암호화 저장소를 못
 * 연다. 이 계약이 깨지면 로그인 직후 첫 알람이 목록에 안 보인다(2026-09-22 실기기 재현).
 *
 * ⚠ 이 테스트는 기기의 **실제 세션 prefs** 를 쓴다 — 로그인된 테스트 계정이 있으면 지운다.
 *   dev flavor 테스트 기기에서만 돌릴 것.
 */
@RunWith(AndroidJUnit4::class)
class AuthSessionStoreSharedPrefsInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Before
    fun clearSession() {
        AuthSessionStore(context).clear()
    }

    @After
    fun clearSessionAfter() {
        AuthSessionStore(context).clear()
    }

    @Test
    fun loginThroughOneInstanceIsHeardByAnotherInstance() = runBlocking {
        val listening = AuthSessionStore(context)
        val writing = AuthSessionStore(context)

        val collected = mutableListOf<String?>()
        val job = CoroutineScope(Dispatchers.Default).launch {
            listening.observeUserId().take(2).toList(collected)
        }
        // 첫 스냅샷(null)이 나온 뒤에 쓴다.
        withTimeout(5_000) { while (collected.isEmpty()) kotlinx.coroutines.delay(20) }
        writing.save(
            AuthSession(
                token = "instrumented-token",
                provider = AuthSessionStore.PROVIDER_APP,
                user = AuthUser(id = "instrumented-user", email = "instrumented@example.test"),
            ),
        )
        withTimeout(5_000) { job.join() }

        assertEquals(listOf(null, "instrumented-user"), collected)
    }
}
