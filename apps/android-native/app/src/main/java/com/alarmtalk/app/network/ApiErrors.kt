package com.alarmtalk.app.network

import org.json.JSONObject
import retrofit2.HttpException

/**
 * 백엔드 에러 응답의 `error_code` 필드를 추출하는 공용 헬퍼.
 *
 * 백엔드는 4xx/5xx 에서 `{"error_code": "...", "message": "..."}` 형식 JSON 본문을 반환한다.
 * 여러 호출 지점에서 동일한 로직을 중복으로 갖고 있던 것을 한곳에 모은다.
 *
 * @return error_code 값. HTTP 예외가 아니거나 본문이 비어있거나 JSON 파싱 실패 시 null.
 */
fun apiErrorCode(error: Throwable): String? {
    val body = (error as? HttpException)
        ?.response()
        ?.errorBody()
        ?.string()
        ?.takeIf { it.isNotBlank() }
        ?: return null
    return runCatching {
        JSONObject(body).optString("error_code").takeIf { it.isNotBlank() }
    }.getOrNull()
}
