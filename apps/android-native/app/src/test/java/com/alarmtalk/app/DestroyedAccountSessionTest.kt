package com.alarmtalk.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.UnknownHostException
import retrofit2.HttpException
import retrofit2.Response

/**
 * **파기된 계정을 세션 건강검진이 잡는다** — iOS `SessionHealthCheckDestroyedAccountTests` 의 짝.
 *
 * `GET /auth/me` 는 토큰의 sub 에 해당하는 사용자 행이 없으면 **404 `AUTH_USER_NOT_FOUND`**
 * 다(`packages/backend/src/routes/auth.ts`). 다른 라우트는 인증 미들웨어가 401 로 돌려주므로
 * (`packages/backend/src/middleware/auth.ts`) okhttp 인증기가 알아서 세션을 끊지만, 이 한
 * 갈래만 그 그물에 안 걸린다 — 놓치면 죽은 세션이 그대로 남아 **이후 모든 요청이 401 을
 * 쏟는 동안 사용자에게는 아무 안내도 가지 않는다.**
 *
 * 고정하는 경계는 둘이다:
 *  1. 404 + `AUTH_USER_NOT_FOUND` 는 401 과 **같은 갈래**(세션 종료)로 간다.
 *  2. ⚠ **코드 없는 404 는 세션을 유지한다.** 베이스 URL 오설정·라우팅 실패도 404 라,
 *     상태코드만 보고 끊으면 **설정 실수 한 번이 전체 로그아웃**이 된다.
 *
 * Robolectric 을 쓰는 이유는 `TransientFailureClassificationTest` 와 같다 — `apiError` 가
 * `org.json.JSONObject` 로 본문을 읽는데 JVM 단위 테스트에서 그건 스텁이라 코드가 늘 null 이다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DestroyedAccountSessionTest {

    @Test
    fun destroyedAccountIsRecognizedByCodeNotByStatusAlone() {
        assertTrue(isDestroyedAccountFailure(httpException(404, """{"error_code":"AUTH_USER_NOT_FOUND"}""")))
    }

    @Test
    fun a404WithoutACodeKeepsTheSession() {
        // ⚠ 잘못된 베이스 URL·라우팅 실패도 404 다. 여기서 끊으면 서버 설정 실수 한 번이
        // 전체 사용자 로그아웃이 된다 — 되돌릴 수 없는 종류의 사고다.
        assertFalse(isDestroyedAccountFailure(httpException(404, "")))
        assertFalse(isDestroyedAccountFailure(httpException(404, "<html>Not Found</html>")))
    }

    @Test
    fun a404WithAnotherCodeKeepsTheSession() {
        // 자원이 없다는 뜻의 404 는 세션과 무관하다.
        assertFalse(isDestroyedAccountFailure(httpException(404, """{"error_code":"ALARM_NOT_FOUND"}""")))
    }

    @Test
    fun unauthorizedIsNotThisBranch() {
        // 401 은 okhttp 인증기가 이미 `handleUnauthorized` 로 수렴시킨다. 여기서 또 가르면
        // 같은 만료가 두 번 처리되고, 무엇보다 **errorBody 를 한 번 더 읽으려 든다.**
        assertFalse(isDestroyedAccountFailure(httpException(401, """{"error_code":"AUTH_USER_NOT_FOUND"}""")))
    }

    @Test
    fun networkFailuresKeepTheSession() {
        // 비행기 모드·캡티브 포털에서 로그아웃시키지 않는다.
        assertFalse(isDestroyedAccountFailure(UnknownHostException("api.alarm-talk.com")))
        assertFalse(isDestroyedAccountFailure(IllegalStateException("bug")))
    }

    @Test
    fun onlyA404OpensTheErrorBody() {
        // ⚠ `errorBody` 는 한 번만 읽힌다. 404 가 아닐 때 본문을 열면 그 뒤 코드를 보려던
        // 호출부가 빈 본문을 받는다 — 상태코드를 먼저 보는 순서가 계약이다.
        val other = httpException(403, """{"error_code":"CONSENT_REQUIRED"}""")
        assertFalse(isDestroyedAccountFailure(other))
        assertEquals("""{"error_code":"CONSENT_REQUIRED"}""", other.response()?.errorBody()?.string())
    }

    private fun httpException(code: Int, body: String): HttpException =
        HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))
}
