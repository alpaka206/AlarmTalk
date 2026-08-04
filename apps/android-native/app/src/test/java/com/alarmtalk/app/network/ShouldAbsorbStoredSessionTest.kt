package com.alarmtalk.app.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 백그라운드 워커가 저장소에만 쓴 세션 갱신을, 이미 살아 있는 화면이 끌어와도 되는지.
 *
 * 느슨해지면 **로그아웃한 세션이 되살아나고**, 빡빡해지면 **좀비 세션**이 남는다 — 화면은
 * '로그인됨' 인데 메모리의 옛 토큰이 만료돼 서버 호출이 전부 실패하고, 그 401 은
 * '저장소에 더 새 토큰이 있다' 는 이유로 무시돼 안내조차 안 뜬다(Codex #665 P2).
 */
class ShouldAbsorbStoredSessionTest {

    private fun session(token: String, userId: String = "user-1", name: String = "User") =
        AuthSession(
            token = token,
            provider = AuthSessionStore.PROVIDER_APP,
            user = AuthUser(id = userId, email = "user@example.com", name = name),
        )

    @Test
    fun absorbsAFresherTokenForTheSameAccount() {
        assertTrue(
            shouldAbsorbStoredSession(
                stored = session("token-rolled"),
                current = session("token-old"),
                signingOut = false,
            ),
        )
    }

    @Test
    fun absorbsAProfileUpdateForTheSameAccount() {
        // 토큰이 같아도 프로필이 갱신됐으면 화면이 쓰는 값까지 맞춰 준다.
        assertTrue(
            shouldAbsorbStoredSession(
                stored = session("token-a", name = "새 이름"),
                current = session("token-a", name = "옛 이름"),
                signingOut = false,
            ),
        )
    }

    @Test
    fun doesNothingWhenTheStoreAlreadyMatches() {
        assertFalse(
            shouldAbsorbStoredSession(
                stored = session("token-a"),
                current = session("token-a"),
                signingOut = false,
            ),
        )
    }

    @Test
    fun refusesToReviveASessionThatWasJustCleared() {
        // 로그아웃 직후 저장소는 비어 있다. 여기서 끌어오면 세션 정리를 되돌리는 셈이다.
        assertFalse(
            shouldAbsorbStoredSession(
                stored = null,
                current = session("token-a"),
                signingOut = false,
            ),
        )
    }

    @Test
    fun refusesWhileSigningOut() {
        // 로그아웃이 진행 중이면 저장소에 아직 값이 남아 있어도 끌어오지 않는다 —
        // 그 순간 되쓰면 방금 떼어낸 알람이 로그인 화면 뒤에서 되살아난다.
        assertFalse(
            shouldAbsorbStoredSession(
                stored = session("token-a"),
                current = session("token-old"),
                signingOut = true,
            ),
        )
    }

    @Test
    fun refusesWhenTheAccountDiffers() {
        // 계정 전환은 정리와 함께 로그인 경로가 처리한다. 여기서 갈아 끼우면 앞 계정 화면에
        // 뒷 계정 세션이 얹힌다.
        assertFalse(
            shouldAbsorbStoredSession(
                stored = session("token-b", userId = "user-2"),
                current = session("token-a", userId = "user-1"),
                signingOut = false,
            ),
        )
    }

    @Test
    fun refusesWhenNobodyIsSignedInYet() {
        // 로그인은 로그인 경로가 한다 — 관찰자가 대신 로그인시키면 안 된다.
        assertFalse(
            shouldAbsorbStoredSession(
                stored = session("token-a"),
                current = null,
                signingOut = false,
            ),
        )
    }
}
