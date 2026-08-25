package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **교체 표식은 푸시를 놓친 기기가 스스로 수렴하는 유일한 근거다** — 규칙을 고정한다.
 *
 * ⚠ 이 저장소가 노출하는 것은 **판정→강등→확정을 한 임계구역에서 도는** 두 메서드뿐이다.
 * 판정만 따로 해 두면, 그 값을 들고 기다리는 사이 더 새 세대가 반영되고 사용자가 **새
 * 목소리로** 만든 알람을 뒤늦게 깨어난 옛 회차가 되돌릴 수 없이 지운다.
 *
 * iOS 짝은 `VoiceReplacementMarkerTests.swift`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceReplacementMarkerStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val store by lazy { VoiceReplacementMarkerStore(context) }

    @Test
    fun firstSightSeedsSilently() = runBlocking {
        var degrades = 0
        val applied = store.applyIfChanged("u1", "vp1", "2026-08-25 01:00:00") { degrades++; 3 }

        assertEquals(0, applied)
        assertEquals("첫 조회를 '바뀌었다' 로 읽으면 업데이트 직후 모든 설치가 알람을 날린다", 0, degrades)
        assertEquals(0, store.applyIfChanged("u1", "vp1", "2026-08-25 01:00:00") { 3 })
    }

    @Test
    fun newGenerationDegradesAndCommits() = runBlocking {
        store.applyIfChanged("u2", "vp1", null) { 0 }

        assertEquals(2, store.applyIfChanged("u2", "vp1", "2026-08-25 01:00:00") { 2 })
        // 확정됐으니 같은 세대로는 두 번 돌지 않는다.
        assertEquals(0, store.applyIfChanged("u2", "vp1", "2026-08-25 01:00:00") { 2 })
    }

    /** ⚠ 강등이 실패했거나 계정이 바뀌었으면(=null) **확정하지 않는다** — 다음 회차가 다시 집는다. */
    @Test
    fun refusedCommitLeavesTheSignalForTheNextPass() = runBlocking {
        store.applyIfChanged("u3", "vp1", null) { 0 }

        assertEquals(0, store.applyIfChanged("u3", "vp1", "2026-08-25 01:00:00") { null })
        assertEquals(1, store.applyIfChanged("u3", "vp1", "2026-08-25 01:00:00") { 1 })
    }

    /**
     * ⚠ **'봤다' 를 '반영했다' 로 읽으면 푸시가 무력해진다** — 플랫폼에 따라 목록 갱신이
     * 교체 처리보다 먼저 끝난다(iOS 가 그렇다).
     */
    @Test
    fun seedingDoesNotCountAsApplied() = runBlocking {
        // 첫 조회가 새 세대를 그대로 시드한다(강등은 하지 않는다).
        store.applyIfChanged("u4", "vp1", "2026-08-25 01:00:00") { 9 }

        assertEquals(
            "시드를 반영으로 읽으면 뒤이은 푸시가 아무것도 내리지 않는다",
            2,
            store.applyIfNotApplied("u4", "vp1", "2026-08-25 01:00:00") { 2 },
        )
        assertEquals(0, store.applyIfNotApplied("u4", "vp1", "2026-08-25 01:00:00") { 2 })
    }

    /** ⚠ 늦게 도착한 **앞선** 세대의 푸시는 이미 처리한 것으로 본다(뒤 세대 알람을 지우면 안 된다). */
    @Test
    fun olderGenerationPushesAreTreatedAsHandled() = runBlocking {
        store.applyIfNotApplied("u5", "vp1", "2026-08-25 02:00:00") { 1 }

        assertEquals(0, store.applyIfNotApplied("u5", "vp1", "2026-08-25 01:00:00") { 5 })
        assertEquals(5, store.applyIfNotApplied("u5", "vp1", "2026-08-25 03:00:00") { 5 })
    }

    /** 세대를 모르는 옛 신호는 반영하되 **확정하지 않는다**(무엇을 봤는지 모른다). */
    @Test
    fun signalsWithoutAGenerationAreNeverCommitted() = runBlocking {
        assertEquals(1, store.applyIfNotApplied("u6", "vp1", null) { 1 })
        assertEquals(
            "무엇을 봤는지 모르면 확정하지 않는다 — 다음 신호도 그대로 반영한다",
            1,
            store.applyIfNotApplied("u6", "vp1", null) { 1 },
        )
    }

    /** ⚠ **낡은 목록이 표식을 과거로 되돌리면** 이미 처리한 교체를 다시 처리한다. */
    @Test
    fun olderGenerationsAreNotTreatedAsChange() = runBlocking {
        store.applyIfChanged("u7", "vp1", null) { 0 }
        store.applyIfChanged("u7", "vp1", "2026-08-25 02:00:00") { 1 }

        assertEquals(
            "낡은 목록이 표식을 되돌리면 그 사이 만든 알람이 지워진다",
            0,
            store.applyIfChanged("u7", "vp1", "2026-08-25 01:00:00") { 1 },
        )
    }

    /**
     * ⚠ **판정과 강등 사이에 다른 회차가 끼어들 수 없어야 한다.** 예전에는 판정을 먼저 해 두고
     * 코루틴에서 나중에 강등해서, 그 사이 반영된 새 세대의 알람을 옛 회차가 지웠다.
     */
    @Test
    fun theCheckDegradeCommitSequenceIsSerialized() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val newerFinished = CompletableDeferred<Int>()
        store.applyIfChanged("u8", "vp1", null) { 0 }

        val older = async(Dispatchers.Default) {
            store.applyIfChanged("u8", "vp1", "2026-08-25 01:00:00") {
                started.complete(Unit)
                // 옛 회차가 강등 중인 동안 새 회차는 락에 막혀 시작조차 못 한다.
                assertNull(
                    "판정·강등·확정이 직렬화되지 않았다",
                    withTimeoutOrNull(200) { newerFinished.await() },
                )
                1
            }
        }
        started.await()
        val newer = async(Dispatchers.Default) {
            val applied = store.applyIfChanged("u8", "vp1", "2026-08-25 02:00:00") { 7 }
            newerFinished.complete(applied)
            applied
        }

        assertEquals(1, older.await())
        // 락이 풀린 뒤에야 새 회차가 돈다 — 그때는 옛 세대가 이미 확정돼 있어 그대로 반영된다.
        assertEquals("새 세대는 옛 회차가 끝난 뒤 그대로 반영돼야 한다", 7, newer.await())
    }

    @Test
    fun markersAreScopedPerAccount() = runBlocking {
        store.applyIfChanged("u9", "vp1", null) { 0 }
        assertEquals(1, store.applyIfChanged("u9", "vp1", "2026-08-25 01:00:00") { 1 })
        // 다른 계정은 아직 처음 보는 프로필이다.
        assertEquals(0, store.applyIfChanged("u10", "vp1", "2026-08-25 01:00:00") { 1 })
    }

    /**
     * ⚠ **로그아웃에서 지우면 안 된다.** 로그아웃은 로컬 알람을 끄기만 하고 지우지 않는다 —
     * 표식이 사라지면 그 사이의 교체를 재로그인한 기기가 '처음 봤다' 로 읽어 영영 강등하지 않는다.
     */
    @Test
    fun baselineSurvivesSignOut() = runBlocking {
        store.applyIfChanged("u11", "vp1", "2026-08-25 01:00:00") { 0 }

        // (로그아웃 — 이 저장소는 아무것도 지우지 않는다)
        val afterRelogin = VoiceReplacementMarkerStore(context)
        assertEquals(
            "로그아웃 사이에 일어난 교체를 재로그인 후에도 알아채야 한다",
            4,
            afterRelogin.applyIfChanged("u11", "vp1", "2026-08-25 03:00:00") { 4 },
        )
    }
}
