package com.alarmtalk.app

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 알람 관문은 **탭 하나에 한 번, 메인 밖에서** 세고, **도는 동안 들어온 탭은 버린다**
 * (2026-09-29 A32).
 *
 * 고치기 전에는 ＋ 한 번에 관문이 두 번(`requestCreateAlarm` → `startCreateAlarm`), 그것도
 * 메인에서 돌아 3.5초 멎었고, 멎은 동안 쌓인 탭이 판정을 줄줄이 이어 붙여 15.8초까지 멎었다.
 * 판정식은 `StockClipPrefetchWorker.defaultVoicesReady` 그대로다 — 여기서는 **몇 번·어디서**만 본다.
 *
 * (Robolectric 인 이유: 셀 수 없을 때의 갈래가 `AlarmTalkLog` → `android.util.Log` 를 부른다.)
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DefaultVoiceGateTest {

    private class Recorder {
        var progressCalls = 0
        var ready = 0
        val blocked = mutableListOf<Pair<Int, Int>?>()
    }

    private fun TestScope.gate() = DefaultVoiceGate(
        scope = this,
        ioDispatcher = StandardTestDispatcher(testScheduler),
    )

    private fun DefaultVoiceGate.tap(recorder: Recorder, progress: Pair<Int, Int>?): Boolean = request(
        progress = {
            recorder.progressCalls += 1
            progress
        },
        onReady = { recorder.ready += 1 },
        onBlocked = { recorder.blocked += it },
    )

    @Test
    fun tapsWhileACheckIsInFlightAreDroppedNotStacked() = runTest {
        val gate = gate()
        val recorder = Recorder()

        // 판정이 끝나기 전에 세 번 누른다(멎은 화면을 연타한 상황).
        assertTrue(gate.tap(recorder, 76 to 76))
        assertFalse("도는 동안 들어온 탭은 버린다", gate.tap(recorder, 76 to 76))
        assertFalse(gate.tap(recorder, 76 to 76))
        assertTrue(gate.inFlight)

        advanceUntilIdle()

        assertEquals("세 번 눌러도 센 것은 한 번이다", 1, recorder.progressCalls)
        assertEquals("화면은 한 번만 열린다", 1, recorder.ready)
        assertFalse(gate.inFlight)

        // 끝난 뒤의 탭은 다시 받는다.
        assertTrue(gate.tap(recorder, 76 to 76))
        advanceUntilIdle()
        assertEquals(2, recorder.progressCalls)
        assertEquals(2, recorder.ready)
    }

    /** 막힐 때 알럿 퍼센트는 **이미 센 값**을 쓴다 — 예전에는 막히면 한 번 더 셌다. */
    @Test
    fun blockedCheckCountsOnceAndHandsTheSameProgressToTheAlert() = runTest {
        val gate = gate()
        val recorder = Recorder()

        gate.tap(recorder, 30 to 76)
        advanceUntilIdle()

        assertEquals(1, recorder.progressCalls)
        assertEquals(0, recorder.ready)
        assertEquals(listOf<Pair<Int, Int>?>(30 to 76), recorder.blocked)
        assertFalse(gate.inFlight)
    }

    /** 매니페스트를 한 번도 못 받았으면(null = 모른다) 막는다 — 스펙 그대로. */
    @Test
    fun unknownProgressBlocks() = runTest {
        val gate = gate()
        val recorder = Recorder()

        gate.tap(recorder, null)
        advanceUntilIdle()

        assertEquals(0, recorder.ready)
        assertEquals(1, recorder.blocked.size)
        assertNull(recorder.blocked.single())
    }

    /** 매니페스트가 비어 있으면(줄 것이 없다) 막지 않는다 — 스펙 그대로. */
    @Test
    fun emptyManifestDoesNotBlock() = runTest {
        val gate = gate()
        val recorder = Recorder()

        gate.tap(recorder, 0 to 0)
        advanceUntilIdle()

        assertEquals(1, recorder.ready)
        assertTrue(recorder.blocked.isEmpty())
    }

    /**
     * 세는 사이 다른 화면·계정으로 옮겼으면 **결과를 버린다**(Codex #821) — 옛 탭의 결과로
     * 새 화면 위에 편집기를 열거나 알럿을 띄우면 안 된다. 다 받았든 아니든 같다.
     */
    @Test
    fun resultIsDroppedWhenTheScreenChangedWhileCounting() = runTest {
        val gate = gate()
        val recorder = Recorder()
        var stillCurrent = true

        listOf(76 to 76, 30 to 76).forEach { counted ->
            gate.request(
                progress = {
                    recorder.progressCalls += 1
                    counted
                },
                onReady = { recorder.ready += 1 },
                onBlocked = { recorder.blocked += it },
                isStillCurrent = { stillCurrent },
            )
            // 세는 중에 탭을 옮긴다.
            stillCurrent = false
            advanceUntilIdle()
            stillCurrent = true
        }

        assertEquals("세기는 했다", 2, recorder.progressCalls)
        assertEquals("화면을 열지 않는다", 0, recorder.ready)
        assertTrue("알럿도 띄우지 않는다", recorder.blocked.isEmpty())
        assertFalse("버린 뒤에도 다음 탭을 받아야 한다", gate.inFlight)

        // 그대로면 예전처럼 적용한다.
        gate.request(
            progress = { 76 to 76 },
            onReady = { recorder.ready += 1 },
            onBlocked = { recorder.blocked += it },
            isStillCurrent = { stillCurrent },
        )
        advanceUntilIdle()
        assertEquals(1, recorder.ready)
    }

    /** 세다가 던지면 '모른다' 로 막고, 관문은 다시 열린다(갇히면 알람을 영영 못 만든다). */
    @Test
    fun aFailingCheckBlocksAndReleasesTheGate() = runTest {
        val gate = gate()
        val recorder = Recorder()

        gate.request(
            progress = { error("disk unavailable") },
            onReady = { recorder.ready += 1 },
            onBlocked = { recorder.blocked += it },
        )
        advanceUntilIdle()

        assertEquals(0, recorder.ready)
        assertEquals(listOf<Pair<Int, Int>?>(null), recorder.blocked)
        assertFalse("실패한 뒤에도 다음 탭을 받아야 한다", gate.inFlight)
        assertTrue(gate.tap(recorder, 76 to 76))
    }
}
