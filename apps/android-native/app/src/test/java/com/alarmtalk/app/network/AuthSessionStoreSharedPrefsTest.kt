package com.alarmtalk.app.network

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * 세션 변경 흐름은 **다른 `AuthSessionStore` 인스턴스가 쓴 변경**도 들어야 한다.
 *
 * 로그인은 `MainViewModel` 의 인스턴스로 쓰고, 알람 목록 필터(`AlarmRepository.observeAlarms`)
 * 는 `AlarmAppContainer` 의 다른 인스턴스로 듣는다. `EncryptedSharedPreferences` 는 변경
 * 리스너를 래퍼 인스턴스별로 들고 있어서, 인스턴스마다 저장소를 새로 열면 그 둘이 서로
 * 안 들린다 — 그래서 **첫 알람을 만들어도 "알람이 없어요"** 였다(2026-09-22 실기기 재현,
 * S23·A32). 수정은 prefs 객체를 프로세스에 하나만 두는 것(`AuthSessionStore.sharedPrefs`)이다.
 *
 * 여기서는 그 계약을 두 겹으로 고정한다:
 * 1. 같은 prefs 객체를 나눠 쓰는 두 인스턴스는 서로의 변경을 듣는다(리스너 전파 자체).
 * 2. `AuthSessionStore(context)` 를 두 번 만들어도 변경이 건너간다 — Robolectric 에는
 *    AndroidKeyStore 가 없어 암호화 저장소를 못 열므로, 실제 암호화 경로는 계측 테스트
 *    (`AuthSessionStoreSharedPrefsInstrumentedTest`)가 맡는다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AuthSessionStoreSharedPrefsTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @After
    fun deleteTestPrefs() {
        listOf("auth-shared-test", "auth-wrapper-test").forEach { name ->
            context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit()
            File(context.filesDir.parentFile, "shared_prefs/$name.xml").delete()
        }
    }

    private fun plainPrefs(name: String): SharedPreferences =
        context.getSharedPreferences(name, Context.MODE_PRIVATE)

    private fun session(userId: String) = AuthSession(
        token = "token-$userId",
        provider = AuthSessionStore.PROVIDER_APP,
        user = AuthUser(id = userId, email = "$userId@example.test"),
    )

    @Test
    fun aStoreHearsSessionsSavedThroughAnotherStoreOverTheSamePrefs() = runBlocking {
        val shared = plainPrefs("auth-shared-test")
        shared.edit().clear().commit()
        val listening = AuthSessionStore(shared)
        val writing = AuthSessionStore(shared)

        val collected = mutableListOf<String?>()
        val job = CoroutineScope(Dispatchers.Unconfined).launch {
            listening.observeUserId().take(2).toList(collected)
        }
        // 로그인은 '다른' 인스턴스로 일어난다 — MainViewModel 이 그렇다.
        writing.save(session("user-a"))
        job.join()

        assertEquals(listOf(null, "user-a"), collected)
    }

    @Test
    fun listenersOnDifferentWrapperObjectsDoNotHearEachOther_soTheStoreMustShareOne() = runBlocking {
        // 함정을 그대로 재현한다: 같은 파일을 보는 **서로 다른 래퍼 객체** 둘.
        // (평문 SharedPreferences 는 파일당 구현이 하나라 이 함정이 없지만, 암호화 래퍼는
        //  래퍼마다 리스너 목록이 따로다. 여기서는 래퍼를 흉내 내 '왜 하나여야 하는지' 를 고정한다.)
        val underlying = plainPrefs("auth-wrapper-test")
        underlying.edit().clear().commit()
        val wrapperA = PerInstanceListenerPrefs(underlying)
        val wrapperB = PerInstanceListenerPrefs(underlying)
        val listening = AuthSessionStore(wrapperA)
        val writing = AuthSessionStore(wrapperB)

        val collected = mutableListOf<String?>()
        val job = CoroutineScope(Dispatchers.Unconfined).launch {
            listening.observeUserId().take(2).toList(collected)
        }
        writing.save(session("user-b"))
        // B 의 쓰기는 A 의 리스너를 깨우지 않는다 — 두 번째 값이 영영 오지 않는다.
        job.cancel()
        assertEquals(listOf<String?>(null), collected)
    }
}

/**
 * `EncryptedSharedPreferences` 의 리스너 의미를 흉내 낸 래퍼 — 리스너를 자기 목록에만 두고
 * `Editor.apply`/`commit` 이 그 목록만 깨운다(androidx.security 1.1.0-alpha06 바이트코드와 같다).
 */
private class PerInstanceListenerPrefs(
    private val delegate: SharedPreferences,
) : SharedPreferences by delegate {
    private val listeners = mutableListOf<SharedPreferences.OnSharedPreferenceChangeListener>()

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        listeners += listener
    }

    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        listeners -= listener
    }

    override fun edit(): SharedPreferences.Editor = NotifyingEditor(delegate.edit())

    private inner class NotifyingEditor(
        private val inner: SharedPreferences.Editor,
    ) : SharedPreferences.Editor by inner {
        override fun apply() {
            inner.apply()
            listeners.toList().forEach { it.onSharedPreferenceChanged(this@PerInstanceListenerPrefs, null) }
        }

        override fun commit(): Boolean {
            val ok = inner.commit()
            listeners.toList().forEach { it.onSharedPreferenceChanged(this@PerInstanceListenerPrefs, null) }
            return ok
        }
    }
}
