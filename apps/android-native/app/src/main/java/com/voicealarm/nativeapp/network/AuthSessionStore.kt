package com.voicealarm.nativeapp.network

import android.content.Context
import java.util.Base64
import org.json.JSONObject

data class AuthSession(
    val token: String,
    val provider: String,
    val user: AuthUser,
)

class AuthSessionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun read(): AuthSession? {
        val token = prefs.getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() } ?: return null
        val userId = prefs.getString(KEY_USER_ID, null)?.takeIf { it.isNotBlank() } ?: return null
        val provider = prefs.getString(KEY_PROVIDER, PROVIDER_APP) ?: PROVIDER_APP
        if (provider == PROVIDER_GOOGLE && !isAppIssuedJwt(token)) {
            clear()
            return null
        }
        return AuthSession(
            token = token,
            provider = provider,
            user = AuthUser(
                id = userId,
                email = prefs.getString(KEY_EMAIL, "") ?: "",
                name = prefs.getString(KEY_NAME, "") ?: "",
                plan = prefs.getString(KEY_PLAN, "free") ?: "free",
            ),
        )
    }

    fun saveAppSession(response: AuthTokenResponse): AuthSession =
        save(
            token = response.token,
            provider = PROVIDER_APP,
            user = response.user,
        )

    fun saveGoogleSession(response: AuthTokenResponse): AuthSession =
        save(
            token = response.token,
            provider = PROVIDER_GOOGLE,
            user = response.user,
        )

    fun saveLegacyGoogleSession(
        idToken: String,
        id: String,
        email: String,
        name: String,
    ): AuthSession =
        save(
            token = idToken,
            provider = PROVIDER_GOOGLE,
            user = AuthUser(
                id = id,
                email = email,
                name = name,
                plan = "unknown",
            ),
        )

    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun save(token: String, provider: String, user: AuthUser): AuthSession {
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_PROVIDER, provider)
            .putString(KEY_USER_ID, user.id)
            .putString(KEY_EMAIL, user.email)
            .putString(KEY_NAME, user.name)
            .putString(KEY_PLAN, user.plan)
            .apply()
        return AuthSession(token = token, provider = provider, user = user)
    }

    private fun isAppIssuedJwt(token: String): Boolean =
        runCatching {
            val payload = token.split('.').getOrNull(1)?.let { part ->
                val padding = (4 - part.length % 4) % 4
                part + "=".repeat(padding)
            } ?: return@runCatching false
            val decoded = String(Base64.getUrlDecoder().decode(payload), Charsets.UTF_8)
            JSONObject(decoded).optString("iss") == APP_JWT_ISSUER
        }.getOrDefault(false)

    companion object {
        const val PROVIDER_APP = "app"
        const val PROVIDER_GOOGLE = "google"
        private const val APP_JWT_ISSUER = "voice-alarm"

        private const val PREFS_NAME = "voice_alarm_auth"
        private const val KEY_TOKEN = "token"
        private const val KEY_PROVIDER = "provider"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_EMAIL = "email"
        private const val KEY_NAME = "name"
        private const val KEY_PLAN = "plan"
    }
}
