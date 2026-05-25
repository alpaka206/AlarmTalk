package com.voicealarm.nativeapp.network

import android.content.Context
import java.util.Base64
import org.json.JSONArray
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
        val quietWindows = readQuietWindows()
        val firstQuietWindow = quietWindows.firstOrNull()
        return AuthSession(
            token = token,
            provider = provider,
            user = AuthUser(
                id = userId,
                email = prefs.getString(KEY_EMAIL, "") ?: "",
                name = prefs.getString(KEY_NAME, "") ?: "",
                plan = prefs.getString(KEY_PLAN, "free") ?: "free",
                allowFamilyAlarms = prefs.getBoolean(KEY_ALLOW_FAMILY_ALARMS, false),
                familyAlarmQuietDays = firstQuietWindow?.days ?: readQuietDays(),
                familyAlarmQuietStart = firstQuietWindow?.start
                    ?: prefs.getString(KEY_FAMILY_ALARM_QUIET_START, "09:00") ?: "09:00",
                familyAlarmQuietEnd = firstQuietWindow?.end
                    ?: prefs.getString(KEY_FAMILY_ALARM_QUIET_END, "18:30") ?: "18:30",
                familyAlarmQuietWindows = quietWindows,
                dynamicPromptSettings = readDynamicPromptSettings(),
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

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun save(session: AuthSession): AuthSession =
        save(token = session.token, provider = session.provider, user = session.user)

    private fun save(token: String, provider: String, user: AuthUser): AuthSession {
        val normalizedUser = normalizeUser(user)
        val firstQuietWindow = normalizedUser.familyAlarmQuietWindows.firstOrNull()
            ?: FamilyAlarmQuietWindow(days = normalizedUser.familyAlarmQuietDays)
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_PROVIDER, provider)
            .putString(KEY_USER_ID, normalizedUser.id)
            .putString(KEY_EMAIL, normalizedUser.email)
            .putString(KEY_NAME, normalizedUser.name)
            .putString(KEY_PLAN, normalizedUser.plan)
            .putBoolean(KEY_ALLOW_FAMILY_ALARMS, normalizedUser.allowFamilyAlarms)
            .putString(KEY_FAMILY_ALARM_QUIET_DAYS, firstQuietWindow.days.joinToString(","))
            .putString(KEY_FAMILY_ALARM_QUIET_START, firstQuietWindow.start)
            .putString(KEY_FAMILY_ALARM_QUIET_END, firstQuietWindow.end)
            .putString(KEY_FAMILY_ALARM_QUIET_WINDOWS, encodeQuietWindows(normalizedUser.familyAlarmQuietWindows))
            .putString(KEY_DYNAMIC_PROMPT_SETTINGS, encodeDynamicPromptSettings(normalizedUser.dynamicPromptSettings))
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

    private fun readQuietWindows(): List<FamilyAlarmQuietWindow> {
        val encoded = prefs.getString(KEY_FAMILY_ALARM_QUIET_WINDOWS, null)
        if (!encoded.isNullOrBlank()) {
            runCatching {
                val array = JSONArray(encoded)
                List(array.length()) { index ->
                    val item = array.getJSONObject(index)
                    FamilyAlarmQuietWindow(
                        days = normalizeQuietDays(
                            List(item.optJSONArray("days")?.length() ?: 0) { dayIndex ->
                                item.optJSONArray("days")?.optInt(dayIndex) ?: -1
                            },
                        ),
                        start = normalizeQuietTime(item.optString("start"), "09:00"),
                        end = normalizeQuietTime(item.optString("end"), "18:30"),
                    )
                }.filter { it.days.isNotEmpty() }
            }.getOrNull()?.let { return it }
        }
        return listOf(
            FamilyAlarmQuietWindow(
                days = readQuietDays(),
                start = prefs.getString(KEY_FAMILY_ALARM_QUIET_START, "09:00") ?: "09:00",
                end = prefs.getString(KEY_FAMILY_ALARM_QUIET_END, "18:30") ?: "18:30",
            ),
        )
    }

    private fun encodeQuietWindows(windows: List<FamilyAlarmQuietWindow>): String {
        val array = JSONArray()
        windows.forEach { window ->
            array.put(
                JSONObject()
                    .put("days", JSONArray(window.days))
                    .put("start", window.start)
                    .put("end", window.end),
            )
        }
        return array.toString()
    }

    private fun readDynamicPromptSettings(): DynamicPromptSettings {
        val encoded = prefs.getString(KEY_DYNAMIC_PROMPT_SETTINGS, null) ?: return DynamicPromptSettings()
        return runCatching {
            val root = JSONObject(encoded)
            val weather = root.optJSONObject("weather")
            val fortune = root.optJSONObject("fortune")
            DynamicPromptSettings(
                weather = DynamicPromptWeatherSettings(
                    country = weather?.optString("country").trimmedOrNull(),
                    city = weather?.optString("city").trimmedOrNull(),
                ),
                fortune = DynamicPromptFortuneSettings(
                    gender = fortune?.optString("gender").trimmedOrNull(),
                    birthDate = fortune?.optString("birth_date").trimmedOrNull(),
                    birthTime = fortune?.optString("birth_time").trimmedOrNull(),
                ),
            )
        }.getOrDefault(DynamicPromptSettings())
    }

    private fun encodeDynamicPromptSettings(settings: DynamicPromptSettings): String =
        JSONObject()
            .put(
                "weather",
                JSONObject()
                    .put("country", settings.weather.country.trimmedOrNull())
                    .put("city", settings.weather.city.trimmedOrNull()),
            )
            .put(
                "fortune",
                JSONObject()
                    .put("gender", settings.fortune.gender.trimmedOrNull())
                    .put("birth_date", settings.fortune.birthDate.trimmedOrNull())
                    .put("birth_time", settings.fortune.birthTime.trimmedOrNull()),
            )
            .toString()

    private fun normalizeUser(user: AuthUser): AuthUser {
        val legacyDays = normalizeQuietDays(runCatching { user.familyAlarmQuietDays }.getOrNull())
        val legacyStart = normalizeQuietTime(
            runCatching { user.familyAlarmQuietStart }.getOrNull(),
            fallback = "09:00",
        )
        val legacyEnd = normalizeQuietTime(
            runCatching { user.familyAlarmQuietEnd }.getOrNull(),
            fallback = "18:30",
        )
        val quietWindows = normalizeQuietWindows(
            runCatching { user.familyAlarmQuietWindows }.getOrNull(),
            fallback = FamilyAlarmQuietWindow(legacyDays, legacyStart, legacyEnd),
        )
        val firstQuietWindow = quietWindows.firstOrNull()
            ?: FamilyAlarmQuietWindow(days = legacyDays, start = legacyStart, end = legacyEnd)
        return user.copy(
            name = runCatching { user.name }.getOrNull().orEmpty(),
            plan = runCatching { user.plan }.getOrNull()?.takeIf { it.isNotBlank() } ?: "free",
            familyAlarmQuietDays = firstQuietWindow.days,
            familyAlarmQuietStart = firstQuietWindow.start,
            familyAlarmQuietEnd = firstQuietWindow.end,
            familyAlarmQuietWindows = quietWindows,
            dynamicPromptSettings = normalizeDynamicPromptSettings(
                runCatching { user.dynamicPromptSettings }.getOrNull(),
            ),
        )
    }

    private fun normalizeQuietDays(days: List<Int>?): List<Int> =
        days
            ?.filter { it in 0..6 }
            ?.distinct()
            ?.sorted()
            ?.takeIf { it.isNotEmpty() }
            ?: listOf(1, 2, 3, 4, 5)

    private fun normalizeQuietTime(value: String?, fallback: String): String =
        value?.takeIf { TIME_RE.matches(it) } ?: fallback

    private fun normalizeQuietWindows(
        windows: List<FamilyAlarmQuietWindow>?,
        fallback: FamilyAlarmQuietWindow,
    ): List<FamilyAlarmQuietWindow> {
        if (windows == null) return listOf(fallback)
        return windows
            .mapNotNull { window ->
                val days = normalizeQuietDays(runCatching { window.days }.getOrNull()).takeIf { it.isNotEmpty() }
                val start = normalizeQuietTime(runCatching { window.start }.getOrNull(), "")
                val end = normalizeQuietTime(runCatching { window.end }.getOrNull(), "")
                if (days == null || start.isBlank() || end.isBlank()) {
                    null
                } else {
                    FamilyAlarmQuietWindow(days = days, start = start, end = end)
                }
            }
            .take(MAX_QUIET_WINDOWS)
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
        private const val KEY_FAMILY_ALARM_QUIET_WINDOWS = "family_alarm_quiet_windows"
        private const val KEY_DYNAMIC_PROMPT_SETTINGS = "dynamic_prompt_settings"
        private const val MAX_QUIET_WINDOWS = 8
    }
}

internal fun normalizeDynamicPromptSettings(settings: DynamicPromptSettings?): DynamicPromptSettings {
    val weather = runCatching { settings?.weather }.getOrNull()
    val fortune = runCatching { settings?.fortune }.getOrNull()
    return DynamicPromptSettings(
        weather = DynamicPromptWeatherSettings(
            country = runCatching { weather?.country }.getOrNull().trimmedOrNull(),
            city = runCatching { weather?.city }.getOrNull().trimmedOrNull(),
        ),
        fortune = DynamicPromptFortuneSettings(
            gender = runCatching { fortune?.gender }.getOrNull().trimmedOrNull(),
            birthDate = runCatching { fortune?.birthDate }.getOrNull().trimmedOrNull(),
            birthTime = runCatching { fortune?.birthTime }.getOrNull().trimmedOrNull(),
        ),
    )
}
