package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **교체 표식은 푸시를 놓친 기기가 스스로 수렴하는 유일한 근거다** — 그래서 두 규칙을 고정한다.
 *
 * iOS 짝은 `VoiceReplacementMarkerTests.swift`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceReplacementMarkerStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val store by lazy { VoiceReplacementMarkerStore(context) }

    @Test
    fun firstSightSeedsSilently() {
        // ⚠ 첫 조회를 '바뀌었다' 로 읽으면 업데이트 직후 모든 설치가 직접 입력 알람을 날린다.
        assertFalse(store.changed("u1", "vp1", "2026-08-25T00:00:00Z"))
        assertFalse("같은 값은 변화가 아니다", store.changed("u1", "vp1", "2026-08-25T00:00:00Z"))
    }

    @Test
    fun changedStaysTrueUntilCommitted() {
        store.changed("u2", "vp1", null)

        assertTrue(store.changed("u2", "vp1", "2026-08-25T00:00:00Z"))
        // ⚠ 강등이 실패했으면 다음 회차가 **다시 집어야** 한다 — changed 가 값을 적으면 안 된다.
        assertTrue(store.changed("u2", "vp1", "2026-08-25T00:00:00Z"))

        store.commit("u2", "vp1", "2026-08-25T00:00:00Z")
        assertFalse(store.changed("u2", "vp1", "2026-08-25T00:00:00Z"))
    }

    /** 늦게 도착한 푸시가 그 사이 **새 목소리로** 만든 알람까지 지우지 않게 하는 판정. */
    @Test
    fun hasAppliedIsTrueOnlyForTheGenerationAlreadyHandled() {
        // 처음 보는 프로필은 false — 푸시 자체가 '방금 교체됐다' 는 증거다. 적지도 않는다.
        assertFalse(store.hasApplied("u5", "vp1", "t1"))
        assertFalse("hasApplied 가 표식을 적으면 changed 판정이 오염된다", store.changed("u5", "vp1", "t1"))

        store.commit("u5", "vp1", "t1")
        assertTrue(store.hasApplied("u5", "vp1", "t1"))
        assertFalse(store.hasApplied("u5", "vp1", "t2"))
        // 세대를 모르는 옛 서버 신호는 '반영했다' 로 볼 수 없다.
        assertFalse(store.hasApplied("u5", "vp1", null))
    }

    /**
     * ⚠ **`changed` 가 조용히 적어 둔 '봤다' 를 '반영했다' 로 읽으면 푸시가 무력해진다.**
     * 플랫폼에 따라 목록 갱신이 교체 처리보다 먼저 끝난다(iOS 가 그렇다).
     */
    @Test
    fun seenIsNotApplied() {
        store.changed("u6", "vp1", "t1") // 첫 조회 시드
        assertFalse(
            "첫 조회 시드를 반영으로 읽으면 뒤이은 푸시가 아무것도 내리지 않는다",
            store.hasApplied("u6", "vp1", "t1"),
        )
    }

    /** ⚠ **표식은 뒤로 가지 않는다** — 낡은 공유 목록이 되돌리면 같은 교체를 또 처리한다. */
    @Test
    fun olderGenerationsAreNotTreatedAsChange() {
        store.changed("u8", "vp1", null)
        assertTrue(store.changed("u8", "vp1", "2026-08-25 01:00:00"))
        store.commit("u8", "vp1", "2026-08-25 01:00:00")

        assertFalse(
            "낡은 목록이 표식을 과거로 되돌리면 그 사이 만든 알람이 지워진다",
            store.changed("u8", "vp1", "2026-08-24 23:00:00"),
        )
        assertFalse(store.changed("u8", "vp1", null))
        assertTrue(store.changed("u8", "vp1", "2026-08-25 02:00:00"))
    }

    @Test
    fun markersAreScopedPerAccount() {
        store.changed("u3", "vp1", null)
        assertTrue(store.changed("u3", "vp1", "t1"))
        // 다른 계정은 아직 처음 보는 프로필이다.
        assertFalse(store.changed("u4", "vp1", "t1"))
    }

    /**
     * ⚠ **로그아웃에서 지우면 안 된다.** 로그아웃은 로컬 알람을 끄기만 하고 지우지 않는다 —
     * 그 사이 다른 기기에서 교체가 일어나고 같은 계정이 돌아오면, 표식이 없는 기기는 첫
     * 조회를 '처음 봤다' 로 읽어 영영 강등하지 않는다.
     */
    @Test
    fun baselineSurvivesSignOut() {
        store.changed("u9", "vp1", "2026-08-25 01:00:00")

        // (로그아웃 — 이 저장소는 아무것도 지우지 않는다)
        val afterRelogin = VoiceReplacementMarkerStore(context)
        assertTrue(
            "로그아웃 사이에 일어난 교체를 재로그인 후에도 알아채야 한다",
            afterRelogin.changed("u9", "vp1", "2026-08-25 03:00:00"),
        )
    }

    /** 늦게 도착한 **앞선** 세대의 푸시는 이미 처리한 것으로 본다(뒤 세대 알람을 지우면 안 된다). */
    @Test
    fun olderGenerationPushesAreTreatedAsHandled() {
        store.commit("u10", "vp1", "2026-08-25 02:00:00")

        assertTrue(store.hasApplied("u10", "vp1", "2026-08-25 01:00:00"))
        assertTrue(store.hasApplied("u10", "vp1", "2026-08-25 02:00:00"))
        assertFalse(store.hasApplied("u10", "vp1", "2026-08-25 03:00:00"))

        // 옛 신호를 확정해도 표식이 과거로 되돌아가지 않는다.
        store.commit("u10", "vp1", "2026-08-25 01:00:00")
        assertFalse(store.changed("u10", "vp1", "2026-08-25 02:00:00"))
    }
}
