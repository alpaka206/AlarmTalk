package com.alarmtalk.app.sync

import com.alarmtalk.app.network.signOutWindowOpen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 워커가 401 로 세션을 끝낼 때의 **순서와 갈래**를 고정한다
 * ([sessionExpiryPlan] / [com.alarmtalk.app.network.signOutWindowOpen]).
 *
 * ## 왜 순서에 테스트가 필요한가
 *
 * `markSessionExpired` 가 `clear()` **뒤**로 가면 `session_expired_owner` 가 비어 버린다.
 * 그 값은 "자동으로 끊긴 계정" 의 유일한 근거라, 비면 업데이트 후 재예약이 복원 대상을 잃고
 * **이 기기의 알람이 조용히 안 울린다.** 아무 예외도 나지 않고 화면도 멀쩡해서, 순서를
 * 뒤집는 수정은 리뷰에서도 잘 안 보인다.
 *
 * ## 왜 저장소를 띄우지 않는가
 *
 * `AuthSessionStore` 는 `EncryptedSharedPreferences`(AndroidKeyStore)를 쓰는데 Robolectric
 * 에서 세워지지 않는다. 그래서 **무엇을 어떤 순서로 밟을지**를 순수 함수로 뽑아 두고
 * (`SyncWorkerFailure.kt`), 여기서는 그 목록만 본다. 실행부는 목록을 그대로 도는 `when`
 * 하나다 — `workerMayEndSession`·`sessionSurvivedForWrite` 와 같은 방식이다.
 */
class SessionExpiryPlanTest {

    // ── 순서 ─────────────────────────────────────────────────────────────

    @Test
    fun marksExpiredOwnerBeforeClearingTheSession() {
        // ⚠ 이 순서가 계약이다. 뒤집히면 `session_expired_owner` 가 비어,
        // 업데이트 후 재예약이 되살릴 알람을 못 찾는다.
        assertEquals(
            listOf(
                SessionExpiryStep.MARK_EXPIRED,
                SessionExpiryStep.INVALIDATE_MANIFEST_TICKETS,
                SessionExpiryStep.CLEAR_SESSION,
            ),
            sessionExpiryPlan(
                usedToken = TOKEN,
                storedToken = TOKEN,
                signOutInProgress = false,
                userId = USER,
            ),
        )
    }

    @Test
    fun invalidatesManifestTicketsBeforeClearingTheSession() {
        // 표를 죽이는 것이 `clear()` 앞이어야, 세션이 끝난 뒤 도착한 앞 계정의 응답이
        // 디스크 매니페스트를 다시 공개하지 못한다(Codex #703 P1).
        val plan = sessionExpiryPlan(TOKEN, TOKEN, signOutInProgress = false, userId = USER)
        assertTrue(
            plan.indexOf(SessionExpiryStep.INVALIDATE_MANIFEST_TICKETS) <
                plan.indexOf(SessionExpiryStep.CLEAR_SESSION),
        )
    }

    // ── 명시적 로그아웃 창 ───────────────────────────────────────────────

    @Test
    fun doesNotMarkExpiryDuringAnExplicitSignOut() {
        // ⚠ 로그아웃 창에서는 세대·토큰 두 문이 아무것도 막지 못한다 — 서버 `token_epoch` 가
        // 먼저 오르고 로컬 세대는 마지막 `clear()` 에서야 오르기 때문이다. 여기서 만료
        // 표시를 남기면 방금 떼어낸 알람이 다음 재예약에서 되살아나고, 목록은 로그인 화면에
        // 가려 **끌 수도 없다.**
        assertEquals(
            listOf(
                SessionExpiryStep.INVALIDATE_MANIFEST_TICKETS,
                SessionExpiryStep.CLEAR_SESSION,
            ),
            sessionExpiryPlan(
                usedToken = TOKEN,
                storedToken = TOKEN,
                signOutInProgress = true,
                userId = USER,
            ),
        )
    }

