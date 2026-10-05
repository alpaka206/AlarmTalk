package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.fencedAccountSettings
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthUser
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings
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
 * **계정 설정을 올리기 전에 떠난 `/auth/me` 는 설정을 되돌리지 않는다**(Codex #837).
 *
 * 올리기가 끝나면 '안 올라간 변경' 표시를 내린다. 그 전에 떠난 `/auth/me` 가 **올리기 전의 설정**을 읽어 뒤늦게
 * 오면, 표시가 없으니 받아 적기가 그 옛 값을 이 기기에 적는다 — 방금 고른 지역이 되돌아가고 공휴일 국가도 흔들린다.
 * 그래서 올리기가 끝날 때 이미 떠 있던 요청의 마지막 순번을 울타리로 세우고(`promptSettingsAnswerFence`), 그 이하의
 * 응답은 **설정만** 지금 세션의 값을 지킨다(plan·프로모·토큰은 그 응답의 것).
 *
 * `MainViewModel` 은 단위 테스트에서 세울 수 없어(`EntryRefreshKeepsTokenTest` 와 같은 사정) 값·저장소·배선으로 나눠 본다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PromptSettingsAnswerFenceTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val prefsName = "prompt-settings-fence-test"

    private val seoul = DynamicPromptSettings(
        weather = DynamicPromptWeatherSettings(country = "대한민국", city = "서울", region = "kr-seoul"),
    )
    private val tokyo = DynamicPromptSettings(
        weather = DynamicPromptWeatherSettings(country = "일본", city = "도쿄", region = "jp-tokyo"),
    )

    @After
    fun deleteTestPrefs() {
        context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit().clear().commit()
        File(context.filesDir.parentFile, "shared_prefs/$prefsName.xml").delete()
    }

    @Test
    fun 울타리_이하의_응답은_지금_세션의_설정을_쓴다() {
        // 올리기가 끝날 때 떠 있던 요청(순번 3 이하)은 올리기 전의 설정을 읽었을 수 있다.
        assertEquals(tokyo, fencedAccountSettings(requestSeq = 3, fenceSeq = 3, current = tokyo))
        assertEquals(tokyo, fencedAccountSettings(requestSeq = 1, fenceSeq = 3, current = tokyo))
        // 올리기가 끝난 뒤 보낸 요청은 서버의 지금 값이다 — 응답 그대로.
        assertNull(fencedAccountSettings(requestSeq = 4, fenceSeq = 3, current = tokyo))
        // 올린 적이 없으면(울타리 0) 언제나 응답 그대로.
        assertNull(fencedAccountSettings(requestSeq = 1, fenceSeq = 0, current = tokyo))
    }

    @Test
    fun 저장소는_설정만_덮어_쓰고_나머지는_응답의_것이다() {
        val store = AuthSessionStore(context.getSharedPreferences(prefsName, Context.MODE_PRIVATE))
        val user = AuthUser(id = "u1", email = "u1@example.test", plan = "free", dynamicPromptSettings = tokyo)
        store.saveAppSession(AuthTokenResponse(token = "t", user = user))

        // 옛 설정(서울)을 읽은 응답이지만 plan 은 새 답(plus)이다.
        val saved = store.saveSessionIfAlive(
            expectedGeneration = store.sessionGeneration(),
            user = user.copy(plan = "plus", dynamicPromptSettings = seoul),
            provider = "email",
            rolledToken = null,
            userFetchedAtMillis = System.currentTimeMillis(),
            dynamicPromptSettingsOverride = tokyo,
        )

        assertEquals("jp-tokyo", saved?.user?.dynamicPromptSettings?.weather?.region)
        assertEquals("jp-tokyo", store.read()?.user?.dynamicPromptSettings?.weather?.region)
        assertEquals("plus", store.read()?.user?.plan)
    }

    /**
     * **이름·가족 설정만 고친 저장은 계정 설정을 되쓰지 않는다**(Codex #837 검증). 예전 저장은 요청 **전에** 잡아 둔 세션의
     * 복사본이라, 그 사이 올리기·`/auth/me` 가 적은 새 지역(도쿄)을 옛 지역(서울)으로 되돌렸다 — 그러면 받아 적기가 그
     * 옛 값을 기기와 공휴일 국가에 적는다. 이제 프로필 저장은 저장소가 지금 세션을 같은 락 안에서 읽어 **바꾼 칸만** 얹는다
     * (`updateUserIfAlive` — plan·프로모 등 나머지 칸은 `ProfileSaveKeepsAccountAnswerTest`).
     */
    @Test
    fun 다른_칸만_고친_저장은_저장소의_지금_계정_설정을_지킨다() {
        val store = AuthSessionStore(context.getSharedPreferences(prefsName, Context.MODE_PRIVATE))
        val before = AuthUser(id = "u1", email = "u1@example.test", name = "옛 이름", dynamicPromptSettings = seoul)
        val login = store.saveAppSession(AuthTokenResponse(token = "t", user = before))
        val generation = store.sessionGeneration()
        // 닉네임 PATCH 가 떠 있는 사이 지역 올리기가 끝나 세션이 도쿄가 됐다.
        store.saveSessionIfAlive(
            expectedGeneration = generation,
            user = before.copy(dynamicPromptSettings = tokyo),
            provider = login.provider,
            rolledToken = null,
            userFetchedAtMillis = login.userFetchedAtMillis,
        )

        // 닉네임 응답 — 이름만 바꾼다.
        val renamed = store.updateUserIfAlive(generation, login.user.id) { it.copy(name = "새 이름") }

        assertEquals("새 이름", renamed?.user?.name)
        assertEquals("jp-tokyo", renamed?.user?.dynamicPromptSettings?.weather?.region)
        assertEquals("jp-tokyo", store.read()?.user?.dynamicPromptSettings?.weather?.region)
        // 계정 설정을 실제로 올린 저장은 그 값을 적는다(지키지 않는다).
        val uploaded = store.updateUserIfAlive(generation, login.user.id) { it.copy(dynamicPromptSettings = seoul) }
        assertEquals("kr-seoul", uploaded?.user?.dynamicPromptSettings?.weather?.region)
        assertEquals("kr-seoul", store.read()?.user?.dynamicPromptSettings?.weather?.region)
        assertEquals("새 이름", store.read()?.user?.name)
    }

    @Test
    fun 올리기는_올린_값만_세션에_적는다() {
        val upload = bodyOf("private suspend fun MainViewModel.uploadDynamicPromptSettings(")
        assertTrue(
            "올리기는 올린 값(`updatedSettings`)만 지금 세션 위에 적어야 한다(`saveProfileEdit`).",
            upload.contains(
                "saveProfileEdit(session.user.id, startGeneration) { it.copy(dynamicPromptSettings = updatedSettings) }",
            ),
        )
    }

    @Test
    fun 올리기가_끝나면_표시를_내리기_전에_울타리를_세우고_갱신은_그_울타리를_거친다() {
        val upload = bodyOf("private suspend fun MainViewModel.uploadDynamicPromptSettings(")
        val fence = upload.indexOf("promptSettingsAnswerFence = personalPromoLedger.latestRequestSeq()")
        val pushed = upload.indexOf("dynamicPromptStore.markPushed(")
        assertTrue("올리기가 울타리를 세우지 않는다.", fence >= 0)
        assertTrue("울타리는 표시를 내리기(`markPushed`) 전에 세운다.", pushed > fence)
        // ⚠ 보낸 세션이 그대로일 때만 — 그 사이 다른 계정이 들어왔거나 **같은 계정으로 다시 로그인했으면**(세대가 오른다)
        //   떠 있는 요청은 그 세션의 것이고, 표시도 그 세션의 것이다(Codex #837 11차). 울타리·표시 내리기 **둘 다** 앞에서
        //   막아야 한다 — 예전에는 울타리만 막아, 앞 세션의 응답이 새 세션의 '안 올라간 변경' 표시를 지웠다.
        val guard = upload.indexOf(
            "if (authSession?.user?.id != session.user.id || authSessionStore.sessionGeneration() != startGeneration) {",
        )
        assertTrue("올리기 응답이 보낸 계정·세대를 확인하지 않는다.", guard >= 0)
        assertTrue("세션 확인은 울타리·표시 내리기보다 먼저다.", guard < fence && guard < pushed)
        val guardBody = upload.substring(guard, fence)
        assertTrue("세션이 바뀌었으면 아무것도 적지 않고 돌아간다.", guardBody.contains("return@onSuccess"))
        // 올릴 값은 **차례가 온 뒤의** 밀린 사본이다 — 줄에 설 때의 사본을 올리면 같은 값을 두 번 올리고 다른 기기의
        // 값을 덮는다(Codex #837).
        val snapshot = upload.indexOf("dynamicPromptStore.pendingUploadSnapshot(userId) ?: return")
        val request = upload.indexOf("api.updateProfile(")
        assertTrue("올리기가 차례가 온 뒤 밀린 사본을 다시 보지 않는다.", snapshot in 0 until request)

        val refresh = bodyOf("internal suspend fun MainViewModel.refreshAppSessionNow(")
        assertTrue(
            "refreshAppSessionNow 가 울타리(`fencedAccountSettings`)를 거쳐 저장하지 않는다.",
            refresh.contains("fenceSeq = promptSettingsAnswerFence") &&
                refresh.contains("dynamicPromptSettingsOverride = fencedSettings"),
        )
    }

    private val authActions: String by lazy {
        val file = File("src/main/java/com/alarmtalk/app/ui/main/MainViewModelAuthActions.kt")
        assertTrue("MainViewModelAuthActions.kt 를 못 찾았다(${file.absolutePath}).", file.exists())
        file.readText()
    }

    private fun bodyOf(header: String): String {
        val start = authActions.indexOf(header)
        assertTrue("$header 를 못 찾았다 — 이름이 바뀌었으면 이 테스트도 같이 고칠 것.", start >= 0)
        val rest = authActions.substring(start + header.length)
        return rest.substring(0, NEXT_DECLARATION.find(rest)?.range?.first ?: rest.length)
    }

    private companion object {
        val NEXT_DECLARATION = Regex("""(?m)^[ \t]*(?:internal |private |public )?(?:suspend )?fun\s""")
    }
}
