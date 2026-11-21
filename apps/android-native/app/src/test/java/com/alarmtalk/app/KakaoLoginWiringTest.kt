package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.KakaoLoginRequest
import com.google.gson.Gson
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 카카오 로그인(2026-11-14) — 서버 계약(`POST /auth/kakao` 의 `access_token`), 버튼 글자(카카오 가이드), 이미 카카오로
 * 가입된 이메일의 안내, 로그아웃 때 기기의 카카오 토큰 정리. 규칙은 `docs/spec/session-and-auth.md` 「카카오 로그인」.
 *
 * `MainViewModel` 은 단위 테스트에서 세울 수 없어(`EmailCodeFailureMessageTest` 와 같은 사정) 배선은 소스로 본다.
 * ⚠ 카카오톡·카카오계정 로그인이 실제로 되는지는 실기기로만 보인다(키 해시가 콘솔에 등록돼 있어야 한다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class KakaoLoginWiringTest {
    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return base.createConfigurationContext(configuration)
    }

    @Test
    fun `서버에는 액세스 토큰을 access_token 으로 보낸다`() {
        assertEquals("""{"access_token":"tok"}""", Gson().toJson(KakaoLoginRequest(accessToken = "tok")))
    }

    @Test
    fun `버튼 글자는 카카오 가이드가 허용하는 그 글자다`() {
        // 가이드: '카카오 로그인'(축약 '로그인')만 쓴다 — '카카오로 계속하기' 같은 변형은 안 된다.
        assertEquals("카카오 로그인", context("ko").getString(R.string.auth_kakao_login))
        assertEquals("Login with Kakao", context("en").getString(R.string.auth_kakao_login))
        assertEquals("カカオログイン", context("ja").getString(R.string.auth_kakao_login))
    }

    @Test
    fun `카카오로 가입된 이메일은 카카오로 안내한다 — 모르는 값만 구글이다`() {
        val body = functionBody(
            withoutLineComments(readSource("ui/main/MainViewModelAuthActions.kt")),
            "private fun MainViewModel.duplicateEmailMessage(",
        )
        assertTrue(body.contains(""""kakao" -> app.getString(R.string.msg_register_email_social_kakao)"""))
        assertTrue(body.contains("""else -> app.getString(R.string.msg_register_email_social_google)"""))
        for (language in listOf("ko", "en", "ja")) {
            val text = context(language).getString(R.string.msg_register_email_social_kakao)
            assertTrue("$language 안내가 카카오 버튼 글자를 말하지 않는다: $text", text.contains(context(language).getString(R.string.auth_kakao_login)))
        }
    }

    @Test
    fun `카카오 세션은 로그아웃과 탈퇴 신청 때 기기의 카카오 토큰도 버린다`() {
        val actions = withoutLineComments(readSource("ui/main/MainViewModelAuthActions.kt"))
        val login = functionBody(actions, "internal fun MainViewModel.finishKakaoLogin(")
        assertTrue(login.contains("authSessionStore.saveKakaoSession(response)"))
        assertTrue(login.contains("""recordAuthSuccess(method = "kakao")"""))
        for (signature in listOf("internal fun MainViewModel.logout(", "internal fun MainViewModel.requestAccountDeletion(")) {
            // 두 함수 모두 기본값 람다(`= {}`)를 받아 `functionBody` 가 그 `{}` 를 본문으로 읽는다 — 다음 함수 앞까지 본다.
            val start = actions.indexOf(signature)
            assertTrue("`$signature` 를 못 찾았다.", start >= 0)
            val end = actions.indexOf("\ninternal fun ", start + signature.length).let { if (it < 0) actions.length else it }
            val body = actions.substring(start, end)
            assertTrue("$signature 가 카카오 세션을 가르지 않는다", body.contains("session?.provider == AuthSessionStore.PROVIDER_KAKAO") || body.contains("session.provider == AuthSessionStore.PROVIDER_KAKAO"))
            assertTrue("$signature 가 카카오 토큰을 버리지 않는다", body.contains("signOutKakao()"))
        }
    }

    @Test
    fun `간편 로그인은 시작하기 다음 고르기 화면에 있고 카카오가 먼저다`() {
        // 2026-11-22 오너 — 로그인 수단을 먼저 고르고, 이메일 칸은 '이메일로 계속하기' 다음 화면이다.
        val methods = withoutLineComments(readSource("ui/auth/AuthMethodsScreen.kt"))
        val kakao = methods.indexOf("KakaoLoginButton(")
        val google = methods.indexOf("GoogleSignInButton(")
        val email = methods.indexOf("EmailContinueButton(")
        assertTrue(kakao in 0 until google)
        assertTrue(google in 0 until email)
        // 랜딩의 '시작하기' 는 고르기 화면으로 가고, 이메일만 다음 화면(이메일 로그인)으로 간다.
        val app = readSource("ui/app/AlarmTalkApp.kt")
        assertTrue(app.contains("onStart = { authNavigate(AuthRoute.Methods) }"))
        assertTrue(app.contains("onContinueWithEmail = { authNavigate(AuthRoute.Auth(AuthMode.Login)) }"))
        // 이메일 로그인·가입 화면에는 간편 로그인 버튼을 또 두지 않는다.
        val screen = withoutLineComments(readSource("ui/auth/AuthScreen.kt"))
        assertFalse(screen.contains("KakaoLoginButton("))
        assertFalse(screen.contains("GoogleSignInButton("))
        // 이메일 로그인 칸은 칸 안 안내 글자뿐이다(위 이름표 없음) — 이메일·비밀번호 두 칸.
        assertEquals(2, Regex("""placeholderOnly = mode == AuthMode.Login""").findAll(screen).count())
    }
}
