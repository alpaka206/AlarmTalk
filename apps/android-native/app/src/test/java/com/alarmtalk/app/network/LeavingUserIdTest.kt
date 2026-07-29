package com.alarmtalk.app.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 세션을 비울 때 '마지막 로그인 계정'을 잃으면, 401 처리 중 알람 소유자 새기기가 실패했을 때
 * 다음 로그인에서 앞 계정을 알아낼 방법이 없어진다 → 소유자 없는 알람을 새 계정이 물려받아
 * 울린다(Codex #650). 그 판단 규칙을 고정한다.
 */
class LeavingUserIdTest {

    @Test
    fun prefersTheUserWhoseSessionIsEnding() {
        assertEquals("account-A", resolveLeavingUserId(currentUserId = "account-A", existingMarker = null))
    }

    @Test
    fun currentUserWinsOverAStaleMarker() {
        assertEquals(
            "account-B",
            resolveLeavingUserId(currentUserId = "account-B", existingMarker = "account-A"),
        )
    }

    /** 이 빌드 이전에 로그인해 둔 세션 — 마커는 없고 세션 사용자만 있다. */
    @Test
    fun upgradedSessionWithoutAMarkerStillYieldsTheLeavingAccount() {
        assertEquals("account-A", resolveLeavingUserId(currentUserId = "account-A", existingMarker = ""))
    }

    /** 이미 비운 뒤 다시 불린 경우 — 앞 계정 정보를 잃으면 안 된다. */
    @Test
    fun keepsTheExistingMarkerWhenTheSessionIsAlreadyCleared() {
        assertEquals("account-A", resolveLeavingUserId(currentUserId = null, existingMarker = "account-A"))
        assertEquals("account-A", resolveLeavingUserId(currentUserId = "  ", existingMarker = "account-A"))
    }

    /** 로그인한 적 없는 기기 — 앞 계정이 없으니 백스톱도 필요 없다. */
    @Test
    fun staysUnsetWhenNoAccountHasEverSignedIn() {
        assertNull(resolveLeavingUserId(currentUserId = null, existingMarker = null))
        assertNull(resolveLeavingUserId(currentUserId = "", existingMarker = "   "))
    }
}
