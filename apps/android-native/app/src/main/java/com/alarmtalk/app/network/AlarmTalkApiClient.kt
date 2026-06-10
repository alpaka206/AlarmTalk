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
     * 현재는 백엔드 refresh 엔드포인트가 없어 세션을 클리어하고 재로그인을 유도한다.
     */
    interface UnauthorizedHandler {
        fun onUnauthorized()
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
        val builder = OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(versionHeader)
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
            runCatching { handler.onUnauthorized() }
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
