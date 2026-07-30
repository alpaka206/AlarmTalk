package com.alarmtalk.app.network

import org.json.JSONObject
import retrofit2.HttpException

/**
 * 백엔드 에러 응답에서 추출한 필드들.
 *
 * 백엔드는 4xx/5xx 에서 `{"error_code": "...", "message": "...", "provider"?: "..."}` 형식
 * JSON 본문을 반환한다. HttpException 의 errorBody 는 한 번만 읽을 수 있으므로 한 번 파싱해
 * 필요한 필드를 함께 돌려준다.
 */
data class ApiError(
    val code: String?,
    val provider: String?,
    // 스토어 직접 해지 안내(PLAY_CANCEL_FAILED 등)에서 내려오는 구독 관리 URL.
    val manageUrl: String? = null,
    // POLICY_VERSION_MISMATCH 에서 내려오는 **서버가 게시 중인** 정책 버전.
    val current: String? = null,
)

fun apiError(error: Throwable): ApiError {
    val body = (error as? HttpException)
        ?.response()
        ?.errorBody()
        ?.string()
        ?.takeIf { it.isNotBlank() }
        ?: return ApiError(null, null)
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
 * error_code 값만 필요할 때의 단축 헬퍼.
 *
 * 주의: errorBody 는 한 번만 읽히므로, 같은 throwable 에 [apiError] 와 [apiErrorCode] 를
 * 함께 호출하지 말 것(둘 중 하나만 사용).
 *
 * @return error_code 값. HTTP 예외가 아니거나 본문이 비어있거나 JSON 파싱 실패 시 null.
 */
fun apiErrorCode(error: Throwable): String? = apiError(error).code
