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
                allowFamilyAlarms = prefs.getBoolean(KEY_ALLOW_FAMILY_ALARMS, false),
                familyAlarmQuietDays = readQuietDays(),
                familyAlarmQuietStart = prefs.getString(KEY_FAMILY_ALARM_QUIET_START, "09:00") ?: "09:00",
                familyAlarmQuietEnd = prefs.getString(KEY_FAMILY_ALARM_QUIET_END, "18:30") ?: "18:30",
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
                allowFamilyAlarms = false,
                familyAlarmQuietDays = listOf(1, 2, 3, 4, 5),
                familyAlarmQuietStart = "09:00",
                familyAlarmQuietEnd = "18:30",
            ),
        )

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun save(session: AuthSession): AuthSession =
        save(token = session.token, provider = session.provider, user = session.user)

    private fun save(token: String, provider: String, user: AuthUser): AuthSession {
        val normalizedUser = normalizeUser(user)
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_PROVIDER, provider)
            .putString(KEY_USER_ID, normalizedUser.id)
            .putString(KEY_EMAIL, normalizedUser.email)
            .putString(KEY_NAME, normalizedUser.name)
            .putString(KEY_PLAN, normalizedUser.plan)
            .putBoolean(KEY_ALLOW_FAMILY_ALARMS, normalizedUser.allowFamilyAlarms)
            .putString(KEY_FAMILY_ALARM_QUIET_DAYS, normalizedUser.familyAlarmQuietDays.joinToString(","))
            .putString(KEY_FAMILY_ALARM_QUIET_START, normalizedUser.familyAlarmQuietStart)
            .putString(KEY_FAMILY_ALARM_QUIET_END, normalizedUser.familyAlarmQuietEnd)
            .apply()
        return AuthSession(token = token, provider = provider, user = normalizedUser)
    }

    private fun readQuietDays(): List<Int> =
        prefs.getString(KEY_FAMILY_ALARM_QUIET_DAYS, null)
            ?.split(',')
            ?.mapNotNull { it.toIntOrNull()?.takeIf { day -> day in 0..6 } }
            ?.distinct()
            ?.sorted()
            ?.takeIf { it.isNotEmpty() }
            ?: listOf(1, 2, 3, 4, 5)

    private fun normalizeUser(user: AuthUser): AuthUser =
        user.copy(
            name = runCatching { user.name }.getOrNull().orEmpty(),
            plan = runCatching { user.plan }.getOrNull()?.takeIf { it.isNotBlank() } ?: "free",
            familyAlarmQuietDays = normalizeQuietDays(
                runCatching { user.familyAlarmQuietDays }.getOrNull(),
            ),
            familyAlarmQuietStart = normalizeQuietTime(
                runCatching { user.familyAlarmQuietStart }.getOrNull(),
                fallback = "09:00",
            ),
            familyAlarmQuietEnd = normalizeQuietTime(
                runCatching { user.familyAlarmQuietEnd }.getOrNull(),
                fallback = "18:30",
            ),
        )

    private fun normalizeQuietDays(days: List<Int>?): List<Int> =
        days
            ?.filter { it in 0..6 }
            ?.distinct()
            ?.sorted()
            ?.takeIf { it.isNotEmpty() }
            ?: listOf(1, 2, 3, 4, 5)

    private fun normalizeQuietTime(value: String?, fallback: String): String =
        value?.takeIf { TIME_RE.matches(it) } ?: fallback

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
        private val TIME_RE = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
        private const val KEY_TOKEN = "token"
        private const val KEY_PROVIDER = "provider"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_EMAIL = "email"
        private const val KEY_NAME = "name"
        private const val KEY_PLAN = "plan"
        private const val KEY_ALLOW_FAMILY_ALARMS = "allow_family_alarms"
        private const val KEY_FAMILY_ALARM_QUIET_DAYS = "family_alarm_quiet_days"
        private const val KEY_FAMILY_ALARM_QUIET_START = "family_alarm_quiet_start"
        private const val KEY_FAMILY_ALARM_QUIET_END = "family_alarm_quiet_end"
    }
}
