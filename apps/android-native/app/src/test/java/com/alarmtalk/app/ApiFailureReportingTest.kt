package com.alarmtalk.app

import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.network.ApiFailure
import com.alarmtalk.app.network.ReportedApiFailure
import com.alarmtalk.app.network.apiErrorCode
import java.net.UnknownHostException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response

/**
 * **API 실패는 코드와 호출 자리로 묶는다** — `docs/spec/error-codes.md` §3 「앱의 묶음 키」.
 *
 * Retrofit 은 모든 비-2xx 응답을 **같은 콜백 프레임**에서 던진다. 스택이 하나라 Sentry 의 기본
 * 묶음으로는 엔드포인트가 달라도 한 이슈였고, R8 이 그 콜백의 이름을 바꿀 때마다 새 잡동사니
 * 이슈가 열렸다(ANDROID-B → K → Q). 1.2.10 의 Q 42건에는 이메일 인증 거절·목소리 월 한도 429·
 * 사전 출시 로봇의 504 가 한데 섞여 있었고, 제목은 `b5.o: HTTP 429` 였다.
 *
 * 여기서 고정하는 것은 **무엇을 올리는가**다([AlarmTalkLog.issueReportFor]) — 지문·태그·포장.
 * ⚠ 그것이 실제 이벤트에 실리는지는 이 테스트가 못 본다. 유닛 테스트에서는 Sentry 가 켜지지 않는다
 * (`shouldInitializeSentry`). dev 빌드 이벤트 한 건으로 확인한다.
 *
 * 낮추는 범위(브레드크럼)는 이 규칙으로 바뀌지 않는다 — 그 경계는
 * `TransientFailureClassificationTest` 가 그대로 지킨다. Robolectric 을 쓰는 이유도 그 테스트와 같다
 * (`org.json` 이 JVM 단위 테스트에서는 스텁이다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ApiFailureReportingTest {

    // ── logKey — 어디서 부른 실패인가 ─────────────────────────────────────

    @Test
    fun logKeyDropsValueTokens() {
        assertEquals(
            "Failed to promote voice draft",
            AlarmTalkLog.logKeyOf("Failed to promote voice draft id=9264e503-8579-4fc1-827c-8bb0048c7ab4"),
        )
        assertEquals(
            "Google sign-in failed",
            AlarmTalkLog.logKeyOf("Google sign-in failed resultCode=0 statusCode=10"),
        )
        assertEquals(
            "Failed to cancel subscription",
            AlarmTalkLog.logKeyOf("Failed to cancel subscription mode=at_period_end"),
        )
        // 값 토큰이 없으면 그대로다 — 뜻이 있는 낱말은 건드리지 않는다.
        assertEquals("Email verification confirm failed", AlarmTalkLog.logKeyOf("Email verification confirm failed"))
        // 값이 빈 토큰(`id=`)도 토큰이다.
        assertEquals("Failed to sync alarm", AlarmTalkLog.logKeyOf("Failed to sync alarm id="))
    }

    @Test
    fun messagesThatDifferOnlyByAnIdShareAFingerprint() {
        // ⚠ 메시지를 그대로 지문에 넣으면 목소리 id 마다 이슈가 하나씩 생긴다.
        val first = AlarmTalkLog.apiFailureFingerprint(
            http(429, """{"error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}"""),
            "Failed to promote voice draft id=9264e503-8579-4fc1-827c-8bb0048c7ab4",
        )
        val second = AlarmTalkLog.apiFailureFingerprint(
            http(429, """{"error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}"""),
            "Failed to promote voice draft id=00000000-0000-0000-0000-000000000000",
        )
        assertEquals(
            listOf("api_error", "VOICE_MONTHLY_CHANGE_LIMIT_REACHED", "Failed to promote voice draft"),
            first,
        )
        assertEquals(first, second)
    }

    // ── 지문의 세 모양 ───────────────────────────────────────────────────

    @Test
    fun differentCodesOnTheSameStatusAreDifferentIssues() {
        val message = "Failed to promote voice draft id=a"
        val monthly = AlarmTalkLog.apiFailureFingerprint(
            http(429, """{"error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}"""),
            message,
        )
        val rateLimited = AlarmTalkLog.apiFailureFingerprint(http(429, """{"error_code":"RATE_LIMITED"}"""), message)
        assertNotEquals(monthly, rateLimited)
        assertEquals(listOf("api_error", "RATE_LIMITED", "Failed to promote voice draft"), rateLimited)
    }

    @Test
    fun theSameCodeFromTwoCallSitesIsTwoIssues() {
        // 코드가 있는 응답은 우리 워커가 낸 것이다 — 어느 라우트가 500 을 냈는지가 원인을 가른다.
        val body = """{"error_code":"INTERNAL_ERROR"}"""
        val push = AlarmTalkLog.apiFailureFingerprint(http(500, body), "Push token register failed")
        val login = AlarmTalkLog.apiFailureFingerprint(http(500, body), "Email login failed")
        assertEquals(listOf("api_error", "INTERNAL_ERROR", "Push token register failed"), push)
        assertNotEquals(push, login)
    }

    @Test
    fun aCodelessServerErrorDropsTheCallSite() {
        // 코드 없는 5xx 는 워커 **앞단**(게이트웨이·프록시)이 낸 것이다. 어느 화면이 불렀는지는
        // 원인을 가르지 않는다 — 사전 출시 로봇의 504 는 로그 메시지가 일곱 가지였다.
        val html = "<html><body><h1>504 Gateway Time-out</h1></body></html>"
        val messages = listOf(
            "Failed to load voice profiles",
            "Email login failed",
            "Failed to rename voice profile id=v1",
            "Failed to sync alarm id=3",
        )
        for (message in messages) {
            assertEquals(message, listOf("api_error", "HTTP_504"), AlarmTalkLog.apiFailureFingerprint(http(504, html), message))
        }
        // 본문이 아예 없어도 같다.
        assertEquals(listOf("api_error", "HTTP_502"), AlarmTalkLog.apiFailureFingerprint(http(502, ""), "Email login failed"))
    }

    @Test
    fun aCodelessClientErrorKeepsTheCallSite() {
        // 코드 없는 4xx 는 주소·라우팅이 틀린 자리를 가리킨다 — 호출 자리를 남긴다.
        assertEquals(
            listOf("api_error", "HTTP_404", "Failed to load voice profiles"),
            AlarmTalkLog.apiFailureFingerprint(http(404, "<html>Not Found</html>"), "Failed to load voice profiles"),
        )
        assertNotEquals(
            AlarmTalkLog.apiFailureFingerprint(http(404, ""), "Failed to load voice profiles"),
            AlarmTalkLog.apiFailureFingerprint(http(404, ""), "Email login failed"),
        )
    }

    @Test
    fun nonHttpErrorsKeepTheDefaultGrouping() {
        assertNull(AlarmTalkLog.apiFailureFingerprint(IllegalStateException("bug"), "Failed to sync alarm id=3"))
        assertNull(AlarmTalkLog.apiFailureFingerprint(UnknownHostException("api.alarm-talk.com"), "Email login failed"))

        val error = IllegalStateException("bug")
        val report = AlarmTalkLog.issueReportFor("Failed to sync alarm id=3", error)
        // 포장하지 않는다 — 원래 예외와 그 스택이 그대로 묶음의 근거다.
        assertSame(error, report.throwable)
        assertNull(report.fingerprint)
        assertEquals(mapOf("log.key" to "Failed to sync alarm"), report.tags)
    }

    // ── 올리는 것 한 건 — 포장·지문·태그 ──────────────────────────────────

    @Test
    fun anApiFailureIsReportedAsAReadableWrapper() {
        val original = http(429, """{"error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}""")
        val report = AlarmTalkLog.issueReportFor("Failed to promote voice draft id=9264e503", original)

        val wrapper = report.throwable as ReportedApiFailure
        assertEquals("[VOICE_MONTHLY_CHANGE_LIMIT_REACHED] Failed to promote voice draft (HTTP 429)", wrapper.message)
        // 원래 예외는 cause 로 남는다 — 스택과 Retrofit 의 응답이 사라지지 않는다.
        assertSame(original, wrapper.cause)
        assertEquals(ApiFailure(429, "VOICE_MONTHLY_CHANGE_LIMIT_REACHED"), wrapper.failure)
        // ⚠ 이 패키지가 통째로 keep 이라(`proguard-rules.pro`) 릴리스에서도 이름이 남는다. 옮기면
        // 이슈 제목이 다시 `a.b` 가 된다.
        assertTrue(ReportedApiFailure::class.java.name.startsWith("com.alarmtalk.app.network."))

        assertEquals(
            listOf("api_error", "VOICE_MONTHLY_CHANGE_LIMIT_REACHED", "Failed to promote voice draft"),
            report.fingerprint,
        )
        assertEquals(
            mapOf(
                "log.key" to "Failed to promote voice draft",
                "api.status" to "429",
                "api.error_code" to "VOICE_MONTHLY_CHANGE_LIMIT_REACHED",
            ),
            report.tags,
        )
    }

    @Test
    fun aCodelessFailureIsTitledByItsStatus() {
        val report = AlarmTalkLog.issueReportFor("Email login failed", http(504, "<html>gateway</html>"))
        assertEquals("[HTTP_504] Email login failed (HTTP 504)", report.throwable.message)
        assertEquals(listOf("api_error", "HTTP_504"), report.fingerprint)
        // 코드가 없으면 그 태그는 달지 않는다(빈 값으로 채우지 않는다).
        assertEquals(mapOf("log.key" to "Email login failed", "api.status" to "504"), report.tags)
        assertFalse(report.tags.containsKey("api.error_code"))
    }

    @Test
    fun aWrappedApiFailureIsStillAnApiFailure() {
        // 도메인 예외로 한 번 감싼 실패도 같은 이슈에 붙는다 — 포장의 cause 는 **넘겨받은** 예외다.
        val http = http(500, """{"error_code":"INTERNAL_ERROR"}""")
        val domain = IllegalStateException("sync failed", http)
        val report = AlarmTalkLog.issueReportFor("Failed to sync alarm id=7", domain)
        assertEquals(
            listOf("api_error", "INTERNAL_ERROR", "Failed to sync alarm"),
            report.fingerprint,
        )
        assertSame(domain, report.throwable.cause)
    }

    @Test
    fun reportingDoesNotTakeTheErrorBodyFromTheCaller() {
        // 목소리 경로는 보고 **뒤에** 코드를 읽는다(`promoteVoiceDraft`). 보고가 본문을 소진하면
        // 그 호출부가 문구를 잃는다 — 묶음 키를 만든 뒤에도 코드가 그대로 읽혀야 한다.
        val error = http(429, """{"error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}""")
        AlarmTalkLog.issueReportFor("Failed to promote voice draft id=a", error)
        assertEquals("VOICE_MONTHLY_CHANGE_LIMIT_REACHED", apiErrorCode(error))
        assertEquals(
            """{"error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}""",
            error.response()?.errorBody()?.string(),
        )
    }

    @Test
    fun groupingNeverDemotesAnything() {
        // ⚠ 묶음 키 규칙으로 브레드크럼으로 내려가는 것은 하나도 없다. 지문이 생기는 실패는 전부 여전히
        // 이슈다 — 시도를 다 태운 거절(시도 상한·월 한도)도, 코드 없는 4xx·5xx 도. (코드 없는 504 만은 중간 프록시라
        // 일시 실패로 낮춘다 — `TransientFailureClassificationTest` 의 `codelessGatewayTimeoutIsTransientButOur5xxStayIssues`.)
        val reported = listOf(
            http(429, """{"error_code":"AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"}"""),
            http(429, """{"error_code":"VOICE_MONTHLY_CHANGE_LIMIT_REACHED"}"""),
            http(404, ""),
            http(502, "<html>gateway</html>"),
        )
        for (error in reported) {
            assertNull(error.message, AlarmTalkLog.breadcrumbCategoryFor(error))
        }
        // 낮추는 것은 401·일시적 실패, 그리고 **목록에 있는** 예상된 거절뿐이다(2026-10-11 — 그 경계는
        // `TransientFailureClassificationTest` 의 `onlyListedRefusalsBecomeRefusalBreadcrumbs` 가 지킨다).
        assertEquals("auth", AlarmTalkLog.breadcrumbCategoryFor(http(401, """{"error_code":"TOKEN_REVOKED"}""")))
        assertEquals("transient", AlarmTalkLog.breadcrumbCategoryFor(UnknownHostException("api.alarm-talk.com")))
        assertEquals("refusal", AlarmTalkLog.breadcrumbCategoryFor(http(400, """{"error_code":"AUTH_EMAIL_CODE_INVALID"}""")))
    }

    private fun http(status: Int, body: String): HttpException =
        HttpException(Response.error<Any>(status, body.toResponseBody("application/json".toMediaType())))
}
