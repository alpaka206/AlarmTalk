package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AuthUser
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings
import com.alarmtalk.app.network.FamilyAlarmQuietWindow
import com.alarmtalk.app.network.PersonalPromo
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * **프로필 저장은 plan 답이 아니다 — 바꾼 칸만 지금 세션 위에 얹는다**(2026-10-05,
 * `docs/spec/session-and-auth.md` 「프로필 저장은 바꾼 칸만 세션에 적는다」).
 *
 * 예전 프로필 저장(닉네임·가족 알람 설정·계정 설정 올리기)은 요청 **전에** 잡은 세션의 사본을 통째로 저장했다. 그 사이
 * `/auth/me`(쿠폰·초대 등록 뒤의 갱신, `plan_changed`, 복귀 갱신)가 plan·프로모·받은 시각을 새로 적으면 그 답을 다음
 * `/auth/me` 까지 되돌렸다 — 판정 스냅샷은 그대로여도 세션 plan 을 직접 읽는 편집기(`freeVoiceTier`)·목소리 관리
 * (`paidVoiceAccess`)가 방금 가족이 된 사람을 무료로 그렸다. 다른 기기에서 바꾼 이름·가족 설정도 같은 길로 되돌아갔다.
 *
 * `MainViewModel` 은 단위 테스트에서 세울 수 없어(`EntryRefreshKeepsTokenTest` 와 같은 사정) 저장소·장부·배선으로 나눠 본다.
 * 저장소 테스트의 저장 단계는 [profileSave] 하나로 모았다 — 뷰모델이 부르는 길(`saveProfileEdit` →
 * `AuthSessionStore.updateUserIfAlive`)과 같다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ProfileSaveKeepsAccountAnswerTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val prefsNames = mutableListOf<String>()

    private val promo = PersonalPromo(endsAt = "2026-10-31T15:00:00Z", noticeFrom = "2026-10-24T15:00:00Z")
    private val seoul = DynamicPromptSettings(
        weather = DynamicPromptWeatherSettings(country = "대한민국", city = "서울", region = "kr-seoul"),
    )
    private val tokyo = DynamicPromptSettings(
        weather = DynamicPromptWeatherSettings(country = "일본", city = "도쿄", region = "jp-tokyo"),
    )

    @After
    fun deleteTestPrefs() {
        prefsNames.forEach { name ->
            context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit()
            File(context.filesDir.parentFile, "shared_prefs/$name.xml").delete()
        }
    }

    private fun store(name: String = "profile-save-keeps-plan-test"): AuthSessionStore {
        prefsNames += name
        return AuthSessionStore(context.getSharedPreferences(name, Context.MODE_PRIVATE))
    }

    /** 무료 세션(받은 시각 1000, 토큰 t1) — 프로필 저장 요청을 보낼 때의 세션(뷰모델의 `authSession`)이다. */
    private fun signInFree(store: AuthSessionStore): AuthSession =
        store.save(
            AuthSession(
                token = "t1",
                provider = AuthSessionStore.PROVIDER_APP,
                user = AuthUser(
                    id = "u1",
                    email = "u1@example.test",
                    name = "옛 이름",
                    plan = "free",
                    dynamicPromptSettings = seoul,
                ),
                userFetchedAtMillis = 1_000L,
            ),
        )

    /** 요청이 도는 사이 도착한 `/auth/me`(`refreshAppSessionNow` 의 저장) — plan·프로모·받은 시각과 굴린 토큰을 적는다. */
    private fun meArrives(store: AuthSessionStore, user: AuthUser, token: String = "t2", receivedAt: Long = 2_000L) {
        checkNotNull(
            store.saveSessionIfAlive(
                expectedGeneration = store.sessionGeneration(),
                user = user,
                provider = AuthSessionStore.PROVIDER_APP,
                rolledToken = token,
                userFetchedAtMillis = receivedAt,
            ),
        )
    }

    /** 프로필 저장 성공 뒤의 세션 쓰기 — `saveProfileEdit` 와 같은 길이다. [sent] 는 요청을 보낼 때의 세션이다. */
    private fun profileSave(
        store: AuthSessionStore,
        sent: AuthSession,
        generation: Long,
        change: (AuthUser) -> AuthUser,
    ): AuthSession? = store.updateUserIfAlive(generation, sent.user.id, change)

    @Test
    fun 닉네임_저장은_그_사이_받은_plan_프로모_받은_시각_토큰을_되돌리지_않는다() {
        val store = store()
        val sent = signInFree(store)
        val generation = store.sessionGeneration()
        // 닉네임 PATCH 가 떠 있는 사이 쿠폰 등록 뒤의 갱신이 plus + 개인 프로모를 적고 토큰을 굴렸다.
        meArrives(store, sent.user.copy(plan = "plus", personalPromo = promo))

        val saved = profileSave(store, sent, generation) { it.copy(name = "새 이름") }

        val stored = checkNotNull(store.read())
        assertEquals("새 이름", stored.user.name)
        assertEquals("요청 전의 무료 사본이 plus 를 되돌렸다", "plus", stored.user.plan)
        assertEquals("요청 전의 사본이 개인 프로모를 지웠다", promo, stored.user.personalPromo)
        assertEquals("받은 시각이 옛 답의 것으로 돌아갔다 — plan·프로모와 한 벌이어야 한다", 2_000L, stored.userFetchedAtMillis)
        assertEquals("그 사이 굴린 토큰을 옛 것으로 덮었다(Codex #665 P2)", "t2", stored.token)
        // 메모리에 올릴 값(`authSession = saved`)도 저장본과 같다 — 관찰 경로와 갈라지지 않는다.
        assertEquals(stored, saved)
    }

    @Test
    fun 가족_설정_저장은_그_사이_받은_가족_plan과_다른_기기의_이름을_되돌리지_않는다() {
        val store = store()
        val sent = signInFree(store)
        val generation = store.sessionGeneration()
        // 초대 코드 등록 직후 — 그 갱신이 가족 plan 과 다른 기기에서 바꾼 이름을 적었다.
        meArrives(store, sent.user.copy(plan = "family", name = "다른 기기 이름"))

        val windows = listOf(FamilyAlarmQuietWindow(days = listOf(1, 2, 3), start = "22:00", end = "07:00"))
        profileSave(store, sent, generation) { user ->
            user.copy(
                allowFamilyAlarms = true,
                familyAlarmQuietDays = windows.first().days,
                familyAlarmQuietStart = windows.first().start,
                familyAlarmQuietEnd = windows.first().end,
                familyAlarmQuietWindows = windows,
            )
        }

        val stored = checkNotNull(store.read())
        assertTrue(stored.user.allowFamilyAlarms)
        assertEquals(windows, stored.user.familyAlarmQuietWindows)
        assertEquals("방금 가족이 된 사람이 무료로 돌아갔다", "family", stored.user.plan)
        assertEquals("다른 기기에서 바꾼 이름을 되돌렸다", "다른 기기 이름", stored.user.name)
        assertEquals(2_000L, stored.userFetchedAtMillis)
    }

    @Test
    fun 계정_설정_올리기는_올린_값만_적고_그_사이_받은_plan_프로모는_지킨다() {
        val store = store()
        val sent = signInFree(store)
        val generation = store.sessionGeneration()
        meArrives(store, sent.user.copy(plan = "plus", personalPromo = promo))

        profileSave(store, sent, generation) { it.copy(dynamicPromptSettings = tokyo) }

        val stored = checkNotNull(store.read())
        assertEquals("jp-tokyo", stored.user.dynamicPromptSettings.weather.region)
        assertEquals("plus", stored.user.plan)
        assertEquals(promo, stored.user.personalPromo)
        assertEquals(2_000L, stored.userFetchedAtMillis)
    }

    /**
     * plan·프로모는 plan 답에서만 온다 — 저장소가 스스로 지킨다. 부르는 쪽이 실수로 요청 전 사본을 돌려줘도(예전 저장의
     * 모양) plan·프로모·받은 시각은 저장소의 짝 그대로다.
     */
    @Test
    fun 바꾼_칸이_무엇이든_plan_프로모는_저장소의_짝이다() {
        val store = store()
        val sent = signInFree(store)
        meArrives(store, sent.user.copy(plan = "plus", personalPromo = promo))

        store.updateUserIfAlive(store.sessionGeneration(), sent.user.id) { sent.user.copy(name = "새 이름") }

        val stored = checkNotNull(store.read())
        assertEquals("새 이름", stored.user.name)
        assertEquals("plus", stored.user.plan)
        assertEquals(promo, stored.user.personalPromo)
        assertEquals(2_000L, stored.userFetchedAtMillis)
    }

    @Test
    fun 세션이_끝났거나_다른_계정이면_아무것도_쓰지_않는다() {
        val store = store()
        val sent = signInFree(store)
        val generation = store.sessionGeneration()

        // 다른 계정의 세션에는 쓰지 않는다(잡종 세션 — Codex #665 P1).
        assertNull(store.updateUserIfAlive(generation, "someone-else") { it.copy(name = "남의 이름") })
        assertEquals("옛 이름", store.read()?.user?.name)

        // 로그아웃 → 같은 계정 재로그인: 세대가 올라 앞 세션의 저장은 버린다.
        store.clear()
        signInFree(store)
        assertNull(profileSave(store, sent, generation) { it.copy(name = "새 이름") })
        assertEquals("옛 이름", store.read()?.user?.name)

        // 로그아웃 상태에 세션을 되살리지 않는다.
        store.clear()
        assertNull(profileSave(store, sent, store.sessionGeneration()) { it.copy(name = "새 이름") })
        assertNull(store.read())
    }

    /**
     * **저장 전에 떠난 `/auth/me` 가 늦게 와도 확인 조회가 새 값을 남긴다.** 그 옛 답은 옛 이름을 싣고 있고 순번으로는
     * 밀린 답이 아니라 그대로 적힌다 — 그래서 저장이 끝나면 확인 조회를 한 번 더 한다(`refreshAppSession(rollToken = false)`).
     * 확인 조회가 먼저 오면 옛 답이 순번(`claimPlanAnswer`)에 밀려 버려지고, 늦게 오면 확인 조회가 덮는다.
     */
    @Test
    fun 저장_전에_떠난_조회가_늦게_와도_확인_조회가_새_이름을_남긴다() {
        for (confirmFirst in listOf(true, false)) {
            val store = store("profile-save-confirm-$confirmFirst")
            val ledger = PersonalPromoLedger(currentEntry = { 1L })
            val sent = signInFree(store)
            // `refreshAppSessionNow` 의 쓰기 순서 — 순번을 먼저 잡고, 밀렸으면 쓰지 않는다.
            fun answer(request: AccountRequest, user: AuthUser) {
                if (ledger.claimPlanAnswer(request)) meArrives(store, user)
            }

            val entryRefresh = ledger.beginAccountRequest() // 옛 이름을 읽은 진입 갱신
            profileSave(store, sent, store.sessionGeneration()) { it.copy(name = "새 이름") }
            val confirm = ledger.beginAccountRequest() // 저장 뒤의 확인 조회
            val server = sent.user.copy(name = "새 이름")
            if (confirmFirst) {
                answer(confirm, server)
                answer(entryRefresh, sent.user)
            } else {
                answer(entryRefresh, sent.user)
                answer(confirm, server)
            }

            assertEquals("확인 조회가 먼저 왔나: $confirmFirst", "새 이름", store.read()?.user?.name)
        }
    }

    // ── 배선 ────────────────────────────────────────────────────────────

    /**
     * 사본 저장을 잡는 감시가 **옛 모양을 실제로 잡는지** 먼저 본다. 글자 그대로(`contains("session.copy(user")`) 찾으면
     * 공백·줄바꿈이 다른 모양을 놓친다 — 예전 `updateFamilyAlarmSettings` 는 `session.copy(` 뒤에 줄을 바꿔
     * `user = session.user.copy(` 를 쓰는 여러 줄 모양이라, 감시가 그 경로에서 아무것도 지키지 않았다(2026-10-05 리뷰).
     */
    @Test
    fun 사본_저장_감시는_한_줄과_여러_줄_모양을_모두_잡는다() {
        val oldShapes = listOf(
            // 예전 updateNickname·uploadDynamicPromptSettings — 한 줄
            "val updated = session.copy(user = session.user.copy(name = trimmed))",
            // 예전 updateFamilyAlarmSettings — 여러 줄
            "val updated = session.copy(\n                user = session.user.copy(\n                    allowFamilyAlarms = allowFamilyAlarms,",
            // 점 앞뒤로 줄을 바꾼 모양
            "val updated = session\n    .copy(\n        user = session.user,\n    )",
        )
        for (shape in oldShapes) {
            assertTrue("감시가 옛 사본 저장 모양을 못 잡는다:\n$shape", SESSION_COPY_SAVE.containsMatchIn(shape))
        }
        // 지금 모양(바꾼 칸만 얹기)은 걸리지 않는다.
        assertFalse(SESSION_COPY_SAVE.containsMatchIn("saveProfileEdit(session.user.id, startGeneration) { it.copy(name = trimmed) }"))
    }

    @Test
    fun 프로필_저장_세_곳은_바꾼_칸만_지금_세션_위에_적는다() {
        for (header in PROFILE_SAVES) {
            val body = bodyOf(header)
            assertFalse(
                "$header 가 요청 전 세션 사본을 통째로 저장한다 — 그 사이 받은 plan·프로모·받은 시각을 되돌린다.",
                SESSION_COPY_SAVE.containsMatchIn(body),
            )
            assertTrue(
                "$header 가 `saveProfileEdit(session.user.id, startGeneration)` 로 바꾼 칸만 적지 않는다.",
                body.contains("saveProfileEdit(session.user.id, startGeneration)"),
            )
        }
        val helper = bodyOf("internal fun MainViewModel.saveProfileEdit(")
        assertTrue(
            "saveProfileEdit 가 저장소의 `updateUserIfAlive` 를 거치지 않는다 — 지금 세션을 같은 락 안에서 읽어야 한다.",
            helper.contains("authSessionStore.updateUserIfAlive("),
        )
    }

    @Test
    fun 프로필_저장이_끝나면_토큰을_굴리지_않는_확인_조회를_한다() {
        for (header in PROFILE_SAVES) {
            val body = bodyOf(header)
            val save = body.indexOf("saveProfileEdit(")
            val confirm = maxOf(
                body.indexOf("refreshAppSession(rollToken = false)"),
                body.indexOf("refreshAppSessionNow(rollToken = false)"),
            )
            assertTrue("$header 의 저장을 못 찾았다.", save >= 0)
            assertTrue(
                "$header 가 저장 뒤에 확인 조회(`rollToken = false`)를 하지 않는다 — 저장 전에 떠난 `/auth/me` 가 " +
                    "되돌린 칸이 다음 조회까지 남는다.",
                confirm > save,
            )
        }
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

        /** 요청 전 세션 사본을 통째로 저장하는 모양 — `session.copy(user = …)`. 공백·줄바꿈이 어디 끼어도 잡는다. */
        val SESSION_COPY_SAVE = Regex("""\bsession\s*\.\s*copy\s*\(\s*user\b""")
        val PROFILE_SAVES = listOf(
            "internal fun MainViewModel.updateNickname(",
            "internal fun MainViewModel.updateFamilyAlarmSettings(",
            "private suspend fun MainViewModel.uploadDynamicPromptSettings(",
        )
    }
}
