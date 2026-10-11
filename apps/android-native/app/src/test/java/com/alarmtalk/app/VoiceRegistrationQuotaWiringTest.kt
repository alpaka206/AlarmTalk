package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **`생성 가능 n/m회` 는 서버에서 다시 읽는다** — 스펙 voice-and-message §4-1 「월 등록 한도」 ②.
 *
 * 2026-10-10 prod(1.2.10): 이미 이번 달 등록을 마친 유료 사용자가 **같은 프로세스에서** 초안을 또
 * 만들 수 있었고, 그 초안의 저장이 429 로 일곱 번 거절됐다(ALARMTALK-ANDROID-Q). 숫자를 읽는 곳이
 * 목록 조회와 초안 생성 성공 둘뿐이어서, 등록을 확정한 뒤에도 `1/1` 이 프로세스가 끝날 때까지 남아
 * `추가` 가 눌렸다. 같은 낡은 숫자가 삭제 경고("이번 달에는 새 목소리를 만들 수 없어요")도 껐다.
 *
 * `MainViewModel` 은 암호화 저장소·Room·워커를 물고 있어 단위 테스트에서 세울 수 없다 — 다시 읽는
 * 자리가 **거기 있는가**는 소스로 본다(`StockClipManifestWiringTest` 와 같은 방식). ⚠ 등록 뒤 숫자가
 * 실제로 `0/1` 이 되는지는 실기기로만 보인다(스펙 「검증 방법」).
 */
class VoiceRegistrationQuotaWiringTest {

    @Test
    fun aConfirmedRegistrationReloadsTheQuota() {
        val promote = functionBody(voiceActions, "internal fun MainViewModel.promoteVoiceDraft(")
        val failureBranch = promote.indexOf("val error = result.exceptionOrNull()")
        assertTrue("저장의 실패 갈래를 못 찾았다.", failureBranch > 0)
        val success = promote.substring(promote.indexOf("if (profile != null) {"), failureBranch)
        assertTrue(
            "등록을 확정하고도 '생성 가능 n/m회' 를 다시 읽지 않는다 — `추가` 가 켜진 채 남고 삭제 경고가 빠진다.",
            success.contains("loadVoiceDraftQuota()"),
        )
        // 교체 정리가 실패한 갈래(`cascadeFailed`)도 등록은 확정된 것이다 — 두 갈래 **뒤에서** 읽는다.
        assertTrue(
            "교체 정리 갈래 안에서만 읽는다 — 한쪽 갈래에서는 숫자가 낡는다.",
            success.lastIndexOf("loadVoiceDraftQuota()") > success.lastIndexOf("voiceProfiles = listOf(official)"),
        )
    }

    @Test
    fun enteringTheVoicesTabReloadsTheQuotaEvenWhenTheListIsFresh() {
        val preload = functionBody(voiceActions, "internal fun MainViewModel.preloadVoiceProfiles(")
        val fresh = functionBody(preload, "if (voiceProfilesLoadedFresh)")
        assertTrue(
            "목록이 이미 신선하면 숫자도 안 읽고 돌아간다 — 다른 기기의 등록·달이 바뀐 것을 프로세스가 " +
                "끝날 때까지 모른다.",
            fresh.contains("loadVoiceDraftQuota()"),
        )
        // 신선하지 않을 때는 목록 조회가 숫자를 함께 묻는다 — 거기서 또 부르면 같은 요청이 두 번 나간다.
        val fetch = functionBody(voiceActions, "internal fun MainViewModel.fetchVoiceProfiles(")
        assertTrue(fetch.contains("api.getVoiceDraftQuota(authorization)"))
        assertEquals(
            "신선 갈래 밖에서도 숫자를 따로 읽는다 — 목록 조회와 겹친다.",
            1,
            Regex("""loadVoiceDraftQuota\(\)""").findAll(preload).count(),
        )
        // 그 갈래를 부르는 자리가 목소리 탭 진입이다(탭 갱신의 60초 창).
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        val voicesTab = app.substring(app.indexOf("NativeTab.Voices -> {"))
        assertTrue(voicesTab.substring(0, 400).contains("viewModel.preloadVoiceProfiles()"))
        assertTrue(app.contains("val tabRefreshThrottleMs = 60_000L"))
    }

