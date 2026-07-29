package com.alarmtalk.app.network

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import java.util.Base64
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.channels.awaitClose
import org.json.JSONArray
import org.json.JSONObject

data class AuthSession(
    val token: String,
    val provider: String,
    val user: AuthUser,
)

/**
 * 지금 로그인한 계정의 users.id 를 흘린다(비로그인 null).
 *
 * SharedPreferences 변경 리스너를 쓰는 이유: 로그인·로그아웃이 어느 코드 경로를 타든
 * 결국 이 prefs 를 거치므로, 호출부가 "세션 바뀌었다"고 따로 알려 줄 필요가 없다.
 * 알람 목록 필터처럼 계정이 바뀌는 즉시 다시 계산돼야 하는 곳에서 쓴다.
 */
fun AuthSessionStore.observeUserId(): Flow<String?> = callbackFlow {
    trySend(read()?.user?.id)
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        trySend(read()?.user?.id)
    }
    registerChangeListener(listener)
    awaitClose { unregisterChangeListener(listener) }
}.distinctUntilChanged()

class AuthSessionStore(context: Context) {
    private val prefs: SharedPreferences = run {
        val appContext = context.applicationContext
        createEncryptedPrefs(appContext).also { secure ->
            migrateLegacyPlainPrefs(appContext, secure)
        }
    }

