package com.alarmtalk.app.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 세션을 비울 때 남기는 값은 "마지막에 로그인했던 사람"이 아니라 **"아직 소유자를 못 새긴
 * 알람의 임자"**다. 정리가 끝나면 지워지므로, 값이 남아 있다는 것 자체가 미해결을 뜻한다.
 *
 * 그래서 기존 값이 우선이다 — A 의 소유권이 미해결인 채 B 가 들어와 쓰다 나가도 그 행들은
 * 여전히 A 것이다. 여기서 B 로 덮으면 A 가 알람을 영영 잃는다(Codex #650).
 */
class PendingOwnerUserIdTest {

    @Test
    fun keepsTheUnresolvedOwnerWhenAnotherAccountLeaves() {
        assertEquals(
            "account-A",
            resolvePendingOwnerUserId(leavingUserId = "account-B", existingPendingOwner = "account-A"),
        )
    }

    @Test
    fun recordsTheLeavingAccountWhenNothingIsPending() {
        assertEquals(
            "account-B",
            resolvePendingOwnerUserId(leavingUserId = "account-B", existingPendingOwner = null),
        )
    }

    /** 이 빌드 이전에 로그인해 둔 세션 — 표시가 없고 세션 사용자만 있다. */
    @Test
    fun upgradedSessionWithoutAMarkerStillYieldsTheLeavingAccount() {
        assertEquals(
            "account-A",
            resolvePendingOwnerUserId(leavingUserId = "account-A", existingPendingOwner = ""),
        )
    }

    /** 이미 비운 뒤 다시 불린 경우 — 미해결 임자를 잃으면 안 된다. */
    @Test
    fun keepsThePendingOwnerWhenTheSessionIsAlreadyCleared() {
        assertEquals(
            "account-A",
            resolvePendingOwnerUserId(leavingUserId = null, existingPendingOwner = "account-A"),
        )
        assertEquals(
            "account-A",
            resolvePendingOwnerUserId(leavingUserId = "  ", existingPendingOwner = "account-A"),
        )
    }

    /** 로그인한 적 없는 기기 — 미해결도 없다. */
    @Test
    fun staysUnsetWhenNoAccountHasEverSignedIn() {
        assertNull(resolvePendingOwnerUserId(leavingUserId = null, existingPendingOwner = null))
        assertNull(resolvePendingOwnerUserId(leavingUserId = "", existingPendingOwner = "   "))
    }
}
