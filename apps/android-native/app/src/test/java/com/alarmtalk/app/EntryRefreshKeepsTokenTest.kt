package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthUser
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * **백그라운드에서 돌아올 때마다의 `/auth/me` 는 토큰을 굴리지 않는다**
 * (`refreshAppSessionNow(rollToken = false)`).
 *
 * 토큰이 바뀌면 토큰을 키로 쓰는 효과가 전부 다시 돈다(동의·계정·목소리 준비 확인과 목소리·
 * 클립·구독 선로드) — 복귀할 때마다 앱 전체를 다시 불러오게 된다. 그래서 토큰은 뷰모델의 첫
 * 갱신(콜드 스타트)과 워커만 굴리고, 복귀 때는 plan·프로모만 새로 받는다.
 *
 * `MainViewModel` 은 암호화 저장소·Room·워커를 통째로 물고 있어 단위 테스트에서 세울 수 없다
 * (`SignOutWindowOpensBeforeServerCallTest` 와 같은 사정). 그래서 둘로 나눠 고정한다:
 *  1. **값**: 굴리지 않는 갱신이 저장소에 넘기는 토큰(`sessionTokenToSave`)과, 저장소가 그걸 받아
 *     **지금 토큰을 지키는지**(실제 `AuthSessionStore`, 평문 prefs).
 *  2. **배선**: `refreshAppSessionNow` 가 그 함수를 거치고, 진입 구독이 첫 갱신에서만 굴리는지(소스).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EntryRefreshKeepsTokenTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val prefsName = "entry-refresh-token-test"

    @After
    fun deleteTestPrefs() {
        context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit().clear().commit()
        File(context.filesDir.parentFile, "shared_prefs/$prefsName.xml").delete()
    }

    @Test
    fun aNonRollingRefreshHandsTheStoreNoToken() {
        assertNull(sessionTokenToSave(rollToken = false, serverToken = "rolled"))
        assertEquals("rolled", sessionTokenToSave(rollToken = true, serverToken = "rolled"))
        // 서버가 새 토큰을 주지 않으면 굴리는 갱신이어도 없는 것이다 — 시작할 때 잡아 둔 토큰으로
        // 되돌리면 그 사이 워커가 굴린 토큰을 옛 것으로 덮는다.
        assertNull(sessionTokenToSave(rollToken = true, serverToken = null))
        assertNull(sessionTokenToSave(rollToken = true, serverToken = " "))
    }

    @Test
    fun theStoreKeepsItsTokenOnANonRollingRefreshAndTakesTheNewOneOnARollingOne() {
        val store = AuthSessionStore(context.getSharedPreferences(prefsName, Context.MODE_PRIVATE))
        val user = AuthUser(id = "u1", email = "u1@example.test", plan = "plus")
        val login = store.saveAppSession(AuthTokenResponse(token = "t-login", user = user))
        val generation = store.sessionGeneration()

        // 복귀 때의 갱신 — 서버가 새 토큰을 줬지만 굴리지 않는다. plan 은 새 답으로 바뀐다.
        val kept = store.saveSessionIfAlive(
            expectedGeneration = generation,
            user = user.copy(plan = "free"),
            provider = login.provider,
            rolledToken = sessionTokenToSave(rollToken = false, serverToken = "t-rolled"),
            userFetchedAtMillis = System.currentTimeMillis(),
        )
        assertEquals("t-login", kept?.token)
        assertEquals("t-login", store.read()?.token)
        assertEquals("free", store.read()?.user?.plan)

        // 콜드 스타트의 첫 갱신은 굴린다.
        store.saveSessionIfAlive(
            expectedGeneration = generation,
            user = user,
            provider = login.provider,
            rolledToken = sessionTokenToSave(rollToken = true, serverToken = "t-rolled"),
            userFetchedAtMillis = System.currentTimeMillis(),
        )
        assertEquals("t-rolled", store.read()?.token)
    }

    @Test
    fun refreshAppSessionNowRoutesTheTokenThroughTheRule() {
        val body = bodyOf(authActions, "internal suspend fun MainViewModel.refreshAppSessionNow(")
        assertTrue(
            "refreshAppSessionNow 가 `sessionTokenToSave(rollToken, me.token)` 을 거치지 않는다 — " +
                "복귀 갱신이 토큰을 굴리면 토큰을 키로 쓰는 효과가 전부 다시 돈다.",
            body.contains("rolledToken = sessionTokenToSave(rollToken, me.token)"),
        )
    }

    @Test
    fun onlyTheFirstEntryRefreshRollsTheToken() {
        val start = viewModel.indexOf("AppSignals.appEntries.collect")
        assertTrue("진입 구독(`AppSignals.appEntries.collect`)을 못 찾았다.", start >= 0)
        val block = viewModel.substring(start, minOf(viewModel.length, start + 400))
        assertTrue(
            "진입 구독이 `refreshAppSession(rollToken = firstEntryRefresh)` 로 부르지 않는다.",
            block.contains("refreshAppSession(rollToken = firstEntryRefresh)"),
        )
        assertTrue(
            "진입 구독이 첫 갱신 뒤 `firstEntryRefresh = false` 로 내리지 않는다 — 복귀마다 토큰을 굴린다.",
            block.contains("firstEntryRefresh = false"),
        )
    }

    /**
     * **늦게 온 옛 계정 응답은 아무것도 쓰지 않는다**(순번 가드). 장부 테스트(`PersonalPromoLedgerTest`)는
     * 규칙만 본다 — 여기서는 그 규칙이 **쓰기보다 먼저** 걸려 있는지를 고정한다. 순서가 뒤집히면 옛 답이
     * 세션 plan·프로모 도장을 되돌려, 방금 가족 구독자가 된 사람의 가족 기능이 닫힌다(D9).
     */
    @Test
    fun refreshAppSessionNowClaimsThePlanAnswerBeforeWritingAnything() {
        val body = bodyOf(authActions, "internal suspend fun MainViewModel.refreshAppSessionNow(")
        val claim = body.indexOf("if (!personalPromoLedger.claimPlanAnswer(accountRequest))")
        assertTrue("refreshAppSessionNow 가 plan 답을 `claimPlanAnswer` 로 먼저 잡지 않는다.", claim >= 0)
        val bail = body.indexOf("return@onSuccess", claim)
        val save = body.indexOf("authSessionStore.saveSessionIfAlive(")
        val write = body.indexOf("entitlementWriter.write(")
        val applied = body.indexOf("personalPromoLedger.recordPlanApplied(accountRequest)")
        assertTrue("세션 저장을 못 찾았다 — 이름이 바뀌었으면 이 테스트도 고칠 것.", save >= 0 && write >= 0 && applied >= 0)
        assertTrue("옛 답이면 쓰기 전에 빠져나가야 한다(`return@onSuccess`).", bail in (claim + 1) until save)
        assertTrue("`claimPlanAnswer` 가 세션 저장보다 뒤에 있다.", claim < save && claim < write && claim < applied)
    }

    /** **이 진입의 첫 결과가 실패면 이 진입은 종료 안내를 띄우지 않는다**(D11) — 실패도 적어야 한다. */
    @Test
    fun bothEntryAccountRequestsRecordTheirFailures() {
        for (header in listOf(
            "internal suspend fun MainViewModel.refreshAppSessionNow(",
            "internal fun MainViewModel.checkAccountStatus(",
        )) {
            val body = bodyOf(authActions, header)
            val failure = body.indexOf(".onFailure")
            assertTrue("$header 의 실패 갈래를 못 찾았다.", failure >= 0)
            assertTrue(
                "$header 가 실패를 `recordAccountFailure(accountRequest)` 로 적지 않는다 — 같은 진입의 뒤 성공이 " +
                    "세션 한가운데 종료 안내를 띄운다.",
                body.indexOf("recordAccountFailure(accountRequest)", failure) >= 0,
            )
        }
    }

    /** 로그인·가입 응답도 이 진입의 계정 응답이다(D11 — iOS 와 같다). 실패는 적지 않는다. */
    @Test
    fun signInResponsesAreThisEntrysAccountAnswer() {
        for (header in listOf(
            "internal fun MainViewModel.login(",
            "internal fun MainViewModel.register(",
            "internal fun MainViewModel.finishGoogleLogin(",
        )) {
            val body = bodyOf(authActions, header)
            // 표는 **요청을 보내기 전에** 뜬다 — 도착해서 뜨면 앞 진입의 요청이 이번 진입의 답이 된다(Codex #803).
            val ticket = body.indexOf("val accountRequest = beginAccountRequest()")
            val send = body.indexOf("runCatching {")
            assertTrue("$header 가 요청 전에 표를 뜨지 않는다.", ticket >= 0 && send >= 0 && ticket < send)
            val signedIn = body.indexOf("onSignedIn()")
            assertTrue("$header 에서 `onSignedIn()` 을 못 찾았다.", signedIn >= 0)
            val recorded = body.indexOf("recordSignInAnswer(response.user, accountRequest)")
            assertTrue(
                "$header 가 로그인 응답을 보낼 때 뜬 표로 적지 않는다(`recordSignInAnswer(response.user, accountRequest)`).",
                recorded >= 0,
            )
            // 세션을 올리면 로그인 뒤 계정 조회가 곧바로 뜬다 — 멈추는 `onSignedIn()` 보다 **먼저** 적어야
            // 이 응답이 이번 진입의 첫 결과다(Codex #803).
            assertTrue("$header 가 `onSignedIn()` 뒤에 로그인 응답을 적는다.", recorded < signedIn)
            val failure = body.indexOf(".onFailure")
            assertTrue(
                "$header 가 로그인 **실패**를 계정 결과로 적는다 — 같은 진입의 재시도 성공이 첫 결과여야 한다.",
                failure < 0 || !body.substring(failure).contains("recordAccountFailure"),
            )
        }
    }

    /**
     * **결제 전 조회의 plan 도 `/auth/me` 와 같은 순번으로 가른다**(Codex #803). 안 그러면 먼저 보낸
     * `/auth/me` 가 늦게 도착해 결제 전 조회가 쓴 더 새 plan·프로모를 덮는다.
     */
    @Test
    fun billingPreflightTakesAPlanTicketBeforeItsRequestAndClaimsBeforeWriting() {
        val body = bodyOf(billingActions, "private suspend fun MainViewModel.crossStoreRenewalBlocked(")
        val ticket = body.indexOf("val planRequest = beginAccountRequest()")
        val send = body.indexOf("api.getSubscription(")
        val claim = body.indexOf("personalPromoLedger.claimPlanAnswer(planRequest)")
        val save = body.indexOf("saveSubscriptionSnapshot(ticket, toSave)")
        val applied = body.indexOf("personalPromoLedger.recordPlanApplied(planRequest)")
        assertTrue("결제 전 조회가 요청 전에 plan 표를 뜨지 않는다.", ticket >= 0 && send >= 0 && ticket < send)
        assertTrue("결제 전 조회가 쓰기 전에 plan 순번을 잡지 않는다.", claim > send && save > claim)
        assertTrue("잡은 답만 plan 반영으로 적어야 한다.", applied > save)
        assertTrue(
            "순번을 못 잡은 답은 plan 을 비우고 써야 한다(`fresh.copy(userPlan = null)`).",
            body.contains("if (planClaimed) fresh else fresh.copy(userPlan = null)"),
        )
    }

    // ── 소스 읽기(`SignOutWindowOpensBeforeServerCallTest` 와 같은 방식) ─────────────────

    private val authActions: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModelAuthActions.kt")
    }

    private val billingActions: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModelBillingActions.kt")
    }

    private val viewModel: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModel.kt")
    }

    /** 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로. */
    private fun readSource(path: String): String {
        val file = File(path)
        assertTrue(
            "$path 를 못 찾았다(경로: ${file.absolutePath}). 파일을 옮겼으면 이 테스트의 경로도 같이 고칠 것.",
            file.exists(),
        )
        return file.readText()
    }

    /** [header] 로 시작하는 함수 본문만 잘라 낸다 — 다음 함수 선언 앞까지. */
    private fun bodyOf(source: String, header: String): String {
        val start = source.indexOf(header)
        assertTrue("$header 를 못 찾았다 — 이름이 바뀌었으면 이 테스트도 같이 고칠 것.", start >= 0)
        val rest = source.substring(start + header.length)
        return rest.substring(0, NEXT_DECLARATION.find(rest)?.range?.first ?: rest.length)
    }

    private companion object {
        /** 줄 첫머리의 함수 선언. 주석(`//`)은 이 모양이 아니라 걸리지 않는다. */
        val NEXT_DECLARATION = Regex("""(?m)^[ \t]*(?:internal |private |public )?(?:suspend )?fun\s""")
    }
}
