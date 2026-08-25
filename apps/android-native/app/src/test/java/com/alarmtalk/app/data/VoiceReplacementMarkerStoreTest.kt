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

    @Test
    fun markersAreScopedPerAccountAndClearedOnSignOut() {
        store.changed("u3", "vp1", null)
        assertTrue(store.changed("u3", "vp1", "t1"))
        // 다른 계정은 아직 처음 보는 프로필이다.
        assertFalse(store.changed("u4", "vp1", "t1"))

        store.commit("u3", "vp1", "t1")
        store.clear("u3")
        assertFalse("로그아웃 뒤엔 다시 '처음 본 프로필' 이어야 한다", store.changed("u3", "vp1", "t2"))
        assertFalse("다른 계정 표식을 함께 지우면 안 된다", store.changed("u4", "vp1", "t1"))
    }
}