    internal fun registerChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        prefs.registerOnSharedPreferenceChangeListener(listener)
    }

    internal fun unregisterChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        prefs.unregisterOnSharedPreferenceChangeListener(listener)
    }

    /**
     * JWT 등 세션 정보를 평문 SharedPreferences 가 아닌 EncryptedSharedPreferences 에 저장한다.
     * 생성 실패(키스토어 손상 등) 시 평문 폴백 대신 prefs 파일을 초기화하고 재생성한다.
     * 세션은 잃어 재로그인이 필요하지만, 토큰이 평문으로 남는 것보다 안전하다.
     */
    private fun createEncryptedPrefs(context: Context): SharedPreferences =
        runCatching { buildEncryptedPrefs(context) }.getOrElse { error ->
            Log.w(TAG, "EncryptedSharedPreferences creation failed; resetting secure auth prefs", error)
            runCatching { context.deleteSharedPreferences(SECURE_PREFS_NAME) }
            buildEncryptedPrefs(context)
        }

    private fun buildEncryptedPrefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            SECURE_PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * 구버전이 평문 prefs(voice_alarm_auth)에 남긴 세션을 1회 암호화 저장소로 옮기고 평문을 삭제한다.
     * 암호화 prefs 에 이미 토큰이 있으면(이미 마이그레이션됨) 평문만 비운다.
     */
    private fun migrateLegacyPlainPrefs(context: Context, secure: SharedPreferences) {
        val legacy = context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
        val legacyEntries = runCatching { legacy.all }.getOrDefault(emptyMap())
        if (legacyEntries.isEmpty()) return
        if (secure.getString(KEY_TOKEN, null).isNullOrBlank()) {
            val editor = secure.edit()
            legacyEntries.forEach { (key, value) ->
                when (value) {
                    is String -> editor.putString(key, value)
                    is Boolean -> editor.putBoolean(key, value)
                    is Int -> editor.putInt(key, value)
                    is Long -> editor.putLong(key, value)
                    is Float -> editor.putFloat(key, value)
                }
            }
            editor.apply()
            Log.i(TAG, "Migrated legacy plain auth prefs to encrypted storage")
        }
        legacy.edit().clear().apply()
        runCatching { context.deleteSharedPreferences(LEGACY_PREFS_NAME) }
    }

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
        // 마지막 로그인 계정 id 만 남기고 토큰·프로필은 전부 지운다. 자동 401 처럼 세션만
        // 비우는 경로에서 알람 소유자 새기기가 실패하면, 다음 로그인 때 이 값으로 앞 계정을
        // 알아내 마저 새긴다(그러지 않으면 소유자 없는 알람을 새 계정이 물려받아 울린다).
        val lastSessionUserId = prefs.getString(KEY_LAST_SESSION_USER_ID, null)
        prefs.edit().clear().putString(KEY_LAST_SESSION_USER_ID, lastSessionUserId).apply()
    }

    /** 이 기기에서 마지막으로 로그인했던 계정 id. 세션을 비워도 남는다. */
    fun lastSessionUserId(): String? =
        prefs.getString(KEY_LAST_SESSION_USER_ID, null)?.takeIf { it.isNotBlank() }

    /**
     * 로그인 뒤처리가 끝난 뒤에 호출한다 — 그전까지는 '앞 계정' 값을 읽어야 하므로
     * 세션 저장([save]) 시점에 덮어쓰지 않는다.
     */
    fun rememberLastSessionUser(userId: String?) {
        val normalized = userId?.takeIf { it.isNotBlank() } ?: return
        prefs.edit().putString(KEY_LAST_SESSION_USER_ID, normalized).apply()
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
        // Gson 은 Kotlin 기본값을 무시하고 JSON 에 없는 필드를 null 로 남긴다. 백엔드
        // 응답(특히 Google 로그인)이나 구버전이 저장한 세션에 일부 필드가 빠지면
        // non-null 프로퍼티가 null 이 되고, copy() 생성자의 null 체크에서 NPE 가 난다.
        // 누락 가능한 non-null 필드를 모두 null-안전하게 채워 넘긴다.
        return user.copy(
            id = runCatching { user.id }.getOrNull().orEmpty(),
            email = runCatching { user.email }.getOrNull().orEmpty(),
            name = runCatching { user.name }.getOrNull().orEmpty(),
            plan = runCatching { user.plan }.getOrNull()?.takeIf { it.isNotBlank() } ?: "free",
            familyAlarmQuietDays = firstQuietWindow.days,
            familyAlarmQuietStart = firstQuietWindow.start,
            familyAlarmQuietEnd = firstQuietWindow.end,
            familyAlarmQuietWindows = quietWindows,
            dynamicPromptSettings = normalizeDynamicPromptSettings(
                runCatching { user.dynamicPromptSettings }.getOrNull(),
            ),
            deletionStatus = runCatching { user.deletionStatus }.getOrNull()
                ?.takeIf { it.isNotBlank() } ?: "active",
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

        // 구버전 평문 prefs(마이그레이션 후 삭제) / 현재 사용하는 암호화 prefs 파일명.
        private const val LEGACY_PREFS_NAME = "voice_alarm_auth"
        private const val SECURE_PREFS_NAME = "voice_alarm_auth_secure"
        private val TIME_RE = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
        private const val KEY_TOKEN = "token"
        private const val KEY_PROVIDER = "provider"
        private const val KEY_USER_ID = "user_id"

        // 세션이 끝나도 남는 유일한 값. 자동 401 로 세션이 끊길 때 알람 소유자 새기기가
        // 실패했으면(디스크 가득참 등) 다음 로그인에서 마저 새겨야 하는데, 그러려면
        // '앞 계정이 누구였는지'를 알아야 한다. [clear] 가 이 키만 남긴다.
        private const val KEY_LAST_SESSION_USER_ID = "last_session_user_id"
        private const val KEY_EMAIL = "email"
        private const val KEY_NAME = "name"
        private const val KEY_PLAN = "plan"
        private const val KEY_ALLOW_FAMILY_ALARMS = "allow_family_alarms"
        private const val KEY_FAMILY_ALARM_QUIET_DAYS = "family_alarm_quiet_days"
        private const val KEY_FAMILY_ALARM_QUIET_START = "family_alarm_quiet_start"
        private const val KEY_FAMILY_ALARM_QUIET_END = "family_alarm_quiet_end"
        private const val KEY_FAMILY_ALARM_QUIET_WINDOWS = "family_alarm_quiet_windows"
        private const val KEY_DYNAMIC_PROMPT_SETTINGS = "dynamic_prompt_settings"
        // 방해금지 창은 최대 2개(평일 근무 + 주말 정도). 백엔드 family-alarm-settings.ts와 동일.
        private const val MAX_QUIET_WINDOWS = 2
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
