package com.alarmtalk.app.network

import org.json.JSONObject
import retrofit2.HttpException

/**
 * 백엔드 에러 응답에서 추출한 필드들.
 *
 * 백엔드는 4xx/5xx 에서 `{"error_code": "...", "message": "...", "provider"?: "..."}` 형식
 * JSON 본문을 반환한다.
 *
 * **읽어도 본문이 소진되지 않는다**(2026-10-11). 같은 예외를 몇 번을, 어떤 순서로 읽어도 같은
 * 답이다 — [apiError] 가 버퍼된 오류 본문을 **엿본다**(peek). 예전에는 `errorBody().string()` 으로
 * 읽어 먼저 읽은 쪽이 나중에 읽는 쪽의 몫을 빼앗았다: 결제 경로는 보고(`AlarmTalkLog.reportError`)
 * **전에**, 목소리 경로는 보고 **뒤에** 코드를 읽고 있어 줄 순서가 곧 동작이었고, 보고 함수는
 * 그 때문에 코드를 아예 읽지 못했다(`docs/spec/error-codes.md` §3 「앱의 묶음 키」).
 */
data class ApiError(
    val code: String?,
    val provider: String?,
    // 스토어 직접 해지 안내(PLAY_CANCEL_FAILED 등)에서 내려오는 구독 관리 URL.
    val manageUrl: String? = null,
    // POLICY_VERSION_MISMATCH 에서 내려오는 **서버가 게시 중인** 정책 버전.
    val current: String? = null,
)

/**
 * 오류 본문에서 읽는 상한. 우리 워커의 오류 본문은 수백 바이트다 — 이보다 크면 워커 앞단
 * (게이트웨이·프록시)이 낸 HTML 이고, 거기에는 `error_code` 가 없다. 잘린 본문은 JSON 파싱에
 * 실패해 코드 없음으로 떨어진다.
 */
private const val MAX_ERROR_BODY_BYTES = 64L * 1024

/**
 * 오류 본문을 **소진하지 않고** 읽는다. Retrofit 은 비-2xx 응답의 본문을 메모리 버퍼로 옮겨 두므로
 * (`OkHttpCall.parseResponse` 의 `Utils.buffer`), 엿보기는 네트워크를 다시 타지 않고 그 버퍼를
 * 건드리지도 않는다 — 뒤에 `errorBody().string()` 을 불러도 전문이 그대로 나온다.
 *
 * 읽지 못하면(본문 없음·이미 닫힘·예상 밖의 구현) null 이다. **던지지 않는다** — 이 함수는 보고
 * 경로(`AlarmTalkLog.reportError`)에서도 불린다.
 */
private fun peekErrorBody(error: HttpException): String? = runCatching {
    error.response()?.errorBody()?.let { body ->
        val peek = body.source().peek()
        // 상한까지만 끌어온다. 본문이 더 짧으면 false 가 돌아올 뿐이다.
        peek.request(MAX_ERROR_BODY_BYTES)
        val charset = body.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8
        peek.buffer.readString(minOf(peek.buffer.size, MAX_ERROR_BODY_BYTES), charset)
    }
}.getOrNull()?.takeIf { it.isNotBlank() }

private fun parseApiError(error: HttpException): ApiError {
    val body = peekErrorBody(error) ?: return ApiError(null, null)
    return runCatching {
        val json = JSONObject(body)
        ApiError(
            code = json.optString("error_code").takeIf { it.isNotBlank() },
            provider = json.optString("provider").takeIf { it.isNotBlank() },
            manageUrl = json.optString("manage_url").takeIf { it.isNotBlank() },
            current = json.optString("current").takeIf { it.isNotBlank() },
        )
    }.getOrElse { ApiError(null, null) }
}

/**
 * 이 예외가 들고 있는 에러 응답의 필드들. HTTP 예외가 아니거나 본문이 비었거나 JSON 이 아니면
 * 전부 null 이다.
 *
 * 감싼 예외는 풀지 않는다 — 부르는 자리가 Retrofit 호출 바로 그 자리라 `HttpException` 이 맨 위에
 * 온다. 원인 사슬까지 봐야 하는 자리(보고)는 [apiFailureOf] 를 쓴다.
 */
fun apiError(error: Throwable): ApiError =
    (error as? HttpException)?.let(::parseApiError) ?: ApiError(null, null)

/**
 * error_code 값만 필요할 때의 단축 헬퍼. [apiError] 와 함께, 또는 거듭 불러도 된다 — 본문을
 * 소진하지 않는다.
 *
 * @return error_code 값. HTTP 예외가 아니거나 본문이 비어있거나 JSON 파싱 실패 시 null.
 */
fun apiErrorCode(error: Throwable): String? = apiError(error).code

/**
 * 원인 사슬에서 찾은 HTTP 실패 — 상태코드와 (있으면) `error_code`.
 *
 * 코드가 null 인 것은 **코드 없는 응답**이다. 우리 워커는 모든 4xx/5xx 에 코드를 싣으므로
 * (`packages/backend/test/error-codes.test.ts`), 코드 없는 5xx 는 워커 앞단이 낸 것이고 코드 없는
 * 4xx 는 주소·라우팅이 어긋난 것이다.
 */
data class ApiFailure(val status: Int, val code: String?)

/**
 * 이 실패의 원인 사슬에 HTTP 응답이 있으면 그 상태코드와 `error_code`. 없으면 null.
 *
 * [apiError] 와 달리 **감싼 예외를 푼다** — 저장소·리포지토리가 도메인 예외로 한 번 감싼 실패도
 * 같은 실패다(`AlarmTalkLog.isHandledAuthFailure` 가 상태코드를 찾는 방식과 같다). 사슬이 순환해도
 * 멈추도록 본 것을 기억한다. 본문을 소진하지 않으므로 호출부가 코드를 읽기 **전에** 불러도, **뒤에**
 * 불러도 같은 답이다 — 보고 함수의 묶음 키가 호출부의 줄 순서에 따라 달라지지 않는다.
 */
fun apiFailureOf(error: Throwable): ApiFailure? {
    var current: Throwable? = error
    val seen = HashSet<Throwable>()
    while (current != null && seen.add(current)) {
        (current as? HttpException)?.let { http ->
            return ApiFailure(status = http.code(), code = parseApiError(http).code)
        }
        current = current.cause
    }
    return null
}
