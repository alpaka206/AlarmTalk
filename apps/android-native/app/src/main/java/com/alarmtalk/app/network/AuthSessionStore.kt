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
 * 저장된 세션 전체를 흘린다(비로그인 null).
 *
 * [observeUserId] 는 '계정이 바뀌었나' 만 보므로 **같은 계정 안에서 토큰이 굴러가는 것**을
 * 잡지 못한다. 그런데 그게 실제로 일어난다 — 백그라운드 워커가 `GET /auth/me` 로 받은 새
 * 토큰을 저장소에만 쓰고, 이미 살아 있는 ViewModel 은 옛 토큰을 계속 들고 있다.
 *
 * 그 상태가 위험한 이유는 401 이 나서가 아니라 **401 이 나도 아무 일도 안 일어나서**다:
 * 401 처리기는 '저장소에 더 새 토큰이 있다' 는 이유로 그 401 을 무시하고, okhttp 인증기는
 * 재발급 수단이 없어 재시도하지 않는다. 그래서 멀쩡한 토큰을 두고 요청만 조용히 실패하고
 * 사용자는 이유도 모른 채 같은 동작을 다시 해야 한다(Codex #665 P2).
 *
 * 토큰만이 아니라 세션 전체를 흘리는 이유: 프로필 갱신도 같은 경로로 저장되므로, 화면이
 * 쓰는 값까지 한 번에 수렴한다. [AuthSession] 은 data class 라 [distinctUntilChanged] 가
 * 무관한 prefs 변경(예약 표시 등)을 접어 준다.
 */
fun AuthSessionStore.observeSession(): Flow<AuthSession?> =
    prefsSnapshotFlow(::registerChangeListener, ::unregisterChangeListener) { read() }

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
internal fun resolvePendingOwnerUserId(leavingUserId: String?, existingPendingOwner: String?): String? =
    existingPendingOwner?.takeIf { it.isNotBlank() }
        ?: leavingUserId?.takeIf { it.isNotBlank() }

/**
 * 저장소에 쓰인 세션을 메모리로 **끌어와도 되는가**.
 *
 * 판정은 하나다 — "저장소가 지금 메모리보다 나은가". 셋 중 하나라도 걸리면 아니다:
 *  - 저장소가 비었다(로그아웃 직후). 끌어오면 세션 정리를 되돌리는 셈이다.
 *  - 메모리에 세션이 없다. 로그인은 로그인 경로가 한다.
 *  - 계정이 다르다. 계정 전환은 정리와 함께 로그인 경로가 처리한다.
 *
 * 순수 함수로 떼어 둔 이유는 [sessionSurvivedForWrite] 와 같다 — 이 판정이 느슨해지면
 * 로그아웃한 세션이 되살아나고, 빡빡해지면 좀비 세션이 남는다.
 */
internal fun shouldAbsorbStoredSession(
    stored: AuthSession?,
    current: AuthSession?,
    signingOut: Boolean,
): Boolean {
    if (stored == null || current == null || signingOut) return false
    if (stored.user.id != current.user.id) return false
    return stored != current
}

/**
 * 오래 걸린 작업이 결과를 되쓰기 직전에 묻는 것: **내가 시작할 때의 그 세션이 아직 살아 있나.**
 *
 * 두 조건을 모두 본다.
 *  - **세대가 같다.** 세대는 [AuthSessionStore.clear] 에서만 오르므로 "그 사이 세션이 끝났다"
 *    를 정확히 가른다. 토큰 비교는 rolling refresh 를 전환으로 오판하고, 계정 id 비교는
 *    로그아웃 후 같은 계정 재로그인을 통과시킨다.
 *  - **토큰이 남아 있다.** 세대가 같아도 토큰이 비었으면 그건 세션이 없는 상태이고, 거기에
 *    쓰는 것은 저장이 아니라 부활이다.
 *
 * 순수 함수로 떼어 둔 이유는 [resolvePendingOwnerUserId] 와 같다 — 이 판정이 조용히 뒤집히면
 * 로그아웃이 통째로 되돌아가는데, 암호화 prefs 를 띄우지 않고 규칙만 고정해 두려는 것이다.
 */
internal fun sessionSurvivedForWrite(
    expectedGeneration: Long,
    currentGeneration: Long,
    currentToken: String?,
): Boolean = currentGeneration == expectedGeneration && !currentToken.isNullOrBlank()

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

    fun clear() = synchronized(sessionWriteLock) {
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
        // '자동 만료로 끊긴 계정' 도 같이 지켜야 한다. 이 값이 clear 에 쓸려 나가면 업데이트
        // 후 재예약이 복원 대상을 잃는다([sessionExpiredOwnerUserId]).
        val expiredOwner = prefs.getString(KEY_SESSION_EXPIRED_OWNER, null)
        // ⚠ **끄기가 밀린 알람 목록도 살려야 한다**(Codex #699 P2). 이 clear 는
        // `prefs.edit().clear()` 라 **명시적으로 되살리는 키만** 남는다. 로그아웃 흐름은
        // 이 함수를 **두 번** 부르는데(떼어내기 안에서 한 번, 이어서 세션 정리에서 한 번),
        // 두 번째가 방금 적어 둔 목록을 지우면 프로세스가 죽은 뒤 그 알람이 되살아난다.
        val pendingDisables = prefs.getStringSet(KEY_PENDING_DISABLE_ALARM_IDS, null)?.toSet()
        // 세션 세대를 올린다 — 이 값이 바뀌면 "그 사이 세션이 끝났다" 는 뜻이다.
        // 자세한 계약은 [sessionGeneration] 주석 참고.
        val nextGeneration = prefs.getLong(KEY_SESSION_GENERATION, 0L) + 1L
        prefs.edit()
            .clear()
            .putString(KEY_PENDING_OWNER_USER_ID, pendingOwner)
            .putLong(KEY_SESSION_GENERATION, nextGeneration)
            .also { if (expiredOwner != null) it.putString(KEY_SESSION_EXPIRED_OWNER, expiredOwner) }
            .also { if (!pendingDisables.isNullOrEmpty()) it.putStringSet(KEY_PENDING_DISABLE_ALARM_IDS, pendingDisables) }
            .apply()
    }

    /**
     * **자동으로 세션이 끊긴(토큰 만료·폐기) 계정.** 없으면 null.
     *
     * 비로그인 상태에서 어떤 알람을 되살려도 되는지 가르는 값이다. 자동 401 과 명시적
     * 로그아웃은 둘 다 세션이 비어 `currentUserIdProvider()` 가 null 이지만 알람에 대한 기대가
     * 정반대다:
     *  - 자동 401(토큰 만료): 본인이 그대로 쓰던 기기다. 알람은 계속 울려야 하고, 업데이트로
     *    OS 예약이 지워졌으면 다시 새겨야 한다.
     *  - 명시적 로그아웃: 사용자가 끝낸 것이다. `detachAlarmsOnSignOut` 이 예약을 이미
     *    취소했고, **다시 로그인하기 전까지 되살리면 안 된다** — 로그아웃 뒤에는 목록이
     *    로그인 화면에 가려 사용자가 끌 수도 없는데 울리게 된다.
     *
     * 불리언이 아니라 **계정 id** 를 담는 이유는 한 기기에 여러 계정이 오갔을 때다. A 가
     * 명시적으로 로그아웃하고 B 가 로그인한 뒤 B 의 세션만 자동 만료되면, 되살려야 하는 건
     * B 의 알람뿐이다. 불리언이면 A 의 알람까지 로그인 화면 뒤에서 함께 살아난다(Codex #665 P1).
     *
     * 값이 없는 기기(이 빌드 이전 상태 포함)는 **아무것도 되살리지 않는다** — 못 가릴 때는
     * 되살려서 못 끄게 만드는 쪽보다 로그인 한 번 시키는 쪽이 안전하다. 그래서 별도 마이그레이션이
     * 필요 없다.
     *
     * ## 구버전 코호트를 백필하지 않기로 한 이유 (2026-08-04 확정)
     *
     * 1.2.1 이하에서 이미 자동 401 로 끊긴 기기는 이 값이 없어 알람이 안 울린다. 실재하는
     * 손해라 백필을 검토했고, **하지 않기로 했다.**
     *
     * 그 버전들에서는 자동 401 과 명시적 로그아웃이 **로컬에 똑같은 흔적을 남긴다** — 알람
     * 행은 둘 다 `ownerUserId=A`·`enabled=1` 이고(로그아웃도 소유자를 null 로 떼지 않는다)
     * 세션만 비어 있다. 유일한 비대칭은 '명시적 로그아웃만 `default_voice_<A>` 같은 계정별
     * 취향 키를 지운다' 는 부수효과 하나뿐인데, 그건 한쪽으로만 성립하는 추측이다.
     *
     * 추측으로 되살리면 직접 로그아웃한 사람의 알람이 울리는데, 그 목록은 `observeAlarms` 의
     * 소유자 필터에 가려 로그인 화면 뒤에 있다 — **끌 수가 없다.** 안 울리는 것보다 나쁘다.
     *
     * 대신 출시 노트로 "한 번 로그인해 주세요" 를 안내한다(`docs/product/release-notes.md`).
     * 이 출시부터는 이 값이 남으므로 재발하지 않는다.
     */
    fun sessionExpiredOwnerUserId(): String? =
        prefs.getString(KEY_SESSION_EXPIRED_OWNER, null)?.takeIf { it.isNotBlank() }

    /**
     * 세션 세대. **세션이 끝날 때만** 올라간다([clear] — 로그아웃·탈퇴·자동 401).
     *
     * 오래 걸리는 작업이 "내가 시작할 때의 그 세션이 아직 살아 있나" 를 판정하는 기준이다.
     * 토큰으로 비교하면 안 된다 — `GET /auth/me` 의 rolling refresh 가 같은 세션 안에서도
     * 토큰을 갈아 끼운다. 계정 id 로 비교해도 부족하다 — 로그아웃 후 **같은 계정**으로 다시
     * 로그인하면 id 가 같아 통과하고, 그 작업이 폐기된 옛 토큰을 되살려 쓴다(Codex #665 P2).
     *
     * 이 값은 세션이 끝날 때만 바뀌므로 두 경우를 모두 가른다.
     */
    fun sessionGeneration(): Long = prefs.getLong(KEY_SESSION_GENERATION, 0L)

    /** 자동 401 처리에서 세션을 비우기 **전에** 부른다. */
    fun markSessionExpired(userId: String?) {
        val resolved = userId?.takeIf { it.isNotBlank() } ?: return
        prefs.edit().putString(KEY_SESSION_EXPIRED_OWNER, resolved).apply()
    }

    /**
     * 명시적 로그아웃과 로그인 확정([MainViewModel] 의 onSignedIn) 양쪽에서 부른다.
     *
     * [save] 에서 지우면 안 된다 — save 는 프로필 수정·`refreshAppSession` 도 부르므로,
     * 로그아웃 직후 늦게 도착한 응답 하나가 표시를 지워 떼어낸 알람이 되살아난다.
     */
    fun clearSessionExpiredOwner() {
        prefs.edit().remove(KEY_SESSION_EXPIRED_OWNER).apply()
    }

    /**
     * **끄기가 실패해 아직 켜진 채인 알람 id 들.**
     *
     * ⚠ 로그아웃은 예약을 취소하고 행도 끄는데, 그 쓰기가 Room/디스크 오류로 실패할 수 있다.
     * 메모리 게이트로만 막으면 **프로세스가 죽는 순간 사라져**, 같은 계정으로 다시 로그인할 때
     * [reschedulePendingAlarms] 가 **명시적으로 로그아웃한 알람을 자동으로 되살린다**
     * (2026-08-19 Codex #699 P2). 그래서 세션과 무관하게 **prefs 에 남긴다** —
     * [clear] 가 지우지 않는 값이다.
     */
    fun pendingDisableAlarmIds(): Set<String> =
        prefs.getStringSet(KEY_PENDING_DISABLE_ALARM_IDS, emptySet())?.toSet() ?: emptySet()

    /** 끄기에 실패한 알람을 적어 둔다. 다음 기회에 다시 끈다. */
    fun addPendingDisableAlarmIds(ids: Collection<String>) {
        if (ids.isEmpty()) return
        val next = pendingDisableAlarmIds() + ids
        prefs.edit().putStringSet(KEY_PENDING_DISABLE_ALARM_IDS, next).apply()
    }

    /** 실제로 껐을 때만 지운다. */
    fun clearPendingDisableAlarmIds(ids: Collection<String>) {
        if (ids.isEmpty()) return
        val next = pendingDisableAlarmIds() - ids.toSet()
        if (next.isEmpty()) {
            prefs.edit().remove(KEY_PENDING_DISABLE_ALARM_IDS).apply()
        } else {
            prefs.edit().putStringSet(KEY_PENDING_DISABLE_ALARM_IDS, next).apply()
        }
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

    /**
     * **토큰만** 갈아 끼운다(프로필은 저장소에 있는 것을 그대로 둔다). 시작할 때의 세션이
     * 살아 있지 않으면 아무것도 쓰지 않고 null.
     *
     * 백그라운드 워커는 이걸 쓴다. 워커가 [saveSessionIfGeneration] 으로 **프로필까지** 쓰면,
     * 자기가 `/auth/me` 를 받은 뒤 남은 요청을 도는 사이 전경에서 닉네임·설정이 바뀌었을 때
     * **그 최신 값을 자기 옛 스냅샷으로 되돌린다.** 화면은 관찰로 저장소를 따라오므로 사용자가
     * 방금 바꾼 이름이 눈앞에서 옛 이름으로 돌아간다(Codex #665 P2).
     *
     * 워커가 정말 필요한 건 굴러간 토큰 하나뿐이다 — 플랜 판정은 이 함수와 무관하게
     * 워커 안에서 쓰고, 권한 스냅샷은 `AccessSnapshotStore` 가 따로 들고 있다.
     */
    /**
     * 세대가 그대로일 때만 [action] 을 돌린다 — **검사와 실행을 한 덩어리로**(2026-09-01 리뷰).
     *
     * ⚠ `if (sessionGeneration() == start) { write() }` 로 쓰면 그 사이가 창이다. 로그아웃→
     * 같은 계정 재로그인이 끼면 옛 응답이 **새 세션의 스냅샷을 되살린다** — 굴러온 토큰이
     * 없는 회차에는 뒤이은 CAS 도 안 돌아 아무도 못 막는다. 세션 쓰기와 같은 락을 잡는다.
     *
     * @return action 을 돌렸으면 true.
     */
    fun runIfGeneration(expectedGeneration: Long, action: () -> Unit): Boolean =
        synchronized(sessionWriteLock) {
            val alive = sessionSurvivedForWrite(
                expectedGeneration = expectedGeneration,
                currentGeneration = prefs.getLong(KEY_SESSION_GENERATION, 0L),
                currentToken = prefs.getString(KEY_TOKEN, null),
            )
            if (!alive) return@synchronized false
            action()
            true
        }

    fun saveTokenIfGeneration(expectedGeneration: Long, token: String): AuthSession? =
        synchronized(sessionWriteLock) {
            val alive = sessionSurvivedForWrite(
                expectedGeneration = expectedGeneration,
                currentGeneration = prefs.getLong(KEY_SESSION_GENERATION, 0L),
                currentToken = prefs.getString(KEY_TOKEN, null),
            )
            if (!alive || token.isBlank()) return@synchronized null
            prefs.edit().putString(KEY_TOKEN, token).apply()
            read()
        }

    /**
     * 서버 응답을 세션에 반영한다 — **판정과 쓰기를 한 덩어리로.** [clear]·
     * [saveTokenIfGeneration] 과 같은 락을 잡는다.
     *
     * 검사와 저장을 따로 하면 그 사이가 창이다. 두 가지가 실제로 새어 나왔다:
     *  - 세대를 확인한 뒤 로그아웃이 끼면 **비운 저장소에 끝난 세션을 되쓴다**(Codex #665 P1).
     *  - 전경이 토큰 A 를 읽은 뒤 워커가 굴러간 B 를 저장하고, 전경이 프로필을 쓰며 A 를
     *    되쓴다 — **방금 갱신된 B 가 버려진다.** A 의 만료가 가까웠다면 다음 요청이 401 로
     *    떨어져, 갱신에 성공하고도 재로그인을 강요한다(Codex #665 P2).
     *
     * @param rolledToken 서버가 이번 응답으로 **새로 준** 토큰. 없으면(null·공백) 저장소의
     *   현재 토큰을 지킨다 — 호출부가 시작할 때 잡아 둔 토큰으로 되돌리면 안 된다. 그 사이
     *   굴러간 토큰을 옛 것으로 덮는 것이기 때문이다.
     *
     * 저장하지 않는 경우(모두 null 반환):
     *  - 시작할 때의 세션이 이미 끝났다([sessionSurvivedForWrite]).
     *  - 그 사이 다른 계정이 됐다. 그대로 쓰면 A 의 유저 정보에 B 의 토큰이 붙은 **잡종 세션**
     *    이 저장된다 — 목록은 A 로 걸러지는데 서버 호출은 B 로 나간다.
     */
    fun saveSessionIfAlive(
        expectedGeneration: Long,
        user: AuthUser,
        provider: String,
        rolledToken: String?,
    ): AuthSession? = synchronized(sessionWriteLock) {
        val storedToken = prefs.getString(KEY_TOKEN, null)
        val alive = sessionSurvivedForWrite(
            expectedGeneration = expectedGeneration,
            currentGeneration = prefs.getLong(KEY_SESSION_GENERATION, 0L),
            currentToken = storedToken,
        )
        if (!alive) return@synchronized null
        if (prefs.getString(KEY_USER_ID, null) != user.id) return@synchronized null
        save(
            token = rolledToken?.takeIf { it.isNotBlank() } ?: storedToken.orEmpty(),
            provider = provider,
            user = user,
        )
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

        /**
         * 세션을 **끝내는 쓰기**([clear])와 **되쓰는 쓰기**([saveSessionIfGeneration])의 상호배제.
         *
         * 인스턴스가 아니라 클래스에 두는 이유는 [saveSessionIfGeneration] 주석 참고 —
         * 워커와 ViewModel 이 서로 다른 인스턴스로 같은 prefs 를 본다.
         */
        private val sessionWriteLock = Any()

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
        private const val KEY_SESSION_EXPIRED_OWNER = "session_expired_owner_user_id"
        private const val KEY_PENDING_DISABLE_ALARM_IDS = "pending_disable_alarm_ids"
        private const val KEY_SESSION_GENERATION = "session_generation"
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
