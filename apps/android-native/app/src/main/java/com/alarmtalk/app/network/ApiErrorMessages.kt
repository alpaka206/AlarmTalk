package com.alarmtalk.app.network

import android.content.Context
import androidx.annotation.StringRes
import com.alarmtalk.app.R

/**
 * **에러 코드 → 사용자에게 보여 줄 문구.**
 *
 * 서버는 4xx/5xx 에서 `error_code` 를 함께 내려준다(목록은
 * `packages/shared/src/schemas/error-codes.ts`). 그 코드로 문구를 고르는 이유는 두 가지다:
 *
 * 1. **서버 문장은 우리 말이 아니다.** 상당수가 영어이고("Voice profile not found"),
 *    번역도 없다. 예전에는 [userFacingError] 가 "한글이 섞여 있으면 그대로 보여 준다" 는
 *    휴리스틱으로 걸러 냈는데, 그건 서버가 한국어를 쓰는 동안만 맞는 이야기다.
 * 2. **같은 실패에 늘 같은 말을 하려면** 문구가 화면이 아니라 코드에 붙어야 한다.
 *
 * ⚠ **화면별 문구가 우선이다.** 여기 표는 **마지막에서 두 번째** 층이다 — 화면이 자기
 * 맥락에 맞는 말을 갖고 있으면(목소리 등록 중의 `VOICE_FEATURE_REQUIRES_PAID_PLAN` 은
 * "유료 이용권에서 쓸 수 있어요") 그쪽이 이긴다. 이 표는 **아무도 안 맡은 코드**를 받는다.
 *
 * 층은 셋이다: 화면별 `when` → 이 표 → [userFacingError] 의 폴백 문장.
 *
 * ⚠ **모든 코드에 문구를 둘 필요는 없다.** `INVALID_JSON` 처럼 사용자가 할 수 있는 게
 * 없는 것은 비워 두고 폴백에 맡긴다 — 억지로 채우면 "요청 형식이 올바르지 않습니다" 같은
 * 알아들을 수 없는 말이 늘어난다.
 */
private val API_ERROR_MESSAGES: Map<String, Int> = mapOf(
    // ── 공통 ──────────────────────────────────────────────────────────────
    "RATE_LIMITED" to R.string.api_error_rate_limited,
    "REQUEST_BODY_TOO_LARGE" to R.string.api_error_request_too_large,
    "INTERNAL_ERROR" to R.string.api_error_server,
    "ALARM_SCHEMA_UPGRADING" to R.string.api_error_schema_upgrading,

    // ── 로그인·계정 ───────────────────────────────────────────────────────
    "AUTH_INVALID_CREDENTIALS" to R.string.auth_error_invalid_credentials,
    "AUTH_EMAIL_TAKEN" to R.string.msg_register_email_taken,
    "AUTH_EMAIL_SOCIAL" to R.string.msg_register_email_social_google,
    "AUTH_EMAIL_CODE_INVALID" to R.string.api_error_email_code_invalid,
    "AUTH_EMAIL_CODE_EXPIRED" to R.string.api_error_email_code_expired,
    "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED" to R.string.api_error_email_code_attempts,
    "ACCOUNT_PENDING_DELETION" to R.string.api_error_account_pending_deletion,
    // 세션이 끊긴 셋. 앱은 이미 자동 로그아웃으로 처리하지만, 그 사이 스낵바가 뜨면
    // "다시 로그인" 이라고 말해야 사용자가 무슨 일인지 안다.
    "TOKEN_REVOKED" to R.string.api_error_session_expired,
    "AUTH_TOKEN_EXPIRED" to R.string.api_error_session_expired,
    "AUTH_USER_NOT_FOUND" to R.string.api_error_session_expired,

    // ── 이용권 게이트 ─────────────────────────────────────────────────────
    "VOICE_FEATURE_REQUIRES_PAID_PLAN" to R.string.plan_gate_paid_message,
    "VOICE_LOCKED_FREE_PLAN" to R.string.msg_voice_locked_free_plan,
    "FREE_PLAN_PRESET_ONLY" to R.string.msg_voice_preset_only,
    "BASIC_VOICE_PRESET_ONLY" to R.string.msg_voice_preset_only,
    "MANUAL_TTS_QUOTA_EXCEEDED" to R.string.editor_error_manual_tts_quota,

    // ── 목소리 ────────────────────────────────────────────────────────────
    "VOICE_CLONE_AUDIO_TOO_SHORT" to R.string.msg_voice_clone_audio_too_short,
    "VOICE_CLONE_AUDIO_TOO_LONG" to R.string.msg_voice_clone_audio_too_long,
    "INVALID_DURATION" to R.string.msg_voice_invalid_duration,
    "INVALID_AUDIO_MIME_TYPE" to R.string.msg_voice_invalid_audio_format,
    "VOICE_SLOT_EXHAUSTED" to R.string.msg_voice_slot_exhausted,
    "VOICE_CAPACITY_EXHAUSTED" to R.string.msg_voice_slot_exhausted,
    "VOICE_LIMIT_REACHED" to R.string.api_error_voice_limit_reached,
    "VOICE_NOT_READY" to R.string.api_error_voice_not_ready,
    "VOICE_CLONING_FAILED" to R.string.api_error_voice_cloning_failed,
    "VOICE_MONTHLY_CHANGE_LIMIT_REACHED" to R.string.msg_voice_monthly_change_limit,
    "VOICE_PREVIEW_REQUIRED" to R.string.msg_voice_preview_required,
    "CONSENT_REQUIRED" to R.string.msg_voice_consent_required,

    // ── 알람·문구 ─────────────────────────────────────────────────────────
    "ALARM_NOT_FOUND" to R.string.api_error_alarm_not_found,
    "TTS_GENERATION_FAILED" to R.string.api_error_tts_generation_failed,
)

/** 이 코드에 정해 둔 문구가 있으면 돌려준다. 없으면 null — 부르는 쪽이 폴백을 쓴다. */
@StringRes
fun apiErrorMessageRes(code: String?): Int? = code?.let { API_ERROR_MESSAGES[it] }

/**
 * 코드에 정해 둔 문구. 없으면 null.
 *
 * ⚠ **폴백을 여기서 만들지 않는다.** 서버 문장을 그대로 쓸지 화면이 준 문장을 쓸지는
 * `ui/util/PlatformAndLabelUtils.kt` 의 `userFacingError` 가 정한다 — 규칙이 두 곳에
 * 생기면 한쪽만 고쳐진다. 그래서 호출부는 늘 이렇게 잇는다:
 *
 * ```
 * message = apiErrorMessage(app, code) ?: userFacingError(error, app.getString(R.string.…))
 * ```
 *
 * ⚠ **`code` 는 이미 뽑아 놓은 값을 넘길 것.** `HttpException` 의 errorBody 는 **한 번만**
 * 읽힌다 — 같은 예외에 [apiErrorCode] 를 두 번 부르면 두 번째가 빈손이 된다.
 */
fun apiErrorMessage(context: Context, code: String?): String? =
    apiErrorMessageRes(code)?.let(context::getString)