    @Test
    fun aMonthlyLimitRejectionReloadsTheQuotaAtBothSteps() {
        // 서버가 방금 "0" 이라고 말했다 — 화면의 숫자가 틀렸다는 뜻이다. 등록 단계든 저장 단계든.
        val create = functionBody(voiceActions, "internal fun MainViewModel.createVoiceProfiles(")
        val createFailure = create.substring(create.indexOf(".onFailure { error ->"))
        assertTrue(
            "등록이 월 한도로 거절돼도 숫자를 다시 읽지 않는다.",
            Regex("""if \(createErrorCode == VOICE_MONTHLY_LIMIT_ERROR_CODE\) \{\s*loadVoiceDraftQuota\(\)""")
                .containsMatchIn(createFailure),
        )
        val promote = functionBody(voiceActions, "internal fun MainViewModel.promoteVoiceDraft(")
        val promoteFailure = promote.substring(promote.indexOf("val error = result.exceptionOrNull()"))
        assertTrue(
            "저장이 월 한도로 거절돼도 숫자를 다시 읽지 않는다.",
            promoteFailure.contains("if (promoteErrorCode == VOICE_MONTHLY_LIMIT_ERROR_CODE) loadVoiceDraftQuota()"),
        )
    }

    @Test
    fun theQuotaIsReadFromTheServerNeverDecrementedLocally() {
        // ⚠ 앱에서 `n − 1` 로 깎아 두지 않는다 — 원장의 예약은 확정이 실패하면 롤백되고, 다른 기기도
        // 같은 원장을 쓴다. `voiceDraftQuota` 에 쓰는 것은 **서버 응답**과 세션 정리(null)뿐이어야 한다.
        val writes = viewModelSources.flatMap { (path, code) ->
            Regex("""\bvoiceDraftQuota\s*=\s*([^\n]+)""").findAll(code).map { "$path: ${it.groupValues[1].trim()}" }.toList()
        }
        assertEquals(
            "`voiceDraftQuota` 를 쓰는 자리가 달라졌다 — 서버 응답이 아닌 값을 싣는지 볼 것. 서버 답은 " +
                "`applyVoiceDraftQuota` 한 곳에서만 싣는다(두 읽는 자리가 같은 문을 지난다).",
            listOf(
                "MainViewModel.kt: null",
                "MainViewModelVoiceActions.kt: quota",
            ),
            writes.sorted(),
        )
        assertFalse(voiceActions.contains("registrationRemaining - 1"))
        assertFalse(voiceActions.contains("registrationRemaining.minus"))
    }

    @Test
    fun aLateAnswerIsDroppedUnlessItBelongsToTheRequester() {
        // 읽는 자리가 늘면 계정 전환 틈도 넓어진다 — 로그아웃·전환 뒤에 도착한 앞 계정의 답이 지금
        // 계정의 `추가` 버튼을 끄거나(0) 다 쓴 계정에 켜 준다. 목록 조회와 같은 가드를 쓴다.
        val load = functionBody(voiceActions, "internal fun MainViewModel.loadVoiceDraftQuota(")
        val owner = load.indexOf("val requestOwner = session.user.id")
        val generation = load.indexOf("val startGeneration = authSessionStore.sessionGeneration()")
        val request = load.indexOf("api.getVoiceDraftQuota(")
        val guarded = load.indexOf("applyVoiceDraftQuota(quota, requestSeq, requestOwner, startGeneration)")
        assertTrue("요청한 계정·세대를 **요청 전에** 적지 않는다.", owner in 0 until request && generation in 0 until request)
        assertTrue("늦게 온 답을 가드 없이 적는다.", guarded > request)
        assertFalse("가드를 거치지 않는 쓰기가 남아 있다.", Regex("""\bvoiceDraftQuota\s*=""").containsMatchIn(load))
        // 목록 조회 쪽의 답도 같은 문을 지난다(예전에는 거기에 같은 가드를 따로 썼다).
        val fetch = functionBody(voiceActions, "internal fun MainViewModel.fetchVoiceProfiles(")
        assertTrue(fetch.contains("applyVoiceDraftQuota(quota, quotaRequestSeq, requestOwner, startGeneration)"))
        assertFalse(Regex("""\bvoiceDraftQuota\s*=""").containsMatchIn(fetch))
        // 그 문이 계정·세션을 본다.
        val apply = functionBody(voiceActions, "private fun MainViewModel.applyVoiceDraftQuota(")
        val belongs = apply.indexOf("if (!responseStillBelongsToRequester(requestOwner, startGeneration)) return")
        assertTrue("싣는 문이 계정·세션을 보지 않는다.", belongs in 0 until apply.indexOf("voiceDraftQuota = quota"))
    }

