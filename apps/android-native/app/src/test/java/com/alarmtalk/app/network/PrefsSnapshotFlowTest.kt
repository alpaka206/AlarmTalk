package com.alarmtalk.app.network

import android.content.SharedPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 세션 흐름은 리스너를 **먼저** 걸고 스냅샷을 읽어야 한다.
 *
 * 순서를 뒤집으면 read() 와 등록 사이에 커밋된 로그인/로그아웃을 아무도 못 본다 — 리스너가
 * 아직 없어 콜백이 안 오고, 이미 읽은 스냅샷은 옛 값이다. 그러면 알람 목록 필터가 로그아웃
 * 시점 값에 머물러 '로그인은 됐는데 알람이 하나도 안 보이는' 상태가 된다(Codex #651).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PrefsSnapshotFlowTest {

    private fun collectOn(scope: CoroutineScope) = scope

    @Test
    fun snapshotIsReadAfterTheListenerIsRegistered() = runBlocking {
        var value = "signed-out"
        // 등록이 일어나는 그 순간 로그인이 커밋된 상황.
        val flow = prefsSnapshotFlow(
            register = { value = "signed-in" },
            unregister = {},
            read = { value },
        )

        // 스냅샷을 먼저 읽는 구현이면 "signed-out" 이 나오고, 리스너가 없던 사이의 변경이라
        // 뒤이은 콜백도 없어 영영 로그인 상태를 못 본다.
        assertEquals("signed-in", flow.first())
    }

    @Test
    fun changesAfterRegistrationAreDelivered() = runBlocking {
        var value = "signed-out"
        var listener: SharedPreferences.OnSharedPreferenceChangeListener? = null
        val flow = prefsSnapshotFlow(
            register = { listener = it },
            unregister = { listener = null },
            read = { value },
        )

        val collected = mutableListOf<String>()
        val job = collectOn(CoroutineScope(Dispatchers.Unconfined)).launch {
            flow.take(2).toList(collected)
        }
        value = "signed-in"
        listener?.onSharedPreferenceChanged(null, null)
        job.join()

        assertEquals(listOf("signed-out", "signed-in"), collected)
    }

    @Test
    fun duplicateSnapshotsAreCollapsed() = runBlocking {
        var listener: SharedPreferences.OnSharedPreferenceChangeListener? = null
        val flow = prefsSnapshotFlow(
            register = { listener = it },
            unregister = { listener = null },
            read = { "same" },
        )

        val collected = mutableListOf<String>()
        val job = collectOn(CoroutineScope(Dispatchers.Unconfined)).launch {
            flow.take(1).toList(collected)
        }
        // 로그인은 prefs 키를 여러 개 쓰므로 콜백이 연달아 온다 — 같은 값은 한 번만 흘러야 한다.
        repeat(5) { listener?.onSharedPreferenceChanged(null, null) }
        job.join()

        assertEquals(listOf("same"), collected)
    }
}
