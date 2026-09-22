package com.alarmtalk.app

import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.sync.SyncWorkerOutcome
import com.alarmtalk.app.sync.syncWorkerOutcome
import com.alarmtalk.app.sync.workerMayEndSession
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ExecutionException
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Status
import javax.net.ssl.SSLHandshakeException
import okhttp3.internal.http2.ConnectionShutdownException
import okhttp3.internal.http2.ErrorCode
import okhttp3.internal.http2.StreamResetException
import kotlin.coroutines.cancellation.CancellationException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response

/**
 * 「기록은 전부, 경보는 골라서」 의 앱 쪽 — `docs/spec/error-codes.md` §3.
 *
 * 2026-09-14 1.2.6 출시 직후 Sentry 미해결 11건 중 8건이 코루틴 취소·일시적 네트워크 실패·
 * 동의 전 403 이었고, 실제 크래시(빌링) 한 건이 그 아래 깔려 있었다. 이 테스트는 그 셋이
 * 다시 이슈로 올라가지 않게, 그리고 **진짜 결함까지 같이 묻히지 않게** 경계를 고정한다.
 *
 * 2026-09-21 에 **401** 이 같은 목록에 들어왔다(ANDROID-M). 중앙 401 처리기가 세션을 끊고
 * 재로그인을 안내하므로 사용자에게 이미 닿은 사실인데, 그 위에 이슈까지 쌓이던 데다
 * 워커 둘이 401 에도 `Result.retry()` 를 돌려줘 **영원히 재시도**하며 회차마다 한 건씩
 * 올렸다.
 *
 * Robolectric 을 쓰는 이유: `apiErrorCode` 가 `org.json.JSONObject` 로 본문을 읽는데, JVM
 * 단위 테스트에서 그건 스텁이라 코드가 늘 null 로 나온다(`SessionTokenRenewalTest` 와 같다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TransientFailureClassificationTest {

    // ── 이슈로 올리지 않는 것 ─────────────────────────────────────────────

    @Test
    fun coroutineCancellationIsNotAnError() {
        // WorkManager 가 REPLACE 로 워커를 대체할 때마다 나던 "Job was cancelled".
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(CancellationException("Job was cancelled")))
    }

    @Test
    fun transientNetworkFailuresAreBreadcrumbsNotIssues() {
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(UnknownHostException("Unable to resolve host")))
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(SocketTimeoutException("timeout")))
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(ConnectException("Failed to connect")))
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(SSLHandshakeException("captive portal")))
        // OkHttp 의 호출 시간초과는 부모 클래스로 온다.
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(InterruptedIOException("timeout")))
    }

    @Test
    fun http2ResetsAreTransient() {
        // 2026-09-22 ANDROID-N: 엣지가 스트림을 끊은 `stream was reset: CANCEL` 이 이슈로 올라갔다.
        // 워커는 어차피 재시도한다 — `IOException` 의 다른 하위 타입이라 목록에서 빠져 있었다.
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(StreamResetException(ErrorCode.CANCEL)))
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(ConnectionShutdownException()))
        assertEquals("transient", AlarmTalkLog.breadcrumbCategoryFor(StreamResetException(ErrorCode.REFUSED_STREAM)))
    }

    @Test
    fun googleSignInUserActionsAreBreadcrumbsAndConfigErrorsStillReport() {
        // 2026-09-22 ANDROID-P: 로보가 로그인 버튼을 연타한 12502 가 이슈로 올라갔다.
        assertEquals("user", AlarmTalkLog.breadcrumbCategoryFor(ApiException(Status(12501))))
        assertEquals("user", AlarmTalkLog.breadcrumbCategoryFor(ApiException(Status(12502))))
        assertEquals("user", AlarmTalkLog.breadcrumbCategoryFor(IllegalStateException("wrapped", ApiException(Status(12501)))))
        // 네트워크(7)는 일시적 실패와 같은 갈래.
        assertEquals("transient", AlarmTalkLog.breadcrumbCategoryFor(ApiException(Status(7))))
        // 설정 오류(10)·실패(12500)는 우리가 고칠 것이 있다 — 그대로 이슈.
        assertNull(AlarmTalkLog.breadcrumbCategoryFor(ApiException(Status(10))))
        assertNull(AlarmTalkLog.breadcrumbCategoryFor(ApiException(Status(12500))))
        assertFalse(AlarmTalkLog.isGoogleSignInUserAction(ApiException(Status(10))))
    }

    @Test
    fun networkFailureWrappedInDomainExceptionIsStillTransient() {
        val wrapped = IllegalStateException("sync failed", UnknownHostException("api.alarm-talk.com"))
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(wrapped))
    }

    @Test
    fun fcmRetryableCodesAreTransient() {
        // `FirebaseMessaging.getToken` 이 실제로 던지는 모양 그대로.
        val fcm = IOException(ExecutionException(IOException("INTERNAL_SERVER_ERROR")))
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(fcm))
        assertTrue(AlarmTalkLog.isExpectedTransientFailure(IOException("SERVICE_NOT_AVAILABLE")))
    }

    // ── 그대로 이슈로 올리는 것 — 여기가 무너지면 진짜 결함이 사라진다 ────────

    @Test
    fun nonNetworkIoFailuresStillReport() {
        // 파일 없음·디스크 가득참은 결함일 수 있다. `IOException` 전체를 낮추면 안 된다.
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(FileNotFoundException("clip.mp3")))
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(IOException("ENOSPC (No space left on device)")))
        // FCM 의 영구 오류는 재시도 목록에 없다.
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(IOException("TOO_MANY_REGISTRATIONS")))
    }

    @Test
    fun programmingErrorsStillReport() {
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(IllegalStateException("bug")))
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(NullPointerException()))
    }

    @Test
    fun httpFailuresAreNotClassifiedHere() {
        // 4xx 는 호출부가 error_code 를 보고 가른다 — errorBody 가 한 번만 읽히기 때문이다.
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(httpException(403, """{"error_code":"CONSENT_REQUIRED"}""")))
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(httpException(500, "")))
        // 401 도 여기서는 false 다 — 별개의 갈래([isHandledAuthFailure])로 센다.
        // 하나로 뭉치면 브레드크럼이 "네트워크가 나빴다" 로 읽혀 맥락이 사라진다.
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(httpException(401, "")))
    }

    @Test
    fun causeCycleDoesNotHang() {
        val a = RuntimeException("a")
        val b = RuntimeException("b", a)
        a.initCause(b)
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(a))
    }

    // ── 401 은 중앙 처리기가 이미 맡았다 ──────────────────────────────────

    @Test
    fun unauthorizedIsABreadcrumbNotAnIssue() {
        // 세션 정리 + "다시 로그인해 주세요" 로 이미 사용자에게 닿은 사실이다.
        assertTrue(AlarmTalkLog.isHandledAuthFailure(httpException(401, """{"error_code":"TOKEN_REVOKED"}""")))
        // 본문이 없어도 같다 — 상태코드만 본다.
        assertTrue(AlarmTalkLog.isHandledAuthFailure(httpException(401, "")))
    }

    @Test
    fun unauthorizedWrappedInDomainExceptionIsStillUnauthorized() {
        // 저장소·리포지토리가 한 번 감싸 던지는 모양.
        val wrapped = IllegalStateException("pull failed", httpException(401, ""))
        assertTrue(AlarmTalkLog.isHandledAuthFailure(wrapped))
    }

    @Test
    fun onlyUnauthorizedIsDemoted() {
        // 403·404·5xx 는 그대로 이슈다. 4xx 를 통째로 낮추면 진짜 결함이 묻힌다.
        assertFalse(AlarmTalkLog.isHandledAuthFailure(httpException(403, """{"error_code":"CONSENT_REQUIRED"}""")))
        assertFalse(AlarmTalkLog.isHandledAuthFailure(httpException(404, "")))
        assertFalse(AlarmTalkLog.isHandledAuthFailure(httpException(500, "")))
        assertFalse(AlarmTalkLog.isHandledAuthFailure(IllegalStateException("bug")))
    }

    @Test
    fun unauthorizedClassificationDoesNotConsumeTheErrorBody() {
        // ⚠ 계약: 상태코드만 본다. `apiError`/`apiErrorCode` 를 부르면 errorBody 가 소진돼
        // 호출부가 빈 본문을 받는다(그래서 여기서 가르고 나서도 코드를 읽을 수 있어야 한다).
        val error = httpException(401, """{"error_code":"TOKEN_REVOKED"}""")
        assertTrue(AlarmTalkLog.isHandledAuthFailure(error))
        assertEquals("""{"error_code":"TOKEN_REVOKED"}""", error.response()?.errorBody()?.string())
    }

    @Test
    fun unauthorizedCauseCycleDoesNotHang() {
        val a = RuntimeException("a")
        val b = RuntimeException("b", a)
        a.initCause(b)
        assertFalse(AlarmTalkLog.isHandledAuthFailure(a))
    }

    // ── 낮추는 **범위** 자체를 고정한다 ───────────────────────────────────

    /**
     * ⚠ **술어만 고정하면 범위가 넓어져도 전부 초록이다.** `isExpectedTransientFailure`·
     * `isHandledAuthFailure` 만 지키고 있으면, 누가 [AlarmTalkLog.breadcrumbCategoryFor] 를
     * "4xx 면 전부 auth" 로 넓혀도 이 파일의 다른 테스트는 하나도 안 깨진다 — 그런데 그
     * 순간 403·404·5xx 가 이슈 목록에서 **조용히 사라진다.** 그게 바로 이 판정이 막으려던
     * 사고이므로, 술어가 아니라 **결과물인 category** 를 고정한다.
     *
     * iOS 짝은 `TransientFailureClassificationTests` 의 `test_401_외의_상태코드는_그대로_이슈다`
     * (`AlarmTalkLog.handledFailureCategory`) — 같은 축이다.
     */
    @Test
    fun onlyUnauthorizedAndTransientBecomeBreadcrumbs() {
        // 낮추는 둘. 갈래 이름까지 본다 — 하나로 뭉치면 다음 진짜 이벤트를 읽을 때
        // "네트워크가 나빴다" 와 "세션이 끊겼다" 를 구분할 수 없다.
        assertEquals("auth", AlarmTalkLog.breadcrumbCategoryFor(httpException(401, "")))
        assertEquals("transient", AlarmTalkLog.breadcrumbCategoryFor(SocketTimeoutException("timeout")))
        assertEquals(
            "transient",
            AlarmTalkLog.breadcrumbCategoryFor(CancellationException("Job was cancelled")),
        )
        // 나머지는 그대로 이슈다 — 권한 박탈·파기된 계정·상태 충돌·서버 사고는 전부
        // 우리가 고칠 것이 있는 갈래다.
        assertNull(
            AlarmTalkLog.breadcrumbCategoryFor(httpException(403, """{"error_code":"CONSENT_REQUIRED"}""")),
        )
        assertNull(
            AlarmTalkLog.breadcrumbCategoryFor(httpException(404, """{"error_code":"AUTH_USER_NOT_FOUND"}""")),
        )
        assertNull(
            AlarmTalkLog.breadcrumbCategoryFor(
                httpException(409, """{"error_code":"TRANSACTION_OWNED_BY_OTHER_USER"}"""),
            ),
        )
        assertNull(AlarmTalkLog.breadcrumbCategoryFor(httpException(500, "")))
        assertNull(AlarmTalkLog.breadcrumbCategoryFor(IllegalStateException("bug")))
    }

    @Test
    fun breadcrumbClassificationDoesNotConsumeTheErrorBody() {
        // 같은 계약이 여기에도 걸린다 — 이 함수는 `reportError` 가 **모든** 실패에 대해
        // 부르므로, 본문을 읽으면 그 뒤 코드를 보려던 호출부가 전부 빈 본문을 받는다.
        val error = httpException(403, """{"error_code":"CONSENT_REQUIRED"}""")
        assertNull(AlarmTalkLog.breadcrumbCategoryFor(error))
        assertEquals("""{"error_code":"CONSENT_REQUIRED"}""", error.response()?.errorBody()?.string())
    }

    // ── 백그라운드 워커의 실패 마무리 ─────────────────────────────────────

    @Test
    fun workerRethrowsCancellation() {
        assertEquals(
            SyncWorkerOutcome.RETHROW,
            syncWorkerOutcome(CancellationException("Job was cancelled")),
        )
    }

    @Test
    fun workerStopsInsteadOfRetryingOnUnauthorized() {
        // ⚠ ANDROID-M. 401 에 `Result.retry()` 를 돌려주면 폐기된 토큰으로 영원히 재시도하고,
        // 그 회차마다 이슈가 한 건씩 쌓인다. 세 워커가 같은 함수를 쓴다.
        assertEquals(
            SyncWorkerOutcome.SESSION_EXPIRED,
            syncWorkerOutcome(httpException(401, """{"error_code":"TOKEN_REVOKED"}""")),
        )
        // 본문이 없어도, 도메인 예외로 감싸도 같다.
        assertEquals(SyncWorkerOutcome.SESSION_EXPIRED, syncWorkerOutcome(httpException(401, "")))
        assertEquals(
            SyncWorkerOutcome.SESSION_EXPIRED,
            syncWorkerOutcome(IllegalStateException("upload failed", httpException(401, ""))),
        )
    }

    @Test
    fun workerTreatsConsentRequiredAsPendingNotFailure() {
        // 로그인 직후 동의 전 GET /alarm — 한 사용자가 17분에 12건을 남기던 경로.
        assertEquals(
            SyncWorkerOutcome.CONSENT_PENDING,
            syncWorkerOutcome(httpException(403, """{"error_code":"CONSENT_REQUIRED"}""")),
        )
    }

    @Test
    fun workerStillRetriesAndReportsOther403s() {
        // 같은 403 이라도 실제 인증·동의 파손은 모니터링에 남아야 한다.
        assertEquals(
            SyncWorkerOutcome.RETRY,
            syncWorkerOutcome(httpException(403, """{"error_code":"ACCOUNT_PENDING_DELETION"}""")),
        )
        assertEquals(
            SyncWorkerOutcome.RETRY,
            syncWorkerOutcome(httpException(403, """{"error_code":"CONSENT_STATE_UNAVAILABLE"}""")),
        )
        // 본문 없는 403 도 마찬가지 — 코드를 모르면 낮추지 않는다.
        assertEquals(SyncWorkerOutcome.RETRY, syncWorkerOutcome(httpException(403, "")))
    }

    @Test
    fun workerRetriesNetworkFailures() {
        // 재시도는 하되 이슈로는 안 올라간다 — 그건 AlarmTalkLog 가 가른다.
        assertEquals(
            SyncWorkerOutcome.RETRY,
            syncWorkerOutcome(UnknownHostException("api.alarm-talk.com")),
        )
    }

    // ── 401 로 세션을 끊을 때의 두 번째 문(토큰) ───────────────────────────

    @Test
    fun workerEndsOnlyTheSessionThatGotThe401() {
        // 내가 보낸 그 토큰이 아직 저장소에 있을 때만 끊는다.
        assertTrue(workerMayEndSession(usedToken = "token-A", storedToken = "token-A"))
    }

    @Test
    fun workerKeepsASessionWhoseTokenRolled() {
        // ⚠ 세대는 그대로인데 토큰만 굴러간 경우(GET /auth/me 의 rolling refresh). 여기서
        // 끊으면 **방금 갱신한 멀쩡한 세션**을 옛 토큰의 뒤늦은 401 이 지운다.
        assertFalse(workerMayEndSession(usedToken = "token-A", storedToken = "token-B"))
    }

    @Test
    fun workerDoesNotTouchAnAlreadyEmptyStore() {
        // 이미 비었으면 끊을 세션이 없다 — 거기에 쓰는 것은 정리가 아니라 부활이다.
        assertFalse(workerMayEndSession(usedToken = "token-A", storedToken = null))
        assertFalse(workerMayEndSession(usedToken = "token-A", storedToken = ""))
    }

    private fun httpException(code: Int, body: String): HttpException =
        HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))
}