    @Test
    fun anOlderAnswerNeverOverwritesANewerOne() {
        // 2026-10-11 리뷰: 읽는 자리가 여럿이라 답이 낸 순서대로 오지 않는다. 초안을 만든 직후의 조회(Q0)가 느리고,
        // 그사이 미리듣기를 끝까지 듣고 저장한 직후의 조회(Q2)가 `0` 을 먼저 가져오면, 늦게 온 Q0 의 `1` 이 그 위에 앉아
        // `추가` 가 다시 켜지고 삭제 경고가 빠진다 — 이번 수정이 없애려는 바로 그 낡은 숫자다. 계정·세션 가드는 둘을 다
        // 통과시킨다(같은 계정·같은 세션의 답이다). 그래서 **가장 나중에 낸 요청의 답만** 싣는다.
        val viewModel = withoutLineComments(readSource("ui/main/MainViewModel.kt"))
        assertTrue("한도 요청의 번호가 없다.", viewModel.contains("internal var voiceDraftQuotaRequestSeq = 0L"))

        // 번호는 한 곳에서만 오른다 — 되감거나 다른 곳에서 바꾸면 떠 있던 옛 요청의 번호가 새 요청의 번호와 같아질 수 있다.
        val bumps = viewModelSources.flatMap { (path, code) ->
            Regex("""\bvoiceDraftQuotaRequestSeq\s*(\+=|-=|=(?!=))[^\n]*""").findAll(code)
                .map { "$path: ${it.value.trim()}" }.toList()
        }
        assertEquals(
            listOf(
                "MainViewModel.kt: voiceDraftQuotaRequestSeq = 0L",
                "MainViewModelVoiceActions.kt: voiceDraftQuotaRequestSeq += 1",
            ),
            bumps.sorted(),
        )
        assertTrue(
            functionBody(voiceActions, "private fun MainViewModel.nextVoiceDraftQuotaRequest(")
                .contains("voiceDraftQuotaRequestSeq += 1"),
        )

        // 싣는 문: 가장 나중에 낸 요청의 답일 때만 싣는다. 서버 답을 쓰는 곳은 여기 하나다.
        val apply = functionBody(voiceActions, "private fun MainViewModel.applyVoiceDraftQuota(")
        val newest = apply.indexOf("if (requestSeq != voiceDraftQuotaRequestSeq) return")
        assertTrue(
            "가장 나중 요청의 답인지 보지 않고 싣는다 — 늦게 온 옛 답이 새 답을 덮는다.",
            newest in 0 until apply.indexOf("voiceDraftQuota = quota"),
        )
        assertEquals(1, Regex("""\bvoiceDraftQuota\s*=""").findAll(apply).count())

        // 두 읽는 자리 모두 **요청을 내기 전에** 번호를 뽑고, 그 번호로 싣는다.
        val load = functionBody(voiceActions, "internal fun MainViewModel.loadVoiceDraftQuota(")
        val loadSeq = load.indexOf("val requestSeq = nextVoiceDraftQuotaRequest()")
        assertTrue(
            "탭 진입·초안 생성·확정·거절 뒤의 조회가 요청 전에 번호를 뽑지 않는다.",
            loadSeq in 0 until load.indexOf("api.getVoiceDraftQuota("),
        )
        val fetch = functionBody(voiceActions, "internal fun MainViewModel.fetchVoiceProfiles(")
        val fetchSeq = fetch.indexOf("val quotaRequestSeq = nextVoiceDraftQuotaRequest()")
        assertTrue(
            "목록 조회와 함께 내는 한도 요청이 요청 전에 번호를 뽑지 않는다.",
            fetchSeq in 0 until fetch.indexOf("api.getVoiceDraftQuota(authorization)"),
        )
        // ⚠ 번호는 **요청을 실제로 내는 자리에서** 뽑는다. 목록 조회는 busy 면 아무것도 내지 않고 돌아가는데, 그 전에
        // 뽑으면 떠 있던 다른 조회의 답만 버리고 대신할 답은 없다.
        assertTrue(
            "목록 조회가 busy 로 돌아가기 전에 번호를 뽑는다.",
            fetchSeq > fetch.indexOf("if (voiceProfileBusy) return@launch"),
        )
    }

    @Test
    fun theAddButtonAndTheDeleteWarningReadTheSameNumberWithTheSameRule() {
        // 이 숫자 하나가 두 곳을 연다 — 낡으면 둘 다 틀린다. 두 곳이 같은 판정 함수를 쓴다.
        val panel = withoutLineComments(readSource("ui/voices/VoiceProfileManagementPanel.kt"))
        assertTrue(panel.contains("val monthlyExhausted = monthlyRegistrationUsedUp(monthlyQuota)"))
        assertTrue(panel.contains("enabled = !voiceProfileBusy && !monthlyExhausted"))
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        assertTrue(app.contains("voiceDraftQuotaExhausted = monthlyRegistrationUsedUp(viewModel.voiceDraftQuota)"))
        assertTrue(app.contains("voiceDraftQuota = viewModel.voiceDraftQuota"))
    }

    private val voiceActions: String by lazy { withoutLineComments(readSource("ui/main/MainViewModelVoiceActions.kt")) }

    private val viewModelSources: List<Pair<String, String>> by lazy {
        java.io.File("src/main/java/com/alarmtalk/app/ui/main").listFiles { file -> file.name.startsWith("MainViewModel") }!!
            .sortedBy { it.name }
            .map { it.name to withoutLineComments(it.readText()) }
    }
}
