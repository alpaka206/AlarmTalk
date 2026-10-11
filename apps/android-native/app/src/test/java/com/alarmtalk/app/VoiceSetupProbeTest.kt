package com.alarmtalk.app

import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Runnable
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 기본 목소리 **받기 화면** 판정의 파일 세기는 메인 밖에서 한다(2026-10-10 Sentry 조사).
 *
 * 고치기 전에는 세션이 시작되는 콜드 스타트의 `LaunchedEffect` 가 `MainViewModel.checkVoiceSetupFor` 로,
 * 받기가 끝난 화면이 `completeVoiceSetupIfDownloaded` 로 캐시 디렉터리를 메인 스레드에서 통째로 읽고 항목마다
 * stat 했다(`AlarmAudioStore.cachedStockClipCount`). 판정식은 그대로다 — 여기서는 **어디서** 세는지와,
 * 메인 밖으로 나가며 생긴 틈을 순서로 막았는지를 본다(`DefaultVoiceGateTest` 와 같은 모양).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoiceSetupProbeTest {

    /** IO 로 **실제로 넘겼는가**를 센다. */
    private class CountingDispatcher(private val delegate: CoroutineDispatcher) : CoroutineDispatcher() {
        var dispatches = 0
        override fun dispatch(context: CoroutineContext, block: Runnable) {
            dispatches += 1
            delegate.dispatch(context, block)
        }
    }

    private class Disk(var clips: Int) {
        var counts = 0
        fun count(): Int {
            counts += 1
            return clips
        }
    }

    private fun TestScope.probe(disk: Disk, io: CoroutineDispatcher = StandardTestDispatcher(testScheduler)) =
        VoiceSetupProbe(countCachedStockClips = disk::count, ioDispatcher = io)

    @Test
    fun countingRunsOnTheInjectedIoDispatcher() = runTest {
        val disk = Disk(clips = 0)
        val io = CountingDispatcher(StandardTestDispatcher(testScheduler))
        val probe = probe(disk, io)

        val answer = async { probe.needsSetup(skipped = false) }
        assertEquals("부른 자리에서 곧바로 세지 않는다", 0, disk.counts)
        advanceUntilIdle()

        assertTrue("세는 일은 IO 디스패처로 넘겼다", io.dispatches > 0)
        assertEquals(1, disk.counts)
        assertTrue(answer.await())
    }

    @Test
    fun setupShowsOnlyWhenNothingIsOnTheDeviceAndTheUserDidNotSkip() = runTest {
        assertTrue(probe(Disk(clips = 0)).needsSetup(skipped = false))
        assertFalse("일부만 받다 끊겼으면 워커가 조용히 마저 채운다", probe(Disk(clips = 3)).needsSetup(skipped = false))
    }

    /** '나중에 받기' 를 누른 계정은 세지도 않는다 — 파일이 몇 개든 화면을 띄우지 않는다. */
    @Test
    fun aSkippedAccountIsNotCounted() = runTest {
        val disk = Disk(clips = 0)
        assertFalse(probe(disk).needsSetup(skipped = true))
        assertEquals(0, disk.counts)
    }

    /** 받기 화면은 **실제로 파일이 생겼을 때만** 닫는다 — 워커는 받을 게 없어도 성공을 낸다. */
    @Test
    fun setupClosesOnlyWhenAFileExists() = runTest {
        assertFalse(probe(Disk(clips = 0)).anyDownloaded())
        assertTrue(probe(Disk(clips = 1)).anyDownloaded())
    }

    // ── 배선 ──────────────────────────────────────────────────────────────

    @Test
    fun theViewModelCountsOnlyThroughTheProbe() {
        val source = withoutLineComments(readSource("ui/main/MainViewModel.kt"))
        val check = functionBody(source, "suspend fun checkVoiceSetupFor(")
        val complete = functionBody(source, "suspend fun completeVoiceSetupIfDownloaded(")
        assertTrue(check.contains("voiceSetupProbe.needsSetup("))
        assertTrue(complete.contains("voiceSetupProbe.anyDownloaded()"))
        assertFalse("메인에서 디렉터리를 센다", check.contains("cachedStockClipCount()"))
        assertFalse("메인에서 디렉터리를 센다", complete.contains("cachedStockClipCount()"))
        // 세는 사이 계정이 바뀌었으면 옛 계정의 답을 적지 않는다.
        assertTrue(check.indexOf("authSession?.user?.id != userId") in 0 until check.indexOf("showVoiceSetup = needsSetup"))
    }

    /**
     * ⚠ **순서가 준비 신호다.** 1회성 오버레이(첫 권한 안내·강등 안내·개인 플랜 종료 안내)는 계정·동의 응답을
     * 기다린다. 그 요청을 받기 화면 판정 **뒤에** 내야 `showVoiceSetup` 의 응답 전 기본값(false)을 '받기 화면
     * 없음' 으로 읽고 소진 플래그를 태우는 틈이 없다(`docs/spec/gates-and-overlays.md`).
     */
    @Test
    fun accountAndConsentChecksStartAfterTheVoiceSetupAnswer() {
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        val setup = app.indexOf("viewModel.checkVoiceSetupFor(authSession.user.id)")
        assertTrue(setup >= 0)
        assertTrue(app.indexOf("viewModel.checkAccountStatus()", setup) > setup)
        assertTrue(app.indexOf("viewModel.checkConsentStatus()", setup) > setup)
        // 다른 자리에서 먼저 부르지 않는다.
        assertEquals(1, Regex("viewModel\\.checkAccountStatus\\(\\)").findAll(app).count())
        assertEquals(1, Regex("viewModel\\.checkConsentStatus\\(\\)").findAll(app).count())
    }
}
