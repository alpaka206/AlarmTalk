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
 * prefs 변경을 흘리는 공통 뼈대 — 리스너를 **먼저** 걸고 그다음에 스냅샷을 읽는다.
 *
 * 순서가 핵심이다. 스냅샷을 먼저 읽으면 `read()` 와 `register()` 사이에 커밋된 변경을
 * 아무도 못 본다: 리스너가 아직 없어 콜백이 안 오고, 이미 읽은 스냅샷은 옛 값이다. 로그인
 * 직후 목록이 수집을 새로 시작하는 순간과 겹치면 계정 id 가 로그아웃 시점 값(null)에 머물러
 * '로그인은 됐는데 내 알람이 하나도 안 보이는' 상태가 된다(앱을 껐다 켜야 돌아온다).
 * 먼저 걸어 두면 그 구간의 변경도 콜백으로 잡히고, 스냅샷과 겹쳐 중복 방출되더라도
 * [distinctUntilChanged] 가 접는다.
 *
 * 등록 자체를 놓치는 것과 달리 채널 용량은 문제가 아니다 — callbackFlow 의 기본 용량은
 * 랑데뷰가 아니라 BUFFERED(64) 라, 이 정도 변경 수로는 trySend 가 실패하지 않는다.
 */
internal fun <T> prefsSnapshotFlow(
    register: (SharedPreferences.OnSharedPreferenceChangeListener) -> Unit,
    unregister: (SharedPreferences.OnSharedPreferenceChangeListener) -> Unit,
    read: () -> T,
): Flow<T> = callbackFlow {
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> trySend(read()) }
    register(listener)
    trySend(read())
    awaitClose { unregister(listener) }
}.distinctUntilChanged()

/**
 * 지금 로그인한 계정의 users.id 를 흘린다(비로그인 null).
 *
 * SharedPreferences 변경 리스너를 쓰는 이유: 로그인·로그아웃이 어느 코드 경로를 타든
 * 결국 이 prefs 를 거치므로, 호출부가 "세션 바뀌었다"고 따로 알려 줄 필요가 없다.
 * 알람 목록 필터처럼 계정이 바뀌는 즉시 다시 계산돼야 하는 곳에서 쓴다.
 */
fun AuthSessionStore.observeUserId(): Flow<String?> =
    prefsSnapshotFlow(::registerChangeListener, ::unregisterChangeListener) { read()?.user?.id }

/**
 * 세션을 비울 때 '소유자 미정 알람의 임자'로 남길 값.
 *
 * 이 마커는 "마지막에 로그인했던 사람"이 아니라 **"아직 소유자를 못 새긴 알람의 주인"**이다.
 * 세션이 끝날 때 소유자 새기기가 성공하면 미정 행이 없으므로 마커도 지워지고(clearPendingOwner),
 * 실패했을 때만 남는다.
 *
 * 그래서 **기존 마커가 우선**이다. A 의 소유권이 미해결인 채로 B 가 들어와 쓰다 나가면, 그
 * 미정 행들은 여전히 A 것이지 B 것이 아니다. 여기서 B 로 덮으면 A 의 알람이 B 것으로 새겨져
 * A 가 영영 잃는다(Codex #650). 미정이 없을 때만(마커 비어 있음) 지금 떠나는 계정을 적는다 —
 * 이 빌드 이전에 로그인해 둔 세션은 마커가 없으므로 이 경로로 커버된다.
 *
 * [AuthSessionStore] 는 EncryptedSharedPreferences(AndroidKeyStore)라 Robolectric 에서 세워지지
 * 않아, 판단 부분만 순수 함수로 떼어 테스트한다.
 */
/**
 * 표시가 없는 기기(=이 빌드 이전 상태)의 초기값. 세션이 없으면 '떼어냄' 으로 본다.
 *
 * 명시적 로그아웃과 자동 401 을 구분할 신호가 그때는 없었으므로, 둘을 가를 수 없다면 **안전한
 * 쪽**을 고른다. 되살렸는데 명시적 로그아웃이었다면 사용자가 끌 수 없는 알람이 울린다. 안
 * 되살렸는데 자동 401 이었다면 로그인 한 번으로 돌아온다 — 게다가 만료 토큰은 갱신할 수 없어
 * 어차피 다시 로그인해야 한다.
 *
 * [AuthSessionStore] 는 EncryptedSharedPreferences(AndroidKeyStore)라 Robolectric 에서 세워지지
 * 않아, 판단 부분만 순수 함수로 떼어 테스트한다([resolvePendingOwnerUserId] 와 같은 이유).
 */
internal fun resolveInitialAlarmsDetached(hasStoredToken: Boolean): Boolean = !hasStoredToken

