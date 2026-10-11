package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthUser
import com.alarmtalk.app.network.SessionEffectKey
import com.alarmtalk.app.network.sessionEffectKey
import com.alarmtalk.app.sync.workerRolledTokenToSave
import java.io.File
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **토큰이 굴러도 앱을 다시 불러오지 않는다**(2026-09-29 효율 감사 H3·H4).
 *
 * 콜드 스타트 한 번에 요청이 57건 나갔다. 앱 루트(`AlarmTalkApp`)의 세션 효과와 탭 새로고침
 * 스로틀이 **토큰을 키로** 써서, 같은 세션 안에서 토큰이 굴러갈 때마다(진입 갱신·프리페치
 * 워커·Play 자동 정합화 뒤의 갱신) 동의·계정·목소리 준비 확인과 목소리·클립·구독 선로드가
 * 통째로 다시 돌았다. Play 구독자는 정합화 → 토큰 굴림 → 탭 효과 → 정합화의 고리까지 생겼다.
 *
 * 고정하는 것:
 *  1. **값**: 세션 키(`SessionEffectKey`)는 토큰이 굴러도 그대로이고, 계정 전환·로그아웃 뒤
 *     재로그인(**같은 계정 포함**)에서는 바뀐다 — 실제 `AuthSessionStore`(평문 prefs)로.
 *  2. **값**: 프리페치 워커는 만료가 가까울 때만 굴러온 토큰을 저장한다(`workerRolledTokenToSave`),
 *     자동 정합화 뒤 갱신은 토큰을 굴리지 않는다(`purchaseConfirmRollsToken`).
 *  3. **배선**: 위 값을 실제로 쓰는지, 그리고 뷰모델 init 의 즉시 pull 이 없는지(소스).
 *
 * `MainViewModel`·Compose 루트는 암호화 저장소·Room·워커를 통째로 물고 있어 단위 테스트에서
 * 세울 수 없다(`EntryRefreshKeepsTokenTest` 와 같은 사정) — 배선은 소스로 본다.
 *
 * Robolectric 을 쓰는 이유: `SessionTokenRenewal` 이 `android.util.Base64` 를 쓰는데 JVM 단위
 * 테스트에서는 스텁이라 늘 '못 읽음 → 갱신' 으로 떨어져 통과하는 척만 한다
 * (`SessionTokenRenewalTest` 와 같다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ColdStartRequestKeysTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val prefsName = "cold-start-request-keys-test"

    @After
    fun deleteTestPrefs() {
        context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit().clear().commit()
        File(context.filesDir.parentFile, "shared_prefs/$prefsName.xml").delete()
    }

    // ── 1. 세션 키 ──────────────────────────────────────────────────────

    @Test
    fun theSessionKeyIgnoresTheTokenButNotTheAccountOrTheGeneration() {
        val user = AuthUser(id = "u1", email = "u1@example.test")
        val before = com.alarmtalk.app.network.AuthSession(token = "t1", provider = "app", user = user)
        val rolled = before.copy(token = "t2")
        assertEquals(
            "토큰만 굴러간 세션의 키가 달라졌다 — 세션 효과가 굴릴 때마다 다시 돈다.",
            sessionEffectKey(before, generation = 3),
            sessionEffectKey(rolled, generation = 3),
        )
        assertNotEquals(
            "같은 계정이어도 세대가 오르면(로그아웃 뒤 재로그인) 키가 바뀌어야 한다.",
            sessionEffectKey(before, generation = 3),
            sessionEffectKey(before, generation = 4),
        )
        assertNotEquals(
            "계정이 바뀌면 키가 바뀌어야 한다.",
            sessionEffectKey(before, generation = 3),
            sessionEffectKey(before.copy(user = user.copy(id = "u2")), generation = 3),
        )
        assertNull(sessionEffectKey(null, generation = 3))
        assertEquals(SessionEffectKey("u1", 3), sessionEffectKey(rolled, generation = 3))
    }

    @Test
    fun theStoreKeepsTheKeyAcrossRollsAndChangesItOnReSignIn() {
        val store = AuthSessionStore(context.getSharedPreferences(prefsName, Context.MODE_PRIVATE))
        val user = AuthUser(id = "u1", email = "u1@example.test")
        store.saveAppSession(AuthTokenResponse(token = "t-login", user = user))
        fun key() = sessionEffectKey(store.read(), store.sessionGeneration())
        val signedIn = key()

        // 워커의 굴림(`saveTokenIfGeneration`)과 진입 갱신의 굴림(`saveSessionIfAlive`).
        store.saveTokenIfGeneration(store.sessionGeneration(), "t-worker")
        assertEquals("t-worker", store.read()?.token)
        assertEquals("워커가 토큰을 굴렸더니 세션 키가 바뀌었다.", signedIn, key())
        store.saveSessionIfAlive(
            expectedGeneration = store.sessionGeneration(),
            user = user,
            provider = AuthSessionStore.PROVIDER_APP,
            rolledToken = "t-entry",
            userFetchedAtMillis = System.currentTimeMillis(),
        )
        assertEquals("t-entry", store.read()?.token)
        assertEquals("진입 갱신이 토큰을 굴렸더니 세션 키가 바뀌었다.", signedIn, key())

        // 로그아웃 → **같은 계정**으로 다시 로그인. id 가 같아도 키는 달라야 동의·계정 확인이 다시 돈다.
        store.clear()
        assertNull(key())
        store.saveAppSession(AuthTokenResponse(token = "t-again", user = user))
        val again = key()
        assertEquals("u1", again?.userId)
        assertNotEquals("같은 계정 재로그인인데 세션 키가 그대로다 — 세션 효과가 다시 돌지 않는다.", signedIn, again)
    }

    // ── 2. 토큰을 굴리는 자리 ────────────────────────────────────────────

    @Test
    fun thePrefetchWorkerSavesARolledTokenOnlyNearExpiry() {
        val now = 1_800_000_000_000L
        val fresh = jwt(expiresInSeconds = 365L * 24 * 3600, nowMillis = now)
        val nearExpiry = jwt(expiresInSeconds = 30L * 24 * 3600, nowMillis = now)
        assertNull(
            "만료가 먼 토큰인데 굴러온 토큰을 저장한다 — 콜드 스타트마다 세션이 한 번 더 바뀐다.",
            workerRolledTokenToSave(currentToken = fresh, rolledToken = "rolled", nowMillis = now),
        )
        assertEquals(
            "만료가 가까운데 굴러온 토큰을 버린다 — 배경에서만 도는 회차가 유일한 갱신일 수 있다.",
            "rolled",
            workerRolledTokenToSave(currentToken = nearExpiry, rolledToken = "rolled", nowMillis = now),
        )
        // 못 읽는 토큰은 갱신한다(`SessionTokenRenewal.shouldRenew` 와 같은 규칙).
        assertEquals("rolled", workerRolledTokenToSave(currentToken = "not-a-jwt", rolledToken = "rolled", nowMillis = now))
        // 서버가 새 토큰을 안 주면 저장할 것이 없다.
        assertNull(workerRolledTokenToSave(currentToken = nearExpiry, rolledToken = null, nowMillis = now))
        assertNull(workerRolledTokenToSave(currentToken = nearExpiry, rolledToken = " ", nowMillis = now))
    }

    @Test
    fun onlyTheAutoReconcileConfirmSkipsTheTokenRoll() {
        assertFalse(purchaseConfirmRollsToken(PurchaseConfirmOrigin.AutoReconcile))
        assertTrue(purchaseConfirmRollsToken(PurchaseConfirmOrigin.UserPurchase))
        assertTrue(purchaseConfirmRollsToken(PurchaseConfirmOrigin.UserRestore))
    }

    // ── 3. 배선(소스) ───────────────────────────────────────────────────

    @Test
    fun theAppRootNeverKeysEffectsOrTheTabThrottleOnTheToken() {
        val code = withoutLineComments(appRoot)
        assertFalse(
            "AlarmTalkApp 이 다시 토큰을 효과 키로 쓴다(`LaunchedEffect(… authSession?.token …)`). " +
                "굴러갈 때마다 세션 효과가 전부 다시 돈다 — `sessionEffectKey` 를 쓸 것.",
            Regex("""LaunchedEffect\([^)]*\.token""").containsMatchIn(code),
        )
        assertFalse(
            "탭 새로고침 스로틀 키에 토큰이 들어갔다 — 굴러갈 때마다 스로틀이 풀린다.",
            code.contains("tab to authSession?.token"),
        )
        assertTrue(
            "탭 새로고침 스로틀 키가 `tab to sessionEffectKey` 가 아니다.",
            code.contains("val throttleKey = tab to sessionEffectKey"),
        )
        // 세션 효과 넷(계정·동의·준비 확인 / 선로드 / 공유 변경 구독 / 플랜 변경 구독) + 탭 효과.
        val keyed = Regex("""LaunchedEffect\((?:currentTab, )?sessionEffectKey\b""").findAll(code).count()
        assertTrue("세션 키로 도는 효과가 $keyed 개뿐이다(5개여야 한다).", keyed >= 5)
    }

    @Test
    fun autoReconcileRefreshesThePlanWithoutRollingTheToken() {
        val code = withoutLineComments(billingActions)
        assertTrue(
            "confirmGooglePurchase 가 `refreshAppSession(rollToken = purchaseConfirmRollsToken(origin))` 로 " +
                "부르지 않는다 — 자동 정합화가 토큰을 굴린다(H4).",
            code.contains("refreshAppSession(rollToken = purchaseConfirmRollsToken(origin))"),
        )
    }

    @Test
    fun thePrefetchWorkerGoesThroughTheRenewalThreshold() {
        val code = withoutLineComments(prefetchWorker)
        assertTrue(
            "StockClipPrefetchWorker 가 굴러온 토큰을 `workerRolledTokenToSave` 로 거르지 않는다.",
            code.contains("workerRolledTokenToSave(usedToken, me.token, System.currentTimeMillis())"),
        )
        assertFalse(
            "StockClipPrefetchWorker 가 다시 `me.token` 을 무조건 저장한다.",
            code.contains("me.token?.takeIf { it.isNotBlank() }?.let"),
        )
    }

    @Test
    fun theViewModelInitDoesNotQueueAnImmediatePull() {
        val start = viewModel.indexOf("    init {")
        assertTrue("MainViewModel 의 init 블록을 못 찾았다.", start >= 0)
        val end = viewModel.indexOf("override fun onCleared()", start)
        val init = withoutLineComments(viewModel.substring(start, if (end > start) end else viewModel.length))
        assertFalse(
            "MainViewModel init 이 다시 `RemoteAlarmSyncScheduler.runOnce` 를 건다 — 곧이어 오는 ON_START 의 " +
                "`runOnceThrottled` 가 REPLACE 로 취소해 요청만 한 번 더 나간다.",
            init.contains("RemoteAlarmSyncScheduler.runOnce("),
        )
        assertTrue(
            "주기 동기화 등록(`ensurePeriodic`)까지 지우면 안 된다.",
            init.contains("RemoteAlarmSyncScheduler.ensurePeriodic("),
        )
    }

    // ── 도우미 ─────────────────────────────────────────────────────────

    /** 서명 없이 payload 만 있는 가짜 JWT — 판정은 `exp` 만 읽는다(`SessionTokenRenewalTest` 와 같다). */
    private fun jwt(expiresInSeconds: Long, nowMillis: Long): String {
        val payload = JSONObject().put("exp", nowMillis / 1000 + expiresInSeconds).toString()
        val encoded = android.util.Base64.encodeToString(
            payload.toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
        )
        return "header.$encoded.signature"
    }

    private val appRoot: String by lazy { readSource("src/main/java/com/alarmtalk/app/ui/app/AlarmTalkApp.kt") }
    private val billingActions: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModelBillingActions.kt")
    }
    private val prefetchWorker: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/sync/StockClipPrefetchWorker.kt")
    }
    private val viewModel: String by lazy { readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModel.kt") }

    /** 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로. */
    private fun readSource(path: String): String {
        val file = File(path)
        assertTrue(
            "$path 를 못 찾았다(경로: ${file.absolutePath}). 파일을 옮겼으면 이 테스트의 경로도 같이 고칠 것.",
            file.exists(),
        )
        return file.readText()
    }

    /** 주석에 적힌 옛 모양(예: 경고 문구 속 `LaunchedEffect(authSession?.token)`)이 걸리지 않게 줄 주석을 걷는다. */
    private fun withoutLineComments(source: String): String =
        source.lineSequence().joinToString("\n") { line -> line.substringBefore("//") }
}
