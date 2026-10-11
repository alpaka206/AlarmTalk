package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.io.IOException
import java.net.UnknownHostException
import java.util.Locale
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response

/**
 * 인증 코드를 확인하는 세 자리(인증 확인·가입·비밀번호 재설정 확정)가 서버의 **거절 이유**를 말하는지,
 * 그리고 거절된 숫자를 칸에 남기지 않는지 본다 — 스펙 session-and-auth 「이메일 인증 코드」·
 * `docs/spec/error-codes.md` §4.
 *
 * 2026-10-09 prod(1.2.10): 신규 가입자 한 명이 거절된 같은 여섯 자리를 3초 사이에 다섯 번 보내 시도
 * 상한을 태웠고, 그 뒤의 **429 에도 "인증 코드가 맞지 않아요"** 를 들었다. 인증 확인의 실패는 400 이든
 * 429 든 네트워크 실패든 그 한 문장이었다 — 공용 표에는 세 코드의 문장이 이미 있었는데 부르는 자리가
 * 없었다. 화면은 코드를 다시 받아도 옛 숫자를 칸에 남겼고(꽉 찬 칸에 치는 새 숫자는 버려진다), 그
 * 사람은 이메일 가입을 끝내지 못했다.
 *
 * `MainViewModel` 은 암호화 저장소·Room 을 물고 있어 단위 테스트에서 세울 수 없다
 * (`StockClipManifestWiringTest` 와 같은 사정) — 문구와 판정은 순수 함수로 돌리고, 뷰모델·화면의
 * 배선은 소스로 본다. ⚠ 코드 칸이 실제로 비는지는 실기기로만 보인다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EmailCodeFailureMessageTest {
    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return base.createConfigurationContext(configuration)
    }

    private fun http(status: Int, code: String): HttpException =
        HttpException(Response.error<Any>(status, """{"error_code":"$code"}""".toResponseBody("application/json".toMediaType())))

    // ── 문장은 코드로 고른다 ──────────────────────────────────────────────

    @Test
    fun `세 거절은 세 언어에서 서로 다른 문장으로 말한다`() {
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            val fallback = context.getString(R.string.api_error_server)
            val invalid = emailCodeFailureMessage(context, http(400, "AUTH_EMAIL_CODE_INVALID"), fallback)
            val expired = emailCodeFailureMessage(context, http(400, "AUTH_EMAIL_CODE_EXPIRED"), fallback)
            val attempts = emailCodeFailureMessage(context, http(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"), fallback)

            assertEquals(language, context.getString(R.string.api_error_email_code_invalid), invalid)
            assertEquals(language, context.getString(R.string.api_error_email_code_expired), expired)
            assertEquals(language, context.getString(R.string.api_error_email_code_attempts), attempts)
            assertEquals("$language: 세 문장이 서로 달라야 한다", 3, setOf(invalid, expired, attempts).size)
            // ⚠ 2026-10-09 의 그 문장 — 상한(429)과 만료에 '맞지 않아요' 를 말하지 않는다.
            val mismatch = context.getString(R.string.msg_verification_code_mismatch)
            for (message in listOf(expired, attempts)) {
                assertNotEquals(language, mismatch, message)
                assertNotEquals(language, invalid, message)
                assertEquals(language, MessageSeverity.Error, snackbarSeverity(context, message))
            }
        }
    }

    @Test
    fun `코드가 거절된 것이 아니면 맞지 않는다고 말하지 않는다`() {
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            val fallback = context.getString(R.string.api_error_server)
            val invalid = context.getString(R.string.api_error_email_code_invalid)
            val mismatch = context.getString(R.string.msg_verification_code_mismatch)

            // 표에 있는 다른 코드는 표의 문장이다.
            assertEquals(
                language,
                context.getString(R.string.api_error_rate_limited),
                emailCodeFailureMessage(context, http(429, "RATE_LIMITED"), fallback),
            )
            // 표에 없는 코드 · 코드 없는 응답 · 네트워크 실패는 그 화면의 중립 폴백이다.
            val neutral = listOf(
                http(400, "AUTH_VALIDATION_FAILED"),
                // 서버가 코드를 판정하지 못한 500 — 이름에 CODE 가 들어 있어도 거절이 아니다.
                http(500, "AUTH_EMAIL_CODE_VERIFY_FAILED"),
                http(500, "SOMETHING_NEW"),
                HttpException(Response.error<Any>(504, "<html>gateway</html>".toResponseBody("text/html".toMediaType()))),
                UnknownHostException("api.alarm-talk.com"),
                IOException("boom"),
                IllegalStateException("bug"),
            )
            for (error in neutral) {
                val message = emailCodeFailureMessage(context, error, fallback)
                assertEquals("$language ${error.javaClass.simpleName}", fallback, message)
                assertNotEquals(language, invalid, message)
                assertNotEquals(language, mismatch, message)
            }
        }
    }

    @Test
    fun `가입과 재설정은 표의 문장을 먼저 쓰고 없으면 그 화면의 실패 문장이다`() {
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            for (fallbackRes in listOf(R.string.msg_register_failed, R.string.msg_password_reset_failed)) {
                val fallback = context.getString(fallbackRes)
                assertEquals(
                    language,
                    context.getString(R.string.api_error_email_code_expired),
                    emailCodeFailureMessage(context, http(400, "AUTH_EMAIL_CODE_EXPIRED"), fallback),
                )
                assertEquals(
                    language,
                    context.getString(R.string.api_error_email_code_attempts),
                    emailCodeFailureMessage(context, http(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"), fallback),
                )
                assertEquals(language, fallback, emailCodeFailureMessage(context, IOException("boom"), fallback))
            }
            // 화면이 만든 문장(`UserFacingException`)은 폴백보다 앞선다 — 일반 오류 헬퍼의 규칙 그대로.
            assertEquals(
                language,
                "화면이 만든 문장",
                emailCodeFailureMessage(context, UserFacingException("화면이 만든 문장"), context.getString(R.string.msg_register_failed)),
            )
        }
    }

    // ── 거절된 숫자를 칸에 남기지 않는다 — 판정표 ──────────────────────────

    @Test
    fun `코드 칸을 비우는 것은 코드가 거절된 셋뿐이다`() {
        for (code in listOf("AUTH_EMAIL_CODE_INVALID", "AUTH_EMAIL_CODE_EXPIRED", "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED")) {
            assertTrue(code, isEmailCodeRefusal(code))
        }
        // ⚠ 코드가 거절된 것이 아니면 숫자를 그대로 둔다 — 다시 누를 수 있어야 한다.
        for (code in listOf("RATE_LIMITED", "AUTH_VALIDATION_FAILED", "AUTH_EMAIL_TAKEN", "INTERNAL_ERROR", "", null)) {
            assertFalse("$code", isEmailCodeRefusal(code))
        }
    }

    @Test
    fun `서버가 인증 코드에 내는 거절 코드는 이 셋이다`() {
        // 판정 한 곳(`checkEmailVerificationCode`)이 돌려주는 코드(`code: '…'`)가 곧 '코드가 거절됐다' 다.
        // 서버가 하나 더 내기 시작하면 이 표도 함께 늘려야 한다 — 안 그러면 그 거절에서 숫자가 칸에 남는다.
        val source = File("../../../packages/backend/src/routes/auth.ts").readText()
        val refusals = Regex("""code: '(AUTH_EMAIL_CODE_\w+)'""").findAll(source).map { it.groupValues[1] }.toSet()
        assertEquals(
            setOf("AUTH_EMAIL_CODE_INVALID", "AUTH_EMAIL_CODE_EXPIRED", "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"),
            refusals,
        )
        for (code in refusals) assertTrue(code, isEmailCodeRefusal(code))
        // ⚠ 이름이 비슷한 5xx 둘은 거절이 아니다 — 서버가 코드를 **판정하지 못한** 실패라 숫자를 그대로
        // 두어 다시 누르게 한다. `AUTH_EMAIL_CODE_` 접두사로 뭉뚱그리면 이 둘에서 맞는 숫자를 지운다.
        for (code in listOf("AUTH_EMAIL_CODE_VERIFY_FAILED", "AUTH_EMAIL_CODE_SEND_FAILED")) {
            assertTrue("$code 가 서버에 없다 — 이 테스트의 전제를 다시 볼 것.", source.contains("'$code'"))
            assertFalse(code, isEmailCodeRefusal(code))
        }
    }

    // ── 배선 — 뷰모델과 두 화면 ──────────────────────────────────────────

    @Test
    fun `세 확인 자리가 표의 문장을 쓰고 거절이면 칸을 비운다`() {
        val confirm = functionBody(authActions, "internal fun MainViewModel.confirmEmailVerification(")
        assertTrue(
            "인증 확인이 공용 표를 부르지 않는다.",
            confirm.contains("emailCodeFailureMessage(app, error, app.getString(R.string.api_error_server))"),
        )
        assertFalse(
            "인증 확인의 폴백이 다시 '맞지 않아요' 다 — 상한(429)·네트워크 실패도 틀렸다고 말하게 된다.",
            confirm.contains("msg_verification_code_mismatch"),
        )
        assertTrue(confirm.contains("clearEmailCodeFieldIfRefused(error)"))

        val register = functionBody(authActions, "internal fun MainViewModel.register(")
        assertTrue(register.contains("emailCodeFailureMessage(app, error, app.getString(R.string.msg_register_failed))"))
        assertTrue(
            "가입이 코드를 거절해도 '인증 완료' 를 내리지 않는다 — 다시 받기가 꺼진 채 남는다.",
            register.contains("if (clearEmailCodeFieldIfRefused(error)) registerEmailVerified = null"),
        )
        // 이미 가입된 주소의 409 는 화면 층이 표보다 먼저 받는다(로그인 화면 전환).
        assertTrue(register.indexOf("duplicateEmailMessage(error)") in 0 until register.indexOf("emailCodeFailureMessage("))

        val reset = functionBody(authActions, "internal fun MainViewModel.confirmPasswordReset(")
        assertTrue(reset.contains("emailCodeFailureMessage(app, error, app.getString(R.string.msg_password_reset_failed))"))
        assertTrue(reset.contains("clearEmailCodeFieldIfRefused(error)"))

        val clear = functionBody(authActions, "private fun MainViewModel.clearEmailCodeFieldIfRefused(")
        assertTrue(clear.contains("isEmailCodeRefusal(apiErrorCode(error))"))
        assertTrue(clear.contains("emailCodeFieldClearTick++"))
    }

    @Test
    fun `다시 받기가 성공하면 칸을 비운다`() {
        for (signature in listOf(
            "internal fun MainViewModel.requestEmailVerification(",
            "internal fun MainViewModel.requestPasswordReset(",
        )) {
            val body = functionBody(authActions, signature)
            val success = body.substring(body.indexOf(".onSuccess"), body.indexOf(".onFailure"))
            assertTrue("$signature 의 성공 갈래가 코드 칸을 비우지 않는다.", success.contains("emailCodeFieldClearTick++"))
        }
    }

    @Test
    fun `코드를 다루는 다섯 요청은 도는 동안의 두 번째 탭을 버린다`() {
        for (signature in listOf(
            "internal fun MainViewModel.requestEmailVerification(",
            "internal fun MainViewModel.confirmEmailVerification(",
            "internal fun MainViewModel.register(",
            "internal fun MainViewModel.requestPasswordReset(",
            "internal fun MainViewModel.confirmPasswordReset(",
        )) {
            val body = functionBody(authActions, signature)
            val guard = body.indexOf("if (authBusy) return")
            assertTrue("$signature 에 진행 중 가드가 없다.", guard >= 0)
            assertTrue("$signature 의 가드가 요청을 띄운 뒤에 있다.", guard < body.indexOf("viewModelScope.launch"))
        }
    }

    @Test
    fun `두 화면의 코드 칸은 한 새니타이저를 거치고 신호에서 비운다`() {
        val screens = mapOf(
            "ui/auth/AuthScreen.kt" to "emailCode",
            "ui/auth/PasswordResetScreen.kt" to "code",
        )
        for ((path, state) in screens) {
            val source = withoutLineComments(readSource(path))
            assertTrue("$path 의 코드 칸이 새니타이저를 거치지 않는다.", source.contains("$state = sanitizeVerificationCode(it)"))
            assertFalse(
                "$path 가 다시 `isDigit` 필터를 쓴다 — ASCII 가 아닌 숫자를 그대로 통과시킨다.",
                source.contains("filter(Char::isDigit).take("),
            )
            assertTrue(
                "$path 가 신호에서 코드 칸을 비우지 않는다.",
                Regex("""LaunchedEffect\(codeFieldClearTick\)\s*\{\s*$state = ""\s*\}""").containsMatchIn(source),
            )
        }
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        assertEquals(
            "두 화면 모두 뷰모델의 신호를 받아야 한다.",
            2,
            Regex("""codeFieldClearTick = viewModel\.emailCodeFieldClearTick""").findAll(app).count(),
        )
        // 재설정 화면은 코드를 보낸 뒤에도 다시 받을 수 있다 — '다시 받아 주세요' 가 할 수 있는 일이어야 한다.
        val reset = withoutLineComments(readSource("ui/auth/PasswordResetScreen.kt"))
        assertTrue(reset.contains("val requestEnabled = !busy && canRequestEmailCode(email)\n"))
        assertTrue(reset.contains("stringResource(R.string.auth_email_verify_resend)"))
    }

    private val authActions: String by lazy { withoutLineComments(readSource("ui/main/MainViewModelAuthActions.kt")) }
}