internal fun resolvePendingOwnerUserId(leavingUserId: String?, existingPendingOwner: String?): String? =
    existingPendingOwner?.takeIf { it.isNotBlank() }
        ?: leavingUserId?.takeIf { it.isNotBlank() }

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
        // '소유자 미정 알람의 임자'만 남기고 토큰·프로필은 전부 지운다. 세션이 끝날 때
        // 소유자 새기기가 실패하면 그 행들이 누구 것인지 알 길이 이 값뿐이다 — 없으면
        // 다음에 로그인한 계정이 앞 계정 알람을 물려받아 울린다.
        //
        // 이미 미정 임자가 적혀 있으면 그대로 둔다: A 의 소유권이 미해결인 채 B 가 들어와
        // 쓰다 나가도 그 행들은 여전히 A 것이다. 미정이 없을 때만 지금 떠나는 계정을 적는다.
        // ([read] 가 무효한 구 구글 세션을 지우는 경로, 이 빌드 이전 세션도 이걸로 커버된다.)
        val pendingOwner = resolvePendingOwnerUserId(
            leavingUserId = prefs.getString(KEY_USER_ID, null),
            existingPendingOwner = prefs.getString(KEY_PENDING_OWNER_USER_ID, null),
        )
        // '명시적 로그아웃으로 알람을 떼어냈다' 표시도 같이 지켜야 한다. 이 값이 clear 에
        // 쓸려 나가면 재예약이 로그아웃한 계정의 알람을 되살린다([alarmsDetachedOnSignOut]).
        val detached = prefs.getBoolean(KEY_ALARMS_DETACHED, false)
        prefs.edit()
            .clear()
            .putString(KEY_PENDING_OWNER_USER_ID, pendingOwner)
            .putBoolean(KEY_ALARMS_DETACHED, detached)
            .apply()
    }

    /**
     * 명시적 로그아웃(로그아웃·탈퇴)에서 이 기기의 알람 예약을 떼어냈다는 표시.
     *
     * 자동 401 과 구분하기 위해서만 존재한다. 둘 다 세션이 비어 `currentUserIdProvider()` 가
     * null 이지만 알람에 대한 기대가 정반대다:
     *  - 자동 401(토큰 만료): 본인이 그대로 쓰던 기기다. 알람은 계속 울려야 하고, 업데이트로
     *    OS 예약이 지워졌으면 다시 새겨야 한다.
     *  - 명시적 로그아웃: 사용자가 끝낸 것이다. `detachAlarmsOnSignOut` 이 예약을 이미
     *    취소했고, **다시 로그인하기 전까지 되살리면 안 된다** — 로그아웃 뒤에는 목록이
     *    로그인 화면에 가려 사용자가 끌 수도 없는데 울리게 된다.
     */
    fun markAlarmsDetachedOnSignOut() {
        prefs.edit().putBoolean(KEY_ALARMS_DETACHED, true).apply()
    }

    /**
     * 로그인이 확정된 시점에만 부른다([MainViewModel] 의 onSignedIn). [save] 에서 지우면 안 된다 —
     * save 는 프로필 수정·`refreshAppSession` 도 부르므로, 로그아웃 직후 늦게 도착한 응답 하나가
     * 표시를 지우고 세션까지 되살려 떼어낸 알람이 로그인 화면 뒤에서 되살아난다.
     */
    fun clearAlarmsDetachedOnSignOut() {
        prefs.edit().remove(KEY_ALARMS_DETACHED).apply()
    }

    /**
     * 표시가 아직 한 번도 안 쓰인 기기(=이 빌드 이전에 로그아웃/만료된 기기)는 **세션 유무로
     * 한 번 정해 준다.** 이 키는 새로 생긴 것이라 기본값 false 로 두면, 예전 버전에서 명시적
     * 로그아웃을 한 기기가 이 빌드를 받는 순간 소유자 있는 알람을 전부 되살린다 — 로그인 화면
     * 뒤라 끌 수도 없다(Codex #665 P1).
     *
     * 세션이 없으면 '떼어냄' 으로 본다. 자동 401 로 끊긴 기기까지 함께 묶이지만, 그쪽은 어차피
     * 만료 토큰을 갱신할 수 없어 한 번은 다시 로그인해야 하고(jwt.ts 참고) 지금도 알람이 안
     * 울리는 상태다. **되살려서 못 끄게 만드는 쪽보다 안 되살려서 로그인 한 번 시키는 쪽이
     * 안전하다.** 로그인 이후부터는 이 표시가 정확히 두 경우를 가른다.
     */
    fun alarmsDetachedOnSignOut(): Boolean {
        if (prefs.contains(KEY_ALARMS_DETACHED)) {
            return prefs.getBoolean(KEY_ALARMS_DETACHED, false)
        }
        // read() 를 쓰지 않는다 — read() 는 무효한 구 구글 세션에서 clear() 를 부르고,
        // clear() 가 다시 이 키를 읽어 순서가 꼬인다. 토큰 유무만 직접 본다.
        val detached = resolveInitialAlarmsDetached(
            hasStoredToken = !prefs.getString(KEY_TOKEN, null).isNullOrBlank(),
        )
        prefs.edit().putBoolean(KEY_ALARMS_DETACHED, detached).apply()
        return detached
    }

    /** 아직 소유자를 못 새긴 알람의 임자(없으면 null). 세션을 비워도 남는다. */
    fun pendingOwnerUserId(): String? =
        prefs.getString(KEY_PENDING_OWNER_USER_ID, null)?.takeIf { it.isNotBlank() }

    /**
     * 소유자 새기기가 끝나 미정 행이 없어졌을 때 호출한다. 지워 두지 않으면 다음 세션 종료
     * 때 [clear] 가 옛 임자를 그대로 지켜, 실제로는 지금 계정 것인 행을 남에게 넘긴다.
     */
    fun clearPendingOwner() {
        prefs.edit().remove(KEY_PENDING_OWNER_USER_ID).apply()
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

        // 세션이 끝나도 남는 유일한 값 — 아직 소유자를 못 새긴 알람의 임자. 세션 종료 시
        // 새기기가 실패했을 때(디스크 가득참 등) 다음 기회에 누구 것으로 새길지의 유일한
        // 근거다. [clear] 가 이 키만 남기고, 정리가 끝나면 [clearPendingOwner] 가 지운다.
        // (저장 키 문자열은 옛 이름을 유지한다 — 이미 기록된 기기의 값을 잃지 않기 위해.)
        private const val KEY_PENDING_OWNER_USER_ID = "last_session_user_id"
        private const val KEY_ALARMS_DETACHED = "alarms_detached_on_sign_out"
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
