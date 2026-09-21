package com.alarmtalk.app

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **소스를 직접 읽어** 로그아웃 창(`AuthSessionStore.beginSignOut`)이 열리고 닫히는 **자리**를
 * 고정한다.
 *
 * ## 왜 런타임 테스트가 아닌가
 *
 * `AuthSessionStore` 는 `EncryptedSharedPreferences`(AndroidKeyStore)를 쓰는데 Robolectric
 * 에서 세워지지 않고, `MainViewModel` 은 저장소·워커·Room 을 통째로 물고 있다. 그래서
 * `AlarmDatabaseMigrationSafetyTest` 와 같은 방식으로 **소스의 순서**만 본다 — 여기서 지켜야
 * 하는 것은 값이 아니라 **순서**이기 때문이다.
 *
 * ## 무엇을 지키는가
 *
 * 1. **표시는 서버 호출보다 먼저 선다.** 로그아웃의 `token_epoch` 인상도, 즉시 탈퇴의 계정
 *    삭제도 **서버에서 먼저** 일어난다. 그 await 구간에 떠 있던 워커 요청이 401 로 돌아오면
 *    로컬 세대·토큰은 아직 그대로라 워커의 두 문을 **정상적으로** 통과하고, 그때 남은
 *    `session_expired_owner` 가 **방금 떼어낸 알람을 되살린다** — 로그인 화면 뒤라 끌 수도
 *    없다. `clearSignedInSession` 진입에서 세우는 것만으로는 그 앞 구간이 무방비다.
 * 2. **표시는 `finally` 에서 내려간다.** 세션 정리 중간에 예외가 나면(디스크 오류·취소)
 *    표시가 선 채로 남고, 60초 창이 닫힐 때까지의 **진짜** 자동 만료가 표시를 못 남긴다 —
 *    그 기기는 업데이트 후 재예약에서 복원 대상을 잃는다.
 */
class SignOutWindowOpensBeforeServerCallTest {

    @Test
    fun `로그아웃은 서버를 부르기 전에 창을 연다`() {
        assertOrderInBody(
            source = authActions,
            header = "internal fun MainViewModel.logout(",
            first = "markSignOutInProgress()",
            second = "api.logout(",
            why = "`api.logout` 이 서버 token_epoch 를 먼저 올린다 — 그 await 구간에 돌아온 401 이 " +
                "'자동 만료' 마커를 남기면 방금 떼어낼 알람이 로그인 화면 뒤에서 되살아난다.",
        )
    }

    @Test
    fun `탈퇴 신청도 서버를 부르기 전에 창을 연다`() {
        assertOrderInBody(
            source = authActions,
            header = "internal fun MainViewModel.requestAccountDeletion(",
            first = "markSignOutInProgress()",
            second = "api.requestAccountDeletion(",
            why = "유예 신청이 성공하면 곧바로 세션 정리로 들어간다 — 그 왕복 동안의 401 도 같은 사고를 낸다.",
        )
    }

    @Test
    fun `즉시 탈퇴도 서버를 부르기 전에 창을 연다`() {
        assertOrderInBody(
            source = authActions,
            header = "internal fun MainViewModel.deleteAccount(",
            first = "markSignOutInProgress()",
            second = "api.deleteAccount(",
            why = "계정 행이 지워지는 순간부터 떠 있던 요청이 전부 401 로 돌아온다.",
        )
    }

    @Test
    fun `서버 호출이 실패하면 표시를 도로 내린다`() {
        // 신청·삭제가 실패하면 사용자는 그대로 로그인 상태다. 표시를 남겨 두면 그 60초 동안의
        // **진짜** 자동 만료가 마커를 못 남겨, 업데이트 후 재예약이 이 기기의 알람을 잃는다.
        listOf(
            "internal fun MainViewModel.requestAccountDeletion(",
            "internal fun MainViewModel.deleteAccount(",
        ).forEach { header ->
            val body = bodyOf(authActions, header)
            assertTrue(
                "$header 의 실패 갈래에 endSignOutMarker() 가 없다 — 로그인 상태로 남는데 로그아웃 창이 " +
                    "선 채로 방치된다.",
                body.contains("endSignOutMarker()"),
            )
        }
    }

    @Test
    fun `세션 정리는 어떤 경로로 끝나도 창을 닫는다`() {
        val body = bodyOf(viewModel, "internal suspend fun clearSignedInSession(")
        val tryIndex = body.indexOf("try {")
        val finallyIndex = body.indexOf("} finally {")
        val endIndex = body.indexOf("endSignOutMarker()")
        assertTrue("clearSignedInSession 이 try 로 감싸여 있지 않다.", tryIndex >= 0)
        assertTrue("clearSignedInSession 에 finally 가 없다.", finallyIndex > tryIndex)
        assertTrue(
            "endSignOutMarker() 가 finally 밖에 있다 — 중간에 예외가 나면 로그아웃 창이 선 채로 남아, " +
                "그 사이의 진짜 자동 만료가 표시를 못 남긴다.",
            endIndex > finallyIndex,
        )
        // 떼어내기가 try 안에 있어야 그 실패가 finally 로 떨어진다.
        val detachIndex = body.indexOf("detachAlarmsOnSignOut(")
        assertTrue("detachAlarmsOnSignOut 이 try 블록 안에 없다.", detachIndex in (tryIndex + 1) until finallyIndex)
    }

    // ── 소스 읽기 ────────────────────────────────────────────────────────

    private val authActions: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModelAuthActions.kt")
    }

    private val viewModel: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModel.kt")
    }

    /** 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로. */
    private fun readSource(path: String): String {
        val file = File(path)
        assertTrue(
            "$path 를 못 찾았다(경로: ${file.absolutePath}). 파일을 옮겼으면 이 테스트의 경로도 같이 고칠 것.",
            file.exists(),
        )
        return file.readText()
    }

    /** [header] 로 시작하는 함수 본문만 잘라 낸다 — 다음 함수 선언 앞까지. */
    private fun bodyOf(source: String, header: String): String {
        val start = source.indexOf(header)
        assertTrue("$header 를 못 찾았다 — 이름이 바뀌었으면 이 테스트도 같이 고칠 것.", start >= 0)
        val rest = source.substring(start + header.length)
        return rest.substring(0, NEXT_DECLARATION.find(rest)?.range?.first ?: rest.length)
    }

    private fun assertOrderInBody(
        source: String,
        header: String,
        first: String,
        second: String,
        why: String,
    ) {
        val body = bodyOf(source, header)
        val firstIndex = body.indexOf(first)
        val secondIndex = body.indexOf(second)
        assertTrue("$header 안에 `$first` 가 없다. $why", firstIndex >= 0)
        assertTrue("$header 안에 `$second` 가 없다 — 호출이 바뀌었으면 이 테스트도 같이 고칠 것.", secondIndex >= 0)
        assertTrue("$header: `$first` 가 `$second` 보다 앞이어야 한다. $why", firstIndex < secondIndex)
    }

    private companion object {
        /** 줄 첫머리의 함수 선언. 주석(`//`)은 이 모양이 아니라 걸리지 않는다. */
        val NEXT_DECLARATION = Regex("""(?m)^[ \t]*(?:internal |private |public )?(?:suspend )?fun\s""")
    }
}
