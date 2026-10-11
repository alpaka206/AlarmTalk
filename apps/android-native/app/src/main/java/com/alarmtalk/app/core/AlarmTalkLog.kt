package com.alarmtalk.app.core

import android.util.Log
import com.alarmtalk.app.network.ApiFailure
import com.alarmtalk.app.network.ReportedApiFailure
import com.alarmtalk.app.network.apiFailureOf
import com.google.android.gms.common.api.ApiException
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
import okhttp3.internal.http2.ConnectionShutdownException
import okhttp3.internal.http2.StreamResetException
import retrofit2.HttpException

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
     * Google 로그인이 **사용자 행동**으로 끝난 상태코드 — 결함이 아니다(2026-09-22, ANDROID-P).
     * 12501 `SIGN_IN_CANCELLED`(뒤로가기·시트 닫기), 12502 `SIGN_IN_CURRENTLY_IN_PROGRESS`(버튼 연타).
     * 화면은 어차피 상태별 문구를 보여준다(`googleSignInErrorMessage`).
     */
    private val GOOGLE_SIGN_IN_USER_ACTION_CODES = setOf(12501, 12502)

    /** Google 로그인의 `NETWORK_ERROR`(7) — 기기 네트워크 사정이라 일시적 실패와 같다. */
    private const val GOOGLE_SIGN_IN_NETWORK_ERROR = 7

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
     * 4. **HTTP/2 스트림·연결 리셋**(`StreamResetException`·`ConnectionShutdownException`).
     *    엣지나 프록시가 스트림을 끊은 것이라 2 와 같은 부류인데 `IOException` 의 다른 하위
     *    타입이라 빠져 있었다(2026-09-22, ANDROID-N — 워커는 재시도하는데 이슈만 쌓였다).
     * 5. **Google 로그인의 네트워크 오류**(`ApiException` 7).
     *
     * ⚠ HTTP 4xx 를 여기서 낮추지 않는다. 그 4xx 가 무엇을 뜻하는지는 문맥을 아는 호출부가 코드를
     * 볼 자리에서 결정한다(예: `sync/SyncWorkerFailure.kt` 의 `CONSENT_REQUIRED`).
     * 낮추는 유일한 예외가 **401** 인데, 그건 본문이 아니라 상태코드만 보면 되므로
     * [isHandledAuthFailure] 로 따로 갈라 두었다. ([reportError] 는 이제 코드를 **읽는다** — 낮추려는
     * 것이 아니라 묶으려는 것이다, [apiFailureFingerprint].)
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
        // HTTP/2 의 RST_STREAM·GOAWAY. 서버·엣지가 스트림을 끊은 것이지 요청이 잘못된 게 아니다.
        is StreamResetException,
        is ConnectionShutdownException,
        -> true
        // OkHttp 의 호출 시간초과는 `InterruptedIOException("timeout")` 으로 온다
        // (`SocketTimeoutException` 의 부모 — 소켓이 아니라 호출 전체의 시간초과).
        is InterruptedIOException -> message == "timeout"
        is ApiException -> statusCode == GOOGLE_SIGN_IN_NETWORK_ERROR
        else -> false
    }

    /**
     * Google 로그인이 사용자 행동(취소·연타)으로 끝났는가. 이슈가 아니라 브레드크럼이다 —
     * 상태코드 10(`DEVELOPER_ERROR`, SHA 지문·클라이언트 ID 설정)·12500(`SIGN_IN_FAILED`)은
     * 우리가 고칠 것이 있으니 그대로 올라간다.
     */
    internal fun isGoogleSignInUserAction(error: Throwable): Boolean {
        var current: Throwable? = error
        val seen = HashSet<Throwable>()
        while (current != null && seen.add(current)) {
            if (current is ApiException && current.statusCode in GOOGLE_SIGN_IN_USER_ACTION_CODES) return true
            current = current.cause
        }
        return false
    }

    /**
     * **중앙 401 처리기가 이미 맡은 실패인가.** 이슈가 아니라 브레드크럼이다.
     *
     * 이 앱에서 401 은 예외 없이 한 곳으로 수렴한다 — 전경은 okhttp `Authenticator`
     * (`AlarmTalkApiClient.UnauthorizedHandler` → `MainViewModel.handleUnauthorized`),
     * 백그라운드는 `sync/SyncWorkerFailure.kt` 의 `SESSION_EXPIRED` 갈래다. 둘 다 하는 일이
     * 같다: 세션을 끊고 재로그인을 안내한다. **사용자에게 이미 닿은 사실**이라 그 위에 이슈를
     * 또 쌓을 이유가 없고, 쌓으면 한 번의 만료가 **워커 재시도 횟수만큼** 올라간다
     * (ANDROID-M — 401 을 받고도 `Result.retry()` 로 영원히 돌던 워커가 그랬다).
     *
     * ⚠ **상태코드만 본다.** 401 은 코드를 볼 필요가 없다 — `TOKEN_REVOKED` 든 만료든 결말이
     * 하나(세션 정리)다. (2026-10-11 전에는 이유가 하나 더 있었다: 코드를 읽으면 오류 본문이
     * 소진돼 뒤에 읽는 호출부가 빈 본문을 받았다. 이제 읽어도 남지만 — `network/ApiErrors.kt` —
     * 그렇다고 여기서 본문을 열 이유가 생긴 것은 아니다.)
     *
     * ⚠ **401 만이다.** 403 은 동의·권한 상태라 호출부가 코드로 가르고(`CONSENT_REQUIRED`),
     * 그 밖의 4xx 는 그대로 올라간다. 인증 헤더를 빼먹는 우리 쪽 결함이 401 로 나타나도
     * 조용해지지 않는다 — 그 경로는 세션을 끊고 "다시 로그인해 주세요" 를 띄운다.
     *
     * iOS 짝은 `AlarmTalkLog.swift` 의 같은 이름 함수다 — **한쪽만 고치지 말 것.**
     */
    fun isHandledAuthFailure(error: Throwable): Boolean = httpStatusCode(error) == 401

    /**
     * 원인 사슬에서 처음 만나는 HTTP 상태코드. 도메인 예외로 한 번 감싼 실패도 같은 실패다
     * (저장소·리포지토리가 흔히 감싼다). 사슬이 순환해도 멈추도록 본 것을 기억한다.
     */
    private fun httpStatusCode(error: Throwable): Int? {
        var current: Throwable? = error
        val seen = HashSet<Throwable>()
        while (current != null && seen.add(current)) {
            (current as? HttpException)?.let { return it.code() }
            current = current.cause
        }
        return null
    }

    /**
     * 브레드크럼으로 낮출 실패인가. 낮춘다면 어떤 갈래인지(브레드크럼 category)를 돌려준다.
     *
     * 갈래를 남기는 이유: 브레드크럼은 **다음 진짜 이벤트의 맥락**인데, 그때 "네트워크가
     * 나빴다" 와 "세션이 끊겼다" 는 전혀 다른 이야기다. 하나로 뭉치면 맥락이 사라진다.
     *
     * ⚠ **`private` 이 아니라 `internal` 인 이유는 테스트다.** 여기가 낮추는 범위이고,
     * 술어([isExpectedTransientFailure]·[isHandledAuthFailure])만 고정해 두면 누가 이 함수를
     * "4xx 면 전부 auth" 로 넓혀도 **기존 테스트가 전부 초록**이다 — 403·404·5xx 가 이슈
     * 목록에서 조용히 사라지고, 그게 바로 이 판정이 막으려던 사고다. 경계는 결과물인
     * category 로 고정한다(`TransientFailureClassificationTest` 의
     * `onlyUnauthorizedAndTransientBecomeBreadcrumbs`, iOS 짝은
     * `AlarmTalkLog.handledFailureCategory` 와 `test_401_외의_상태코드는_그대로_이슈다`).
     */
    internal fun breadcrumbCategoryFor(error: Throwable): String? = when {
        isExpectedTransientFailure(error) -> "transient"
        isHandledAuthFailure(error) -> "auth"
        isGoogleSignInUserAction(error) -> "user"
        else -> null
    }

    // ── 묶음 키 — API 실패는 **코드와 호출 자리**로 묶는다 ─────────────────
    //
    // 규칙은 `docs/spec/error-codes.md` §3 「앱의 묶음 키」. iOS 짝은 `AlarmTalkLog.swift` 의
    // `logKey(of:)`·`apiFailureFingerprint(for:message:)` — **두 앱의 키는 같은 모양이어야 한다.**

    /** 로그 메시지의 값 토큰 — 공백 뒤 `이름=값`(`id=9264e503-…`, `shared=true`). */
    private val LOG_VALUE_TOKEN = Regex("""\s+[A-Za-z_][\w.]*=\S*""")

    /** Sentry 태그 값의 길이 상한(넘으면 서버가 그 태그를 버린다). */
    private const val SENTRY_TAG_VALUE_MAX = 200

    /**
     * 로그 메시지에서 값 토큰을 뺀 것 — **어디서 부른 실패인가**만 남긴다.
     *
     * `Failed to promote voice draft id=9264e503-…` → `Failed to promote voice draft`.
     * 메시지를 그대로 묶음 키에 넣으면 목소리 id·상대 id 마다 이슈가 하나씩 생긴다.
     */
    internal fun logKeyOf(message: String): String = LOG_VALUE_TOKEN.replace(message, "").trim()

    /**
     * 이 실패에 줄 Sentry 지문. 원인 사슬에 HTTP 응답이 없으면 null — 기본 묶음(스택)을 그대로 쓴다.
     *
     * | 응답 | 지문 |
     * | --- | --- |
     * | `error_code` 가 있다 | `[api_error, <error_code>, <logKey>]` |
     * | 코드 없는 4xx | `[api_error, HTTP_<status>, <logKey>]` |
     * | 코드 없는 5xx | `[api_error, HTTP_<status>]` |
     *
     * **왜 직접 주는가.** Retrofit 은 모든 비-2xx 를 같은 콜백 프레임에서 던진다 — 스택이 하나라
     * 엔드포인트가 달라도 한 이슈였고, R8 이 그 콜백의 이름을 바꿀 때마다 새 잡동사니 이슈가 열렸다
     * (ANDROID-B → K → Q). 1.2.10 의 Q 에는 이메일 인증 거절·목소리 월 한도 429·사전 출시 로봇의
     * 504 가 한데 섞여 있었다.
     *
     * **왜 코드 없는 5xx 는 호출 자리를 빼는가.** 우리 워커는 코드 없는 응답을 내지 않는다 — 그건
     * 워커 앞단(게이트웨이·프록시)이 낸 것이라 어느 화면이 불렀는지는 원인을 가르지 않는다. 사전
     * 출시 로봇의 504 는 로그 메시지가 일곱 가지였다 — 호출 자리를 넣으면 회차마다 이슈가 일곱 개다.
     * 코드 없는 4xx 는 남긴다(주소·라우팅이 틀린 자리를 가리킨다).
     *
     * ⚠ **이 함수는 아무것도 낮추지 않는다.** 브레드크럼으로 내려가는 범위는 [breadcrumbCategoryFor]
     * 그대로다. 여기서 정하는 것은 올라간 이벤트가 **어느 이슈에 붙는가**뿐이다.
     *
     * @param message [reportError] 에 넘긴 로그 메시지(값 토큰은 여기서 뺀다).
     */
    internal fun apiFailureFingerprint(error: Throwable, message: String): List<String>? =
        apiFailureOf(error)?.let { fingerprintOf(it, logKeyOf(message)) }

    private fun fingerprintOf(failure: ApiFailure, logKey: String): List<String> {
        val code = failure.code
        return when {
            code != null -> listOf(API_FAILURE_FINGERPRINT_ROOT, code, logKey)
            failure.status >= 500 -> listOf(API_FAILURE_FINGERPRINT_ROOT, "HTTP_${failure.status}")
            else -> listOf(API_FAILURE_FINGERPRINT_ROOT, "HTTP_${failure.status}", logKey)
        }
    }

    /** 지문의 첫 마디. 백엔드 경보의 지문(`middleware/errorCode.ts` 의 `['api_error', code]`)과 같은 말이다. */
    private const val API_FAILURE_FINGERPRINT_ROOT = "api_error"

    /**
     * 이슈로 올리는 이벤트에 붙일 태그 — **지문이 묶고, 태그가 찾는다.**
     * HTTP 가 아닌 오류는 `log.key` 하나만 얻는다.
     */
    internal fun reportTags(failure: ApiFailure?, logKey: String): Map<String, String> = buildMap {
        put("log.key", logKey.take(SENTRY_TAG_VALUE_MAX))
        if (failure != null) {
            put("api.status", failure.status.toString())
            failure.code?.let { put("api.error_code", it.take(SENTRY_TAG_VALUE_MAX)) }
        }
    }

    /** 이슈로 올릴 것 한 건 — 무엇을([throwable]), 어느 이슈에([fingerprint], null 이면 기본 묶음), 어떤 태그로. */
    internal class IssueReport(
        val throwable: Throwable,
        val fingerprint: List<String>?,
        val tags: Map<String, String>,
    )

    /**
     * [reportError] 가 이슈로 올릴 것을 만든다. 원인 사슬에 HTTP 응답이 있으면 지문·태그를 달고
     * 읽을 수 있는 포장([ReportedApiFailure] — 원래 예외는 `cause`)으로 감싼다. 없으면 예외를 그대로
     * 두고 `log.key` 태그만 붙인다.
     *
     * ⚠ **Sentry 를 부르지 않는 순수 함수로 떼어 둔 이유는 테스트다.** 유닛 테스트에서는 Sentry 가
     * 켜지지 않아(`AlarmTalkApplication.shouldInitializeSentry`) 캡처 경로를 볼 수 없다 — 무엇을
     * 올릴지는 여기서 고정하고(`ApiFailureReportingTest`), 실제로 이벤트에 실리는지는 dev 빌드
     * 이벤트 한 건으로 확인한다.
     *
     * @param message 이미 마스킹한 로그 메시지. 지문·태그는 `beforeSend` 를 거치지 않는다.
     */
    internal fun issueReportFor(message: String, error: Throwable): IssueReport {
        val logKey = logKeyOf(message)
        val failure = apiFailureOf(error)
        return IssueReport(
            throwable = failure?.let { ReportedApiFailure(it, logKey, error) } ?: error,
            fingerprint = failure?.let { fingerprintOf(it, logKey) },
            tags = reportTags(failure, logKey),
        )
    }

    // 잡아서 처리한(비크래시) 오류의 개발자 채널: Logcat + Sentry.
    // 사용자에게는 userFacingError() 등으로 다듬은 문구만 보여주고,
    // 원인 파악에 필요한 상세(스택·컨텍스트)는 이 함수로만 흘려보낸다.
    // Sentry가 초기화되지 않은 경우(DSN 미설정) capture* 는 no-op 이라 안전하다.
    fun reportError(message: String, error: Throwable? = null) {
        val breadcrumbCategory = if (error != null) breadcrumbCategoryFor(error) else null
        if (error != null && breadcrumbCategory != null) {
            // 이슈가 아니라 브레드크럼이다 — 다음 진짜 이벤트에 맥락으로 붙고, 그 자체로는
            // 아무것도 만들지 않는다. Logcat 도 e 가 아니라 w 로 낮춘다.
            Log.w(TAG, message, error)
            runCatching {
                val crumb = Breadcrumb().apply {
                    category = breadcrumbCategory
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
            // log_message 컨텍스트·메시지 이벤트·태그·지문은 beforeSend 가 건드리지 않으므로
            // 여기서 먼저 마스킹해 URI 가 어떤 경로로도 Sentry 에 실리지 않게 한다.
            val safeMessage = redactUserUris(message)
            if (error != null) {
                // 묶음 키와 태그([issueReportFor]). ⚠ 이 `runCatching` 안에서 만든다 — 보고가
                // 던져서 호출부의 실패 처리를 끊는 일이 없어야 한다.
                val report = issueReportFor(safeMessage, error)
                Sentry.captureException(report.throwable) { scope ->
                    scope.setTag("handled", "true")
                    scope.setContexts("log_message", safeMessage)
                    report.tags.forEach { (key, value) -> scope.setTag(key, value) }
                    report.fingerprint?.let { scope.fingerprint = it }
                }
            } else {
                Sentry.captureMessage(safeMessage, SentryLevel.ERROR) { scope ->
                    reportTags(failure = null, logKey = logKeyOf(safeMessage))
                        .forEach { (key, value) -> scope.setTag(key, value) }
                }
            }
        }
    }
}
