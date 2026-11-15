package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 위쪽 안내 자리(`TopMessageHost`)가 로그인 **전** 화면에도 있는가(2026-11-15 오너 — "인증 코드를 보냈어요" 는 위쪽 토스트로).
 *
 * 예전에는 그 자리가 로그인 뒤 화면에만 있어서, 로그인 전 화면(랜딩·로그인·가입·비밀번호 찾기)에서 올린 안내는 뜨지 않고
 * 쌓였다가 로그인한 뒤에야 나왔다. 규칙: `docs/spec/session-and-auth.md` 「거절 뒤에 할 일이 화면에 있어야 한다」의
 * '보냈다는 안내는 위쪽 토스트다'. ⚠ 실제로 보이는지는 기기로만 확인된다.
 */
class TopMessageHostWiringTest {
    @Test
    fun `로그인 전과 뒤 화면이 같은 위쪽 안내 자리를 쓴다`() {
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        assertEquals(
            "로그인 전 갈래와 로그인 뒤 본문이 각각 위쪽 안내 자리를 그려야 한다.",
            2,
            Regex("""TopMessageHost\(hostState = snackbarHostState""").findAll(app).count(),
        )
        // 로그인 전 갈래 = 인증 화면 라우팅(`when (val route = authRoute)`)을 품은 블록 — 그다음 `return@Scaffold` 까지.
        val routing = app.indexOf("when (val route = authRoute)")
        assertTrue("인증 화면 라우팅을 못 찾았다.", routing >= 0)
        val authBranch = app.substring(app.lastIndexOf("if (authSession == null) {", routing), app.indexOf("return@Scaffold", routing))
        assertTrue("로그인 전 갈래에 위쪽 안내 자리가 없다.", authBranch.contains("TopMessageHost(hostState = snackbarHostState"))
    }
}
