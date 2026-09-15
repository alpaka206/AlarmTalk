package com.alarmtalk.app.core

import android.util.Log
import io.sentry.Breadcrumb
import io.sentry.Sentry
import io.sentry.SentryLevel
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.io.InterruptedIOException
import javax.net.ssl.SSLException
import kotlin.coroutines.cancellation.CancellationException

object AlarmTalkLog {
    const val TAG = "AlarmTalk"

    // 사용자 미디어 URI(content://, file://)는 파일명·로컬 식별자가 담겨 PII 소지가 있다.
    // Sentry 로 나가는 모든 문자열은 이 마스킹을 거친다(Logcat 은 로컬 전용이라 원문 유지).
    // AlarmTalkApplication 의 beforeSend 훅도 같은 규칙으로 이벤트를 한 번 더 거른다(안전망).
    private val USER_URI_REGEX = Regex("""(content|file)://\S+""")

    fun redactUserUris(text: String): String =
        USER_URI_REGEX.replace(text) { match -> "${match.groupValues[1]}://[redacted]" }

    /**
     * FCM 이 "다시 시도하라" 고 문서화한 오류 문자열. `FirebaseMessaging.getToken` 은 이걸
     * `IOException(ExecutionException(IOException("INTERNAL_SERVER_ERROR")))` 꼴로 감싸 준다 —
     * 구글 쪽 일시 장애라 우리가 고칠 코드가 없다. `TOO_MANY_REGISTRATIONS` 같은 영구 오류는
     * 일부러 뺀다.
     */
    private val FCM_RETRYABLE_MESSAGES = setOf("SERVICE_NOT_AVAILABLE", "INTERNAL_SERVER_ERROR")

    /**
     * Sentry 에 **이슈로 올리지 않는** 실패인가. Logcat 과 브레드크럼에만 남긴다.
     *
     * 기준은 백엔드와 같다 — `docs/spec/error-codes.md` §3 「기록은 전부, 경보는 골라서」.
     * 사용자가 고칠 수 없고 우리도 고칠 코드가 없는 실패를 이슈로 올리면, 진짜 결함이 그
     * 사이에 묻힌다. 2026-09-14 1.2.6 출시 직후 미해결 11건 중 8건이 아래 셋이었고 실제
     * 크래시(빌링) 한 건이 그 아래 깔려 있었다.
     *
     * 1. **코루틴 취소.** 오류가 아니라 흐름 제어다 — 워커가 `ExistingWorkPolicy.REPLACE` 로
     *    대체되거나 화면이 사라질 때마다 난다. `runCatching` 이 이것까지 잡아 올리고 있었다
     *    (`JobCancellationException`, 실사용자 10명).
     * 2. **일시적 네트워크 실패.** DNS 실패·연결 시간초과·연결 거부·TLS 핸드셰이크(캡티브
     *    포털). 기기 네트워크 사정이지 앱 결함이 아니다. 워커는 재시도하고 화면은 문구로
     *    안내한다. 원인 사슬 어디에 있든 본다 — 도메인 예외로 한 번 감싼 것도 같은 실패다.
     *    ⚠ `IOException` 전체가 아니다. `FileNotFoundException`·디스크 가득참은 결함일 수
     *    있어 그대로 올린다.
     * 3. **FCM 재시도 가능 코드.** [FCM_RETRYABLE_MESSAGES].
     *
     * ⚠ HTTP 4xx 는 여기서 가르지 않는다. `errorBody` 는 한 번만 읽히므로 호출부가 코드를
     * 볼 자리에서 결정한다(예: `RemoteAlarmSyncWorker` 의 `CONSENT_REQUIRED`).
     */
    fun isExpectedTransientFailure(error: Throwable): Boolean {
        if (error is CancellationException) return true
        var current: Throwable? = error
        val seen = HashSet<Throwable>()
        while (current != null && seen.add(current)) {
            if (current.isTransientNetworkFailure()) return true
            if (current.message?.trim() in FCM_RETRYABLE_MESSAGES) return true
            current = current.cause
        }
        return false
    }

    private fun Throwable.isTransientNetworkFailure(): Boolean = when (this) {
        is UnknownHostException,
        is SocketTimeoutException,
        is ConnectException,
        is NoRouteToHostException,
        is SocketException,
        is SSLException,
        -> true
        // OkHttp 의 호출 시간초과는 `InterruptedIOException("timeout")` 으로 온다
        // (`SocketTimeoutException` 의 부모 — 소켓이 아니라 호출 전체의 시간초과).
        is InterruptedIOException -> message == "timeout"
        else -> false
    }

    // 잡아서 처리한(비크래시) 오류의 개발자 채널: Logcat + Sentry.
    // 사용자에게는 userFacingError() 등으로 다듬은 문구만 보여주고,
    // 원인 파악에 필요한 상세(스택·컨텍스트)는 이 함수로만 흘려보낸다.
    // Sentry가 초기화되지 않은 경우(DSN 미설정) capture* 는 no-op 이라 안전하다.
    fun reportError(message: String, error: Throwable? = null) {
        if (error != null && isExpectedTransientFailure(error)) {
            // 이슈가 아니라 브레드크럼이다 — 다음 진짜 이벤트에 맥락으로 붙고, 그 자체로는
            // 아무것도 만들지 않는다. Logcat 도 e 가 아니라 w 로 낮춘다.
            Log.w(TAG, message, error)
            runCatching {
                val crumb = Breadcrumb().apply {
                    category = "transient"
                    level = SentryLevel.WARNING
                    this.message = redactUserUris(message)
                    setData("exception", error.javaClass.name)
                    error.message?.let { setData("detail", redactUserUris(it)) }
                }
                Sentry.addBreadcrumb(crumb)
            }
            return
        }
        if (error != null) {
            Log.e(TAG, message, error)
        } else {
            Log.e(TAG, message)
        }
        runCatching {
            // log_message 컨텍스트·메시지 이벤트는 beforeSend 가 건드리지 않으므로
            // 여기서 먼저 마스킹해 URI 가 어떤 경로로도 Sentry 에 실리지 않게 한다.
            val safeMessage = redactUserUris(message)
            if (error != null) {
                Sentry.captureException(error) { scope ->
                    scope.setTag("handled", "true")
                    scope.setContexts("log_message", safeMessage)
                }
            } else {
                Sentry.captureMessage(safeMessage, SentryLevel.ERROR)
            }
        }
    }
}
