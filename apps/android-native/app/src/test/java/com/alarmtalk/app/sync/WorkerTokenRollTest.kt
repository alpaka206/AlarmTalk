package com.alarmtalk.app.sync

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 워커가 **실행 도중 토큰을 굴렸을 때** 401 귀속이 그 토큰을 따라가는지 고정한다
 * ([tokenAfterRoll]).
 *
 * ## 왜 필요한가
 *
 * `endSessionAfterWorkerUnauthorized` 의 두 번째 문은 "내가 보낸 그 토큰이 아직 저장소에
 * 있는가"([workerMayEndSession])다. 그래서 워커가 `GET /auth/me` 로 토큰을 굴린 뒤에도
 * **시작 토큰**을 귀속에 쓰면, 굴린 다음 나간 요청이 401 을 받아도 '지나간 토큰' 으로
 * 판정돼 **끊어야 할 세션을 못 끊는다** — 그 워커는 폐기된 세션으로 계속 돌고 사용자는
 * 재로그인 안내를 못 받는다.
 *
 * 반대 방향도 같은 무게다. 헤더는 옛 토큰인데 귀속만 새 토큰으로 옮기면, **옛 토큰의 401
 * 이 방금 갱신한 멀쩡한 세션을 지운다.** 그래서 규칙은 "둘을 **함께** 옮긴다" 하나다.
 *
 * 저장소(`EncryptedSharedPreferences`)는 Robolectric 에서 세워지지 않으므로, 판정은 순수
 * 함수로 보고 **호출부가 그걸 실제로 쓰는지**는 소스로 본다
 * (`SessionExpiryPlanTest`·`AlarmDatabaseMigrationSafetyTest` 와 같은 방식).
 */
class WorkerTokenRollTest {

    @Test
    fun `굴러간 토큰이 401 귀속을 따라간다`() {
        assertEquals("token-B", tokenAfterRoll(previousToken = "token-A", savedToken = "token-B"))
    }

    @Test
    fun `저장이 거절되면 시작 토큰을 지킨다`() {
        // 세대가 올랐거나(로그아웃·계정전환) 세션이 비면 저장소가 null 을 돌려준다 — 그
        // 토큰은 우리 것이 아니다. 시작 토큰으로 두면 `workerMayEndSession` 이 저장소와
        // 대조해 아무것도 하지 않는다.
        assertEquals("token-A", tokenAfterRoll(previousToken = "token-A", savedToken = null))
        assertEquals("token-A", tokenAfterRoll(previousToken = "token-A", savedToken = ""))
        assertEquals("token-A", tokenAfterRoll(previousToken = "token-A", savedToken = "   "))
    }

    @Test
    fun `토큰을 굴리는 워커는 시작 토큰을 귀속에 넘기지 않는다`() {
        // ⚠ 두 워커 다 실행 도중 `saveTokenIfGeneration` 으로 저장 토큰을 굴린다.
        // `usedToken = session.token` 으로 되돌아가면 이 테스트가 잡는다.
        listOf(
            "src/main/java/com/alarmtalk/app/sync/StockClipPrefetchWorker.kt",
            "src/main/java/com/alarmtalk/app/sync/PlanChangeSyncWorker.kt",
        ).forEach { path ->
            val source = withoutLineComments(readSource(path))
            assertTrue(
                "$path: 토큰을 굴려 놓고 그 결과를 쓰지 않는다 — tokenAfterRoll 로 usedToken 을 옮길 것.",
                source.contains("tokenAfterRoll("),
            )
            val args = argumentsOf(source, "endSessionAfterWorkerUnauthorized(", path)
            assertTrue(
                "$path: 401 귀속에 시작 토큰을 넘기고 있다(usedToken = usedToken 이어야 한다). " +
                    "토큰이 굴러간 뒤의 401 이 '지나간 토큰' 으로 판정돼 끊어야 할 세션을 못 끊는다. 넘긴 인자: $args",
                args.contains("usedToken = usedToken"),
            )
        }
    }

    // ── 소스 읽기 ────────────────────────────────────────────────────────

    /** 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로. */
    private fun readSource(path: String): String {
        val file = File(path)
        assertTrue(
            "$path 를 못 찾았다(경로: ${file.absolutePath}). 파일을 옮겼으면 이 테스트의 경로도 같이 고칠 것.",
            file.exists(),
        )
        return file.readText()
    }

    /** 주석 속 괄호가 아래 괄호 세기를 망치지 않게 줄 주석을 걷어 낸다. */
    private fun withoutLineComments(source: String): String =
        source.lineSequence().joinToString("\n") { line -> line.substringBefore("//") }

    /** [call] 호출의 인자 목록만 잘라 낸다(괄호를 세어 짝을 찾는다). */
    private fun argumentsOf(source: String, call: String, path: String): String {
        val start = source.indexOf(call)
        assertTrue("$path 에서 $call 를 못 찾았다 — 호출이 바뀌었으면 이 테스트도 같이 고칠 것.", start >= 0)
        var depth = 0
        var index = start + call.length - 1
        while (index < source.length) {
            when (source[index]) {
                '(' -> depth++
                ')' -> {
                    depth--
                    if (depth == 0) return source.substring(start + call.length, index)
                }
            }
            index++
        }
        error("$path: $call 의 닫는 괄호를 못 찾았다")
    }
}
