package com.alarmtalk.app.network

import com.alarmtalk.app.BuildConfig
import java.util.concurrent.TimeUnit
import okhttp3.Authenticator
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object AlarmTalkApiClient {
    /**
     * 인증이 만료(401)되었을 때 호출되는 콜백.
     *
     * [failedToken] 은 그 401 을 받은 요청이 **실제로 보낸** 토큰이다. 호출부는 지금 세션의
     * 토큰과 다르면 무시해야 한다 — `GET /auth/me` 가 세션을 굴린 직후(rolling refresh),
     * 옛 토큰으로 이미 날아간 요청이 뒤늦게 401 로 돌아와 **방금 갱신한 세션을 지워 버리는**
     * 경합이 생긴다(Codex #665 P2).
     */
    interface UnauthorizedHandler {
        fun onUnauthorized(failedToken: String?)

        /**
         * 데이터 라우트가 403 `CONSENT_REQUIRED` 를 반환했을 때 호출된다(서버 강제 동의 미들웨어).
         * 동의 플로우로 유도하기 위해 호출하며, 기본 구현은 동작 없음(기존 호출부 호환).
         *
         * @param consent 서버가 지목한 미충족 동의 유형(응답의 `consent` 필드). 가입 뒤
         *   voice_biometric 동의를 철회한 사용자는 목소리 기능 시트에서 다시 받아야 하므로,
         *   이 값 없이 가입 게이트만 열면 사용자가 통과할 방법이 없어 무한 루프가 된다.
         */
        fun onConsentRequired(consent: String?) {}
    }

    fun create(
        baseUrl: String = BuildConfig.VOICE_ALARM_API_BASE_URL,
        unauthorizedHandler: UnauthorizedHandler? = null,
        appVersionCode: Int = 0,
    ): AlarmTalkApi {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
        // 모든 요청에 앱 버전/플랫폼을 실어 보내 백엔드가 버전별로 응답을 분기하거나
        // 로그·통계에 활용할 수 있게 한다. (구버전 앱 식별 → 강제/권장 업데이트 판단의 토대)
        val versionHeader = okhttp3.Interceptor { chain ->
            val request = chain.request().newBuilder()
                .header("X-App-Platform", "android")
                .header("X-App-Version", appVersionCode.toString())
                .build()
            chain.proceed(request)
        }
        // 403 CONSENT_REQUIRED 를 감지해 동의 플로우로 유도한다. 401(TOKEN_REVOKED 포함)은
        // okhttp Authenticator 가 처리하므로 여기서는 403 본문의 error_code 만 검사한다.
        val consentInterceptor = okhttp3.Interceptor { chain ->
            val response = chain.proceed(chain.request())
            if (unauthorizedHandler != null && response.code == 403) {
                // peekBody 로 본문을 소비하지 않고 복제해 검사한다(이후 호출부가 본문을 정상 수신).
                val parsed = runCatching {
                    val body = response.peekBody(MAX_ERROR_BODY_BYTES).string()
                    body.takeIf { it.isNotBlank() }?.let { org.json.JSONObject(it) }
                }.getOrNull()
                val errorCode = parsed?.optString("error_code")?.takeIf { it.isNotBlank() }
                if (errorCode == "CONSENT_REQUIRED") {
                    val consent = parsed?.optString("consent")?.takeIf { it.isNotBlank() }
                    runCatching { unauthorizedHandler.onConsentRequired(consent) }
                }
            }
            response
        }
        val builder = OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(versionHeader)
            .addInterceptor(consentInterceptor)
            .addInterceptor(logging)
        if (unauthorizedHandler != null) {
            builder.authenticator(UnauthorizedAuthenticator(unauthorizedHandler))
        }
        val client = builder.build()

        return Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(AlarmTalkApi::class.java)
    }

    fun bearer(token: String): String = "Bearer $token"

    // 403 본문에서 error_code 만 확인하면 되므로 본문 전체를 메모리에 올리지 않도록 상한을 둔다.
    private const val MAX_ERROR_BODY_BYTES = 64L * 1024L

    private fun normalizeBaseUrl(baseUrl: String): String {
        val normalized = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        val parsed = normalized.toHttpUrl()
        require(parsed.isHttps) { "VOICE_ALARM_API_BASE_URL must use https." }
        return normalized
    }

    /**
     * 401 응답을 받으면 한 번만 콜백을 호출하고 재시도 없이 응답을 그대로 흘려보낸다.
     * - 백엔드에 refresh 엔드포인트가 없으므로 같은 토큰으로 재시도해도 의미가 없다.
     * - 재시도 시 같은 응답이 반복되며 무한루프가 될 수 있어 null 을 반환해 전파.
     * - 동일 응답에 대해 콜백이 이미 호출되었는지(Authorization 헤더 동일성)를 확인해 중복 호출을 방지.
     */
    private class UnauthorizedAuthenticator(
        private val handler: UnauthorizedHandler,
    ) : Authenticator {
        override fun authenticate(route: Route?, response: Response): Request? {
            // okhttp 가 같은 요청을 두 번 이상 호출하지 않도록 priorResponse 체인 확인.
            if (responseRetryCount(response) >= 1) {
                return null
            }
            // 401 을 받은 요청이 실제로 보낸 토큰을 함께 넘긴다 — 호출부가 '지금 세션의
            // 토큰인가' 를 보고 옛 토큰의 뒤늦은 401 을 무시할 수 있게.
            val failedToken = response.request.header("Authorization")
                ?.removePrefix("Bearer ")
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
            runCatching { handler.onUnauthorized(failedToken) }
            // 새 토큰을 발급할 방법이 없으므로 retry 하지 않는다.
            return null
        }

        private fun responseRetryCount(response: Response): Int {
            var current: Response? = response.priorResponse
            var count = 0
            while (current != null) {
                count += 1
                current = current.priorResponse
            }
            return count
        }
    }
}
