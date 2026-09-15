package com.alarmtalk.app

import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.sync.RemoteAlarmSyncFailureOutcome
import com.alarmtalk.app.sync.remoteAlarmSyncFailureOutcome
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ExecutionException
import javax.net.ssl.SSLHandshakeException
import kotlin.coroutines.cancellation.CancellationException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    }

    @Test
    fun causeCycleDoesNotHang() {
        val a = RuntimeException("a")
        val b = RuntimeException("b", a)
        a.initCause(b)
        assertFalse(AlarmTalkLog.isExpectedTransientFailure(a))
    }

    // ── RemoteAlarmSyncWorker 의 실패 마무리 ───────────────────────────────

    @Test
    fun workerRethrowsCancellation() {
        assertEquals(
            RemoteAlarmSyncFailureOutcome.RETHROW,
            remoteAlarmSyncFailureOutcome(CancellationException("Job was cancelled")),
        )
    }

    @Test
    fun workerTreatsConsentRequiredAsPendingNotFailure() {
        // 로그인 직후 동의 전 GET /alarm — 한 사용자가 17분에 12건을 남기던 경로.
        assertEquals(
            RemoteAlarmSyncFailureOutcome.CONSENT_PENDING,
            remoteAlarmSyncFailureOutcome(httpException(403, """{"error_code":"CONSENT_REQUIRED"}""")),
        )
    }

    @Test
    fun workerStillRetriesAndReportsOther403s() {
        // 같은 403 이라도 실제 인증·동의 파손은 모니터링에 남아야 한다.
        assertEquals(
            RemoteAlarmSyncFailureOutcome.RETRY,
            remoteAlarmSyncFailureOutcome(httpException(403, """{"error_code":"ACCOUNT_PENDING_DELETION"}""")),
        )
        assertEquals(
            RemoteAlarmSyncFailureOutcome.RETRY,
            remoteAlarmSyncFailureOutcome(httpException(403, """{"error_code":"CONSENT_STATE_UNAVAILABLE"}""")),
        )
        // 본문 없는 403 도 마찬가지 — 코드를 모르면 낮추지 않는다.
        assertEquals(RemoteAlarmSyncFailureOutcome.RETRY, remoteAlarmSyncFailureOutcome(httpException(403, "")))
    }

    @Test
    fun workerRetriesNetworkFailures() {
        // 재시도는 하되 이슈로는 안 올라간다 — 그건 AlarmTalkLog 가 가른다.
        assertEquals(
            RemoteAlarmSyncFailureOutcome.RETRY,
            remoteAlarmSyncFailureOutcome(UnknownHostException("api.alarm-talk.com")),
        )
    }

    private fun httpException(code: Int, body: String): HttpException =
        HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))
}