    @Test
    fun stillCleansUpDuringAnExplicitSignOut() {
        // 건너뛰는 것은 **표시뿐**이다. 세션 정리는 그대로 한다 — 어차피 끝날 세션이고
        // `clear()` 는 멱등이라, 여기서 멈추면 로그아웃이 중간에 끊겼을 때 토큰이 남는다.
        val plan = sessionExpiryPlan(TOKEN, TOKEN, signOutInProgress = true, userId = USER)
        assertTrue(plan.contains(SessionExpiryStep.CLEAR_SESSION))
    }

    // ── 그 앞의 두 문(토큰·계정) ─────────────────────────────────────────

    @Test
    fun doesNothingWhenTheTokenAlreadyRolled() {
        // `GET /auth/me` 의 rolling refresh 는 같은 세션 안에서 토큰만 갈아 끼운다.
        // 옛 토큰의 뒤늦은 401 로 **방금 갱신한 멀쩡한 세션**을 지우면 안 된다.
        assertEquals(
            emptyList<SessionExpiryStep>(),
            sessionExpiryPlan(TOKEN, "token-B", signOutInProgress = false, userId = USER),
        )
    }

    @Test
    fun doesNothingWhenTheStoreIsAlreadyEmpty() {
        // 이미 비었으면 끊을 세션이 없다 — 거기에 쓰는 것은 정리가 아니라 부활이다.
        assertEquals(
            emptyList<SessionExpiryStep>(),
            sessionExpiryPlan(TOKEN, null, signOutInProgress = false, userId = USER),
        )
        assertEquals(
            emptyList<SessionExpiryStep>(),
            sessionExpiryPlan(TOKEN, "", signOutInProgress = false, userId = USER),
        )
    }

    @Test
    fun skipsTheMarkerWhenTheOwnerIsUnknown() {
        // 계정을 모르면 남길 표시가 없다(빈 값을 적으면 `sessionExpiredOwnerUserId` 가
        // 그걸 소유자로 읽는다). 정리는 그대로 한다.
        assertEquals(
            listOf(
                SessionExpiryStep.INVALIDATE_MANIFEST_TICKETS,
                SessionExpiryStep.CLEAR_SESSION,
            ),
            sessionExpiryPlan(TOKEN, TOKEN, signOutInProgress = false, userId = "  "),
        )
    }

    // ── 로그아웃 표시는 스스로 닫힌다 ────────────────────────────────────

    @Test
    fun signOutWindowIsOpenRightAfterItStarts() {
        assertTrue(signOutWindowOpen(startedAtMillis = 1_000L, nowMillis = 1_500L, windowMillis = 60_000L))
    }

    @Test
    fun signOutWindowClosesByItselfAfterACrash() {
        // ⚠ 로그아웃 도중 프로세스가 죽으면 표시를 내려 줄 사람이 없다. 불리언이었다면
        // **영원히 서 있어**, 그 뒤의 진짜 자동 만료가 표시를 못 남긴다(= 업데이트 후
        // 알람이 안 울린다). 시각이라 창이 지나면 다음 실행이 알아서 회복한다.
        assertFalse(signOutWindowOpen(startedAtMillis = 1_000L, nowMillis = 61_001L, windowMillis = 60_000L))
        assertFalse(signOutWindowOpen(startedAtMillis = 1_000L, nowMillis = 999_999L, windowMillis = 60_000L))
    }

    @Test
    fun signOutWindowIsClosedWhenNobodyEverStartedOne() {
        // 값이 없는 기기(이 빌드 이전 상태 포함)는 0 이다.
        assertFalse(signOutWindowOpen(startedAtMillis = 0L, nowMillis = 5_000L, windowMillis = 60_000L))
    }

    @Test
    fun signOutWindowIsClosedWhenTheClockWentBackwards() {
        // 시계가 뒤로 튀면 음수다. 이때의 결말(표시 없음)은 이 수정 이전과 같아,
        // 새 실패 모드가 생기지 않는다.
        assertFalse(signOutWindowOpen(startedAtMillis = 10_000L, nowMillis = 1_000L, windowMillis = 60_000L))
    }

    private companion object {
        const val TOKEN = "token-A"
        const val USER = "user-1"
    }
}
