package com.alarmtalk.app.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 워커가 네트워크 왕복을 마치고 세션을 되쓸 자격이 있는지 가르는 규칙.
 *
 * 이 판정이 조용히 느슨해지면 **로그아웃이 통째로 되돌아간다** — 비워진 저장소에 옛 세션이
 * 되살아나고, 이어지는 무료 강등이 로그아웃으로 떼어낸 알람을 로그인 화면 뒤에서 다시
 * 예약한다. 목록은 소유자 필터에 가려 안 보이는데 리시버는 Room 을 직접 읽어 울리므로,
 * 사용자에게는 '보이지도 않고 끌 수도 없는 알람' 이 된다(Codex #665 P1).
 */
class SessionSurvivedForWriteTest {

    @Test
    fun writesWhenTheSessionIsStillTheOneThatStarted() {
        assertTrue(
            sessionSurvivedForWrite(
                expectedGeneration = 3L,
                currentGeneration = 3L,
                currentToken = "token-live",
            ),
        )
    }

    @Test
    fun refusesWhenTheSessionEndedMidflight() {
        // clear() 가 세대를 올렸다 = 그 사이 로그아웃·탈퇴·자동 401 이 있었다.
        assertFalse(
            sessionSurvivedForWrite(
                expectedGeneration = 3L,
                currentGeneration = 4L,
                currentToken = null,
            ),
        )
    }

    @Test
    fun refusesWhenTheSessionEndedAndTheSameAccountSignedInAgain() {
        // 같은 계정으로 다시 로그인해 토큰이 다시 채워져 있어도 세대가 다르면 남이다.
        // 여기서 통과시키면 폐기된 옛 토큰이 새 세션을 덮어쓴다.
        assertFalse(
            sessionSurvivedForWrite(
                expectedGeneration = 3L,
                currentGeneration = 4L,
                currentToken = "token-from-the-new-session",
            ),
        )
    }

    @Test
    fun refusesWhenTheTokenIsGoneEvenThoughTheGenerationMatches() {
        // 세대가 같은데 토큰만 비는 경로(부분 실패 등)에서도 쓰면 안 된다 — 세션이 없는
        // 상태에 쓰는 것은 저장이 아니라 부활이다.
        assertFalse(
            sessionSurvivedForWrite(
                expectedGeneration = 0L,
                currentGeneration = 0L,
                currentToken = null,
            ),
        )
        assertFalse(
            sessionSurvivedForWrite(
                expectedGeneration = 0L,
                currentGeneration = 0L,
                currentToken = "   ",
            ),
        )
    }
}
