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

    // ── 소스 읽기(`SignOutWindowOpensBeforeServerCallTest` 와 같은 방식) ─────────────────

    private val authActions: String by lazy {
        readSource("src/main/java/com/alarmtalk/app/ui/main/MainViewModelAuthActions.kt")
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
