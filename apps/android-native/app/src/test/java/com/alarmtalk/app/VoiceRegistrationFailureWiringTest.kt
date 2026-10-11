package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.apiErrorMessage
import com.google.gson.JsonParser
import java.io.File
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **등록 창이 열려 있는 동안의 거절은 그 창 안에서 말한다** — 스펙 voice-and-message §4-1 「월 등록 한도」 ③.
 *
 * 등록 창은 화면을 다 덮는 자기 창(`Dialog`)이고, 앱 본체의 스낵바는 그 **뒤**에 그려진다. 1.2.10 은
 * 등록·저장·다시 만들기의 실패를 전부 `MainViewModel.message`(스낵바)에만 썼다 — 2026-10-10 prod 의
 * 사용자는 월 한도로 거절된 같은 저장을 일곱 번 눌렀다. 등록 단계는 더 나빴다: '만드는 중' 으로
 * 넘어가며 녹음을 먼저 놓아, 실패하면 꺼진 `등록` 버튼과 보이지 않는 문구만 남았다.
 *
 * 말소리 없는 녹음(`VOICE_CLONE_NO_SPEECH`, 2026-10-11)은 창 안에서 **처음 단계로** 돌아간다 — 녹음을 버리고 녹음 카드
 * 아래에 이유를 쓴다(흐름도 횟수도 그대로다).
 *
 * 어디에 말할지의 판정은 순수 함수(`registrationFailureSurface` — `VoicePreviewConfirmRulesTest`)가
 * 지키고, 여기서는 그 판정이 **실제로 쓰이는가**를 소스로 본다. `MainViewModel` 도 이 화면도 단위
 * 테스트에서 세울 수 없다(`StockClipManifestWiringTest` 와 같은 사정). ⚠ 문구가 정말 보이는지, 스낵바가
 * 정말 가려지는지는 실기기로만 보인다(스펙 「검증 방법」).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceRegistrationFailureWiringTest {

    // ── 뷰모델 — 거절을 보이는 곳에 올린다 ────────────────────────────────

    @Test
    fun theThreeRegistrationFailuresGoThroughTheSurfaceRule() {
        val create = functionBody(voiceActions, "internal fun MainViewModel.createVoiceProfiles(")
        val createFailure = create.substring(create.indexOf(".onFailure { error ->"))
        assertTrue(
            "등록 실패가 다시 스낵바로만 간다 — 등록 창 뒤에 가려진다.",
            createFailure.contains("showVoiceRegistrationFailure(createErrorCode, failureText)"),
        )
        assertFalse(createFailure.contains("message = when (createErrorCode)"))

        val promote = functionBody(voiceActions, "internal fun MainViewModel.promoteVoiceDraft(")
        val promoteFailure = promote.substring(promote.indexOf("val error = result.exceptionOrNull()"))
        assertTrue(
            "저장 실패가 다시 스낵바로만 간다 — 등록 창 뒤에 가려진다.",
            promoteFailure.contains("showVoiceRegistrationFailure(promoteErrorCode, failureText)"),
        )
        assertFalse(promoteFailure.contains("message = when (promoteErrorCode)"))

        val delete = functionBody(voiceActions, "internal fun MainViewModel.deleteVoiceDraft(")
        assertTrue(
            "`다시 만들기`(초안 삭제)의 실패가 등록 창 안으로 가지 않는다.",
            delete.contains("showVoiceRegistrationFailure("),
        )
        assertFalse("초안 삭제의 실패를 스낵바에 곧바로 쓴다.", Regex("""\bmessage\s*=""").containsMatchIn(delete))
    }

    @Test
    fun theMonthlyLimitDiscardOfTheDraftIsQuiet() {
        // 월 한도로 흐름을 끝내며 등록 창이 치우는 초안 삭제는 사용자가 고른 삭제가 아니다. 그 삭제가 실패해 월 한도 알럿
        // 뒤에 '목소리 삭제에 실패했어요' 가 뜨면, 등록된 목소리를 못 지운 것처럼 읽힌다(2026-10-11 리뷰). 흐름은 삭제가
        // 실패해도 끝나고 남은 초안은 서버가 거둔다(스펙 §4-1 ③) — iOS 도 그 실패를 버린다(`try?`).
        val delete = functionBody(voiceActions, "internal fun MainViewModel.deleteVoiceDraft(")
        assertTrue(
            "사용자가 누른 삭제의 기본값이 바뀌었다 — `다시 만들기`·나가기 경고의 실패가 안 보인다.",
            delete.startsWith("internal fun MainViewModel.deleteVoiceDraft(profileId: String, surfaceFailure: Boolean = true)"),
        )
        val failure = delete.substring(delete.indexOf(".onFailure { error ->"))
        val logged = failure.indexOf("AlarmTalkLog.reportError(")
        val quiet = failure.indexOf("if (!surfaceFailure) return@onFailure")
        val surfaced = failure.indexOf("showVoiceRegistrationFailure(")
        assertTrue("조용한 삭제의 실패를 화면에 말한다 — 말하기 전에 빠지는 갈래가 없다.", quiet in 0 until surfaced)
        assertTrue("조용한 삭제도 실패를 기록은 해야 한다 — 기록이 조용한 갈래보다 앞에 있어야 한다.", logged in 0 until quiet)

        // 등록 창: 월 한도 갈래만 조용한 길을 쓴다. 사용자가 누른 두 삭제는 예전 길 그대로다.
        val effect = functionBody(panel, "LaunchedEffect(voiceRegistrationFailure)")
        val endFlow = surfaceBranch(effect, "EndFlow")
        assertTrue("월 한도 갈래가 초안을 조용히 버리지 않는다.", endFlow.contains("onDiscardVoiceDraftQuietly(draftId)"))
        assertFalse("월 한도 갈래가 사용자 삭제 길로 초안을 버린다.", endFlow.contains("onDeleteVoiceDraft("))
        assertEquals(
            "조용한 길을 쓰는 자리가 월 한도 갈래 말고도 있다.",
            1,
            Regex("""onDiscardVoiceDraftQuietly\(""").findAll(panel).count(),
        )
        assertTrue(panel.contains("onClick = { confirmNewVoice?.let { onDeleteVoiceDraft(it.id) } }"))
        assertTrue(functionBody(panel, "if (draftExitWarningOpen)").contains("exitDraftId?.let(onDeleteVoiceDraft)"))

        // 앱이 조용한 길을 뷰모델의 조용한 삭제에 잇고, 목록 화면이 패널에 그대로 넘긴다.
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        assertTrue(app.contains("onDeleteVoiceDraft = viewModel::deleteVoiceDraft,"))
        assertTrue(
            app.contains("onDiscardVoiceDraftQuietly = { draftId -> viewModel.deleteVoiceDraft(draftId, surfaceFailure = false) }"),
        )
        val list = withoutLineComments(readSource("ui/alarms/AlarmListScreen.kt"))
        assertTrue(list.contains("onDiscardVoiceDraftQuietly = onDiscardVoiceDraftQuietly,"))
    }

    @Test
    fun theSurfaceRuleDecidesBetweenTheWindowAndTheSnackbar() {
        val show = functionBody(voiceActions, "private fun MainViewModel.showVoiceRegistrationFailure(")
        assertTrue(show.contains("registrationFailureSurface(errorCode, windowOpen = voiceRegistrationWindowOpen)"))
        assertTrue(
            "창이 닫힌 뒤의 실패가 스낵바로 가지 않는다 — 나가기 경고의 삭제 실패가 어디에도 안 보인다.",
            show.contains("RegistrationFailureSurface.AppSnackbar -> message = text"),
        )
        assertTrue(show.contains("voiceRegistrationFailure = VoiceRegistrationFailure(code = errorCode, message = text)"))

        // 창이 닫히는 순간 아직 읽지 않은 거절은 스낵바로 넘긴다 — 창과 함께 사라지지 않게.
        val windowChanged = functionBody(voiceActions, "internal fun MainViewModel.voiceRegistrationWindowChanged(")
        assertTrue(windowChanged.contains("voiceRegistrationWindowOpen = open"))
        assertTrue(Regex("""voiceRegistrationFailure = null\s*message = unread\.message""").containsMatchIn(windowChanged))

        // 계정이 바뀌면 앞 계정의 거절을 지운다.
        val viewModel = withoutLineComments(readSource("ui/main/MainViewModel.kt"))
        assertTrue(viewModel.contains("voiceRegistrationFailure = null"))
    }

    @Test
    fun aRejectionThatSpendsTheRecordingDropsItAfterBusyIsLowered() {
        // 월 한도·말소리 없음은 '그대로 다시 시도' 가 없는 실패다 — 녹음(평문 생체정보)을 남겨 둘 이유가 없다. 어느 코드가
        // 그런지는 순수 함수(`cloneRejectionSpendsRecording` — `VoicePreviewConfirmRulesTest`)가 정하고, 여기서는 등록 실패
        // 갈래가 그 판정으로 지우는지를 본다. 말소리 없음에서 녹음을 남기면 파일 경로의 잘라 낸 사본(업로드한 것)이
        // 아무도 다시 보내지 않는 채 남는다 — 창은 그 참조를 이미 놓았다.
        // ⚠ busy 를 내린 **뒤에** 지운다. 먼저 지우면 그동안 등록 창이 흐름을 끝내며 보내는 초안 삭제가
        // busy 에 걸려 버려진다.
        val create = functionBody(voiceActions, "internal fun MainViewModel.createVoiceProfiles(")
        val lowered = create.lastIndexOf("voiceProfileBusy = false")
        val purge = create.indexOf("if (recordingSpent) purgeSourceRecordings()")
        assertTrue("같은 녹음으로는 다시 안 되는 거절에서 녹음을 지우지 않는다.", purge > 0)
        assertTrue("녹음을 busy 를 내리기 전에 지운다.", purge > lowered)
        assertTrue(
            "등록 실패 갈래가 녹음을 지울지를 `cloneRejectionSpendsRecording` 으로 가르지 않는다 — 월 한도만 보면 말소리 " +
                "없음으로 거절된 녹음이 남는다.",
            create.contains("recordingSpent = cloneRejectionSpendsRecording(createErrorCode)"),
        )
        // 횟수를 다시 읽는 것은 월 한도뿐이다 — 말소리 없음은 서버가 아무것도 쓰지 않아 숫자가 그대로다.
        val quotaReload = Regex(
            """if \(createErrorCode == VOICE_MONTHLY_LIMIT_ERROR_CODE\) \{\s*loadVoiceDraftQuota\(\)\s*\}""",
        )
        assertTrue("월 한도 거절 뒤에 횟수를 다시 읽지 않거나, 다른 거절에서도 읽는다.", quotaReload.containsMatchIn(create))
        // 문장은 공용 표 하나에서 온다 — 등록 실패 갈래가 이 코드에 따로 문장을 달면 두 앱의 문장이 갈라진다.
        assertFalse(create.contains("\"VOICE_CLONE_NO_SPEECH\""))
        // 다시 시도할 수 있는 실패에서는 지우지 않는다 — 실패 갈래 안에는 무조건 지우는 줄이 없다.
        val failure = create.substring(create.indexOf(".onFailure { error ->"), lowered)
        val guardedPurges = Regex("""purgeSourceRecordings\(\)""").findAll(failure).count()
        assertEquals(
            "실패 갈래에서 녹음을 지우는 것은 계정 전환(중단) 한 군데뿐이어야 한다.",
            1,
            guardedPurges,
        )
        assertTrue(failure.contains("if (error is VoiceCreateAbortedException || sessionChanged())"))
    }

    // ── 등록 창 — 받아서 그 안에 그린다 ───────────────────────────────────

    @Test
    fun theWindowDrawsTheFailureInsideItselfAndEndsTheFlowOnTheMonthlyLimit() {
        val effect = functionBody(panel, "LaunchedEffect(voiceRegistrationFailure)")
        assertTrue(
            "등록 창이 판정표를 쓰지 않거나, '그려져 있는가' 가 아닌 값으로 가른다.",
            effect.contains("registrationFailureSurface(failure.code, windowOpen = registrationWindowShown)"),
        )
        // 창 안의 줄 — 세부 정보 단계와 확정 화면이 둘 다 `localMessage` 를 그린다.
        val inWindow = surfaceBranch(effect, "InWindow")
        assertTrue(inWindow.contains("localMessage = failure.message"))
        // 월 한도: 알럿 하나 → 초안 삭제 → 창 닫기. 같은 버튼을 다시 누르게 두지 않는다.
        val endFlow = surfaceBranch(effect, "EndFlow")
        val notice = endFlow.indexOf("monthlyLimitNoticeOpen = true")
        val discard = endFlow.indexOf("onDiscardVoiceDraftQuietly(draftId)")
        val close = endFlow.indexOf("closeCreateDialog()")
        assertTrue("월 한도 알럿을 띄우지 않는다.", notice >= 0)
        assertTrue("초안을 버리지 않는다.", discard > notice)
        assertTrue("창을 닫지 않거나, 초안 삭제를 보내기 전에 닫는다.", close > discard)
        // 창 안의 세 갈래(흐름 끝내기·처음 단계로·그 자리에) 모두 읽었다고 알린다 — 같은 거절을 두 번 처리하지 않는다.
        for (name in listOf("EndFlow", "ReRecord", "InWindow")) {
            assertEquals(name, 1, Regex("""onVoiceRegistrationFailureShown\(\)""").findAll(surfaceBranch(effect, name)).count())
        }
        assertEquals(3, Regex("""onVoiceRegistrationFailureShown\(\)""").findAll(effect).count())

        // 알럿은 공용 껍데기 하나이고 문구는 리소스다.
        val alert = functionBody(panel, "if (monthlyLimitNoticeOpen)")
        assertTrue(alert.contains("IosAlertDialog("))
        assertTrue(alert.contains("R.string.voices_monthly_limit_title"))
        assertTrue(alert.contains("R.string.voices_monthly_limit_message"))
        assertEquals("액션은 닫기 하나다.", 1, Regex("""IosAlertAction\(""").findAll(alert).count())
    }

    @Test
    fun aFailedSaveLowersTheSavingMark() {
        // 저장이 실패한 뒤 `promotedForPrerenderId` 가 남으면, 뒤에 누른 `다시 만들기` 가 지우는 동안
        // 저장 버튼이 '저장 중…' 으로 그려진다(두 버튼의 진행 표시가 이 값으로 갈린다).
        val effect = functionBody(panel, "LaunchedEffect(voiceRegistrationFailure)")
        val reset = effect.indexOf("promotedForPrerenderId = null")
        assertTrue("저장 실패에서 '저장을 보냈다' 표시를 내리지 않는다.", reset >= 0)
        assertTrue("갈래를 가르기 전에 내려야 한다 — 어느 갈래로 가든 저장은 끝났다.", reset < effect.indexOf("when ("))
    }

    @Test
    fun theWindowTellsTheViewModelWhenItOpensAndCloses() {
        // ⚠ 닫힘은 **그 자리에서** 알린다. 나가기 경고는 초안 삭제를 보낸 바로 다음 줄에서 창을 닫는다 —
        // 효과로 미루면 그 삭제의 실패가 '창이 열려 있다' 로 판정돼 닫힌 창 안으로 간다.
        val close = functionBody(panel, "fun closeCreateDialog()")
        assertTrue(close.indexOf("onRegistrationWindowOpenChange(false)") > close.indexOf("showCreateForm = false"))
        // 열림·닫힘은 **그려져 있는가**로 알린다 — '열기로 했다'(`showCreateForm`)로 알리면 그려지지 않는 창이 열린
        // 것으로 남아, 뷰모델이 그 사이의 거절을 보이지 않는 창에 올린다.
        assertTrue(
            "등록 창의 열림·닫힘을 '그려져 있는가'(`registrationWindowShown`)로 알리지 않는다.",
            Regex("""LaunchedEffect\(registrationWindowShown\)\s*\{\s*onRegistrationWindowOpenChange\(registrationWindowShown\)\s*\}""")
                .containsMatchIn(panel),
        )
        assertFalse(panel.contains("LaunchedEffect(showCreateForm)"))
        // 화면을 떠날 때도 닫힌 것이다.
        val dispose = functionBody(panel, "DisposableEffect(Unit)")
        assertTrue(dispose.contains("onRegistrationWindowOpenChange(false)"))

        // 나가기 경고: 삭제를 보내고 → 닫는다(이 순서라야 뷰모델이 그 실패를 스낵바로 보낸다).
        val exitWarning = functionBody(panel, "if (draftExitWarningOpen)")
        assertTrue(
            exitWarning.indexOf("closeCreateDialog()") > exitWarning.indexOf("exitDraftId?.let(onDeleteVoiceDraft)"),
        )

        // 앱이 세 가지를 뷰모델에 잇는다.
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        assertTrue(app.contains("voiceRegistrationFailure = viewModel.voiceRegistrationFailure"))
        assertTrue(app.contains("onVoiceRegistrationFailureShown = { viewModel.consumeVoiceRegistrationFailure() }"))
        assertTrue(app.contains("onRegistrationWindowOpenChange = { open -> viewModel.voiceRegistrationWindowChanged(open) }"))
    }

    @Test
    fun aWindowThatIsNotDrawnIsNotTreatedAsOpen() {
        // 2026-10-11 리뷰: 만드는 중에 이용권이 끝나고(플랜·기간 한정 플랜 만료, plan_changed 푸시) 등록이 실패하면 창은
        // 세부 정보로 돌아오는데, 그 단계는 이용권이 없으면 그려지지 않는다. 예전에는 '열기로 했다'(`showCreateForm`)로
        // 갈라 그 거절을 그려지지 않는 창 안에 썼고, 목소리 탭의 안내 줄도 꺼져 있어 **어디에도 안 보였다**(1.2.10 은
        // 그 실패를 스낵바에 띄웠다 — 보이던 것이 안 보이게 된 회귀다). 판정은 `shouldDrawRegistrationWindow`
        // (`VoicePreviewConfirmRulesTest`)이고, 여기서는 그 값 **하나**를 세 자리가 보는지를 본다.

        // 값 하나 — 그 순간의 값을 읽도록 파생 상태다(그냥 `val` 이면 효과가 시작된 화면의 값에 묶인다).
        assertTrue(panel.contains("val latestCanOpenCreateForm by rememberUpdatedState(canOpenCreateForm)"))
        assertTrue(
            "등록 창이 '그려져 있는가' 를 파생 상태 하나로 두지 않는다.",
            Regex(
                """val registrationWindowShown by remember \{\s*derivedStateOf \{ """ +
                    """shouldDrawRegistrationWindow\(showCreateForm, currentStep, latestCanOpenCreateForm\) \}\s*\}""",
            ).containsMatchIn(panel),
        )
        // ① 그리는 조건이 그 값이다 — 따로 쓴 조건이 남아 있으면 '그려지지 않았는데 열려 있다' 가 다시 생긴다.
        val drawn = functionBody(panel, "if (registrationWindowShown)")
        assertTrue("등록 창(`Dialog`)을 그 값으로 그리지 않는다.", drawn.contains("TrackOpenModal()") && drawn.contains("Dialog("))
        assertFalse(panel.contains("if (showCreateForm && (inDraftDecisionFlow"))
        // ② 뷰모델에 알리는 열림과 ③ 거절 라우터는 위 두 테스트가 본다(`theWindowTellsTheViewModelWhenItOpensAndCloses`,
        // `theWindowDrawsTheFailureInsideItselfAndEndsTheFlowOnTheMonthlyLimit`).

        // 거절 라우터는 되돌리기 효과(만드는 중 → 세부 정보)가 단계를 바꿔 놓은 **뒤에** 돈다 — 실패와 busy 해제가 한
        // 화면에 함께 오므로 둘이 같은 차례에 돌고, 선언 순서대로 돈다. 순서가 바뀌면 '만드는 중이라 그려져 있다' 를
        // 읽어 그 거절을 곧 사라질 창 안에 쓴다.
        val revert = panel.indexOf("LaunchedEffect(voiceProfileBusy, pendingVoiceDraft?.id, currentStep)")
        val router = panel.indexOf("LaunchedEffect(voiceRegistrationFailure)")
        assertTrue("되돌리기 효과를 못 찾았다.", revert >= 0)
        assertTrue("거절 라우터가 되돌리기 효과보다 앞에 있다.", revert < router)

        // 그려지지 않는 창은 닫는다 — 닫는 조건은 그리는 값의 여집합이다(아래 `aWindowClosesExactlyWhenItIsNotDrawn`).
        // 그 값이 키라서, 만드는 중에 이용권이 끝난 뒤 세부 정보로 돌아와 그려지지 않게 된 창도 그때 닫힌다.
        assertTrue(panel.contains("LaunchedEffect(registrationWindowShown, showCreateForm)"))
    }

    @Test
    fun aWindowClosesExactlyWhenItIsNotDrawn() {
        // 2026-10-11 리뷰(2차의 뒤): 이용권이 끝났을 때의 닫기가 단계 목록('만드는 중·확정이 아니면')으로 따로 적혀
        // 있었다. 그리는 조건은 **준비 단계**도 이용권과 무관하게 그리는데 닫기는 그 단계를 닫았다 — 저장하기가 성공해 준비
        // 단계로 넘어가는 순간 기기가 이용권을 '없다' 로 읽으면(기기 시계가 기한을 넘겼다·기간 한정 플랜 도장이 지났다 —
        // 서버는 확정을 받았다) 준비 진행 없이 창이 닫혔다. 1.2.10 은 준비 화면을 지켰다.
        // 판정(`shouldDrawRegistrationWindow` — 준비 단계는 이용권이 없어도 그린다)은 `VoicePreviewConfirmRulesTest` 가
        // 지키고, 여기서는 닫기가 그 값의 여집합 **하나**인지를 본다 — 단계를 따로 늘어놓으면 두 규칙이 다시 갈라진다.
        assertTrue(
            "닫기가 그리는 값(`registrationWindowShown`)의 여집합이 아니다 — 열기로 했는데 그려지지 않을 때만 닫아야 한다.",
            Regex(
                """LaunchedEffect\(registrationWindowShown, showCreateForm\) \{\s*""" +
                    """if \(showCreateForm && !registrationWindowShown\) closeCreateDialog\(\)\s*\}""",
            ).containsMatchIn(panel),
        )
        // 옛 닫기(이용권·단계 목록)가 남아 있으면 준비 단계가 다시 닫힌다.
        assertFalse("이용권으로 닫는 옛 효과가 남아 있다.", panel.contains("LaunchedEffect(canCreateVoice, currentStep)"))
        assertFalse(panel.contains("LaunchedEffect(canCreateVoice) {"))
        assertFalse(
            "창을 닫는 조건이 단계 목록을 따로 든다 — 그리는 조건과 갈라진다.",
            Regex("""!canCreateVoice && showCreateForm""").containsMatchIn(panel),
        )
        // 이용권이 끝나 닫히는 창의 거절이 사라지지 않는다: 거절 효과가 '그려져 있는가' 로 갈라 스낵바로 보내고
        // (`aWindowThatIsNotDrawnIsNotTreatedAsOpen`), 닫기가 먼저 와도 닫힘 알림이 읽지 않은 거절을 스낵바로 넘긴다.
        assertTrue(functionBody(panel, "fun closeCreateDialog()").contains("onRegistrationWindowOpenChange(false)"))
        val windowChanged = functionBody(voiceActions, "internal fun MainViewModel.voiceRegistrationWindowChanged(")
        assertTrue(Regex("""voiceRegistrationFailure = null\s*message = unread\.message""").containsMatchIn(windowChanged))
    }

    @Test
    fun aRetryableCloneFailureKeepsTheRecording() {
        // 예전에는 '만드는 중' 으로 넘어가며 녹음(고른 파일)을 먼저 놓았다 — 실패해 세부 정보 단계로
        // 돌아오면 `등록` 이 꺼져 있었다(`canSubmitRecord`·`canSubmitSingleFile` 이 둘 다 거짓).
        val enterCreating = functionBody(panel, "fun enterCreatingStep()")
        assertFalse("'만드는 중' 으로 넘어가며 녹음을 놓는다.", enterCreating.contains("selectedAudio = null"))
        assertFalse("'만드는 중' 으로 넘어가며 고른 파일을 놓는다.", enterCreating.contains("selectedFileUri = null"))
        assertFalse(enterCreating.contains("selectedFileDurationMillis = null"))

        // 놓는 것은 초안이 만들어진 뒤다 — 초안이 도착하는 두 갈래(준비됨·만드는 중)에서.
        val release = functionBody(panel, "fun releaseRegistrationSource()")
        assertTrue(release.contains("selectedAudio = null") && release.contains("selectedFileUri = null"))
        val draftArrived = functionBody(panel, "LaunchedEffect(pendingVoiceDraft?.id, pendingVoiceDraft?.status)")
        assertEquals(2, Regex("""releaseRegistrationSource\(\)""").findAll(draftArrived).count())

        // `등록` 이 눌리는 조건은 그 참조를 본다 — 참조가 남아야 다시 누를 수 있다.
        assertTrue(panel.contains("val canSubmitRecord = inputMode == VoiceCaptureMode.Record &&"))
        assertTrue(panel.contains("(selectedAudio?.durationMillis ?: 0L) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS"))
        assertTrue(panel.contains("selectedFileUri != null &&"))
    }

    @Test
    fun aRecordingWithoutSpeechGoesBackToTheFirstStepAndDropsTheRecording() {
        // 2026-10-11 소유자 결정: "목소리(말소리) 없으면 등록 못 하도록 막는다. 다시 만들기는 횟수 제한 없음." 서버는 그
        // 녹음을 provider 에 올리기 전에 거절하고 아무것도 쓰지 않는다(`VOICE_CLONE_NO_SPEECH`). 창은 세부 정보 단계에
        // 머물지 않는다 — 머물면 `등록` 이 같은 녹음을 다시 보낸다. 판정은 `registrationFailureSurface`
        // (`VoicePreviewConfirmRulesTest`)이고, 여기서는 그 갈래가 실제로 하는 일을 본다.
        val effect = functionBody(panel, "LaunchedEffect(voiceRegistrationFailure)")
        val reRecord = surfaceBranch(effect, "ReRecord")
        assertTrue("처음 단계(음원 준비)로 돌아가지 않는다.", reRecord.contains("currentStep = VoiceRegistrationStep.Source"))
        assertTrue("거절된 녹음(고른 파일)을 놓지 않는다 — `다음`·`등록` 이 같은 소리를 다시 보낸다.", reRecord.contains("dropRejectedRecording()"))
        assertTrue("돌아온 이유를 그 단계에 쓰지 않는다.", reRecord.contains("rerecordReason = failure.message"))
        // 흐름을 끝내지 않는다 — 창을 닫거나 초안을 버리거나 월 한도 알럿을 띄우지 않는다(서버가 아무것도 만들지 않았다).
        for (endsTheFlow in listOf("closeCreateDialog()", "monthlyLimitNoticeOpen", "onDiscardVoiceDraftQuietly", "onDeleteVoiceDraft")) {
            assertFalse("말소리 없음 갈래가 흐름을 끝낸다: $endsTheFlow", reRecord.contains(endsTheFlow))
        }
        // 이유는 단계 맨 아래의 흐린 안내 줄이 아니라 녹음 카드 아래의 줄에 쓴다 — 본문을 끝까지 내리지도 않는다.
        assertFalse(reRecord.contains("localMessage = failure.message"))
        assertFalse(reRecord.contains("registrationFailureTick"))

        // 놓는 것: 녹음·고른 파일의 참조, 자르기 범위, 그 녹음에서 재던 높이. 파일 자체는 뷰모델이 지운다
        // (`aRejectionThatSpendsTheRecordingDropsItAfterBusyIsLowered`).
        val drop = functionBody(panel, "fun dropRejectedRecording()")
        assertTrue(drop.contains("releaseRegistrationSource()"))
        assertTrue(drop.contains("cropStartMillis = 0L") && drop.contains("cropEndMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS"))
        assertTrue(drop.contains("sourceF0Job?.cancel()"))
        val release = functionBody(panel, "fun releaseRegistrationSource()")
        for (reference in listOf("selectedAudio = null", "selectedFileUri = null", "selectedFileDurationMillis = null")) {
            assertTrue(reference, release.contains(reference))
        }

        // 그 줄은 음원 준비 단계의 녹음 카드(파일 경로는 파일 고르기) **바로 아래**다 — 다음에 누를 것이 녹음 버튼이다.
        // 본문의 음원 준비 단계 — 상단바·하단 행에도 같은 단계 이름이 있어 그 단계가 그리는 첫 컨트롤로 집는다.
        val sourceStart = Regex("""VoiceRegistrationStep\.Source -> \{\s*VoiceCaptureModeSelector\(""").find(panel)
        val detailsStart = Regex("""VoiceRegistrationStep\.Details -> \{\s*OutlinedTextField\(""").find(panel)
        assertTrue("본문의 음원 준비·세부 정보 단계를 못 찾았다.", sourceStart != null && detailsStart != null)
        val sourceStep = panel.substring(sourceStart!!.range.first, detailsStart!!.range.first)
        val recordCard = sourceStep.indexOf("VoiceRecordControls(")
        val recordLine = sourceStep.indexOf("rerecordReason?.let { reason -> RerecordReasonLine(reason) }", recordCard)
        assertTrue("녹음 카드 아래에 이유 줄이 없다.", recordCard >= 0 && recordLine > recordCard)
        assertTrue("이유 줄이 녹음 카드 바로 아래가 아니다 — 힌트·대사 카드 뒤로 밀렸다.", recordLine < sourceStep.indexOf("R.string.voices_record_status_hint"))
        val fileControls = sourceStep.indexOf("VoiceFileControls(")
        val fileLine = sourceStep.indexOf("rerecordReason?.let { reason -> RerecordReasonLine(reason) }", fileControls)
        assertTrue("파일 고르기 아래에 이유 줄이 없다.", fileControls >= 0 && fileLine > fileControls)
        // 글자·색은 토큰이다(확정 화면의 오류 줄과 같다) — 생 색·크기를 박지 않는다.
        val line = functionBody(panel, "private fun RerecordReasonLine(text: String)")
        assertTrue(line.contains("style = MaterialTheme.typography.bodySmall"))
        assertTrue(line.contains("color = MaterialTheme.colorScheme.error"))
        assertFalse(line.contains("Color(0x"))
        // 이유 줄은 본문 위쪽이다 — 앞 단계에서 내려 둔 스크롤을 맨 위로 올린다.
        assertTrue(
            Regex("""LaunchedEffect\(rerecordReason\) \{\s*if \(rerecordReason != null\) contentScrollState\.animateScrollTo\(0\)\s*\}""")
                .containsMatchIn(panel),
        )

        // 걷는 때: 새로 녹음하기 시작했을 때, 파일을 새로 골랐을 때, 방식을 바꿨을 때, 창을 닫을 때. 남겨 두면 새 녹음도
        // 거절당한 것처럼 읽힌다.
        assertTrue("녹음을 다시 시작해도 이유가 남는다.", functionBody(panel, "fun startRecording()").contains("rerecordReason = null"))
        assertTrue("파일을 새로 골라도 이유가 남는다.", functionBody(panel, "fun prepareSelectedFile(uri: Uri)").contains("rerecordReason = null"))
        assertTrue("창을 닫아도 이유가 남는다.", functionBody(panel, "fun closeCreateDialog()").contains("rerecordReason = null"))
        val modeSelector = sourceStep.substring(sourceStep.indexOf("onSelect = {"), sourceStep.indexOf("inputMode = it"))
        assertTrue("방식을 바꿔도 이유가 남는다.", modeSelector.contains("rerecordReason = null"))
    }

    @Test
    fun theNoSpeechSentenceIsOneTableEntryInThreeLanguages() {
        // 두 앱이 같은 문장을 쓴다(2026-10-11 소유자 결정의 문장 — iOS `APIErrorMessages.swift` 와 짝). 등록 창이 그려져
        // 있으면 녹음 카드 아래에, 아니면 스낵바에 — 어느 쪽이든 공용 표의 이 문장이다(등록 실패 갈래는 이 코드에 따로
        // 문장을 달지 않는다 — `aRejectionThatSpendsTheRecordingDropsItAfterBusyIsLowered`).
        val expected = mapOf(
            "ko" to "녹음에서 말소리를 거의 찾지 못했어요. 조용한 곳에서 문장을 또렷하게 읽으며 다시 녹음해 주세요.",
            "en" to "We couldn't find much speech in the recording. Please record again in a quiet place, reading the sentences clearly.",
            "ja" to "録音から話し声がほとんど見つかりませんでした。静かな場所で、文をはっきり読みながらもう一度録音してください。",
        )
        for ((language, sentence) in expected) {
            val context = context(language)
            assertEquals(language, sentence, apiErrorMessage(context, VOICE_CLONE_NO_SPEECH_ERROR_CODE))
            assertEquals(language, sentence, context.getString(R.string.msg_voice_clone_no_speech))
            // 창이 그려지지 않아 스낵바로 가면 오류 색이다(거절이다).
            assertEquals(language, MessageSeverity.Error, snackbarSeverity(context, sentence))
        }
        // 표의 열쇠는 서버가 내는 코드 그대로다 — 공용 목록(`packages/shared/src/schemas/error-codes.ts`)에 있어야 한다.
        // 철자가 어긋나면 표가 조용히 빗나가 폴백 문장('목소리를 만들지 못했어요')이 뜬다.
        val sharedCodes = File("../../../packages/shared/src/schemas/error-codes.ts").readText()
        assertTrue(
            "공용 에러 코드 목록에 `$VOICE_CLONE_NO_SPEECH_ERROR_CODE` 가 없다.",
            sharedCodes.contains("'$VOICE_CLONE_NO_SPEECH_ERROR_CODE',"),
        )
        assertTrue(withoutLineComments(readSource("network/ApiErrorMessages.kt")).contains("\"VOICE_CLONE_NO_SPEECH\" to R.string.msg_voice_clone_no_speech,"))
    }

    @Test
    fun theConfirmStepLocksAreUnchanged() {
        // 확정 화면의 잠금표는 iOS `VoicePreviewConfirmView` 와 짝이다 — 이 수정으로 건드리지 않는다.
        assertTrue(rules.contains("working = fetching || confirming || savingText || profileBusy"))
        assertTrue(rules.contains("toneEnabled = !editing && !savingText && !profileBusy"))
        // 화면이 그 표에 넘기는 값도 그대로다 — 등록 거절을 그리느라 잠금 조건을 늘리지 않았다.
        val callStart = panel.indexOf("val confirmLocks = confirmStepLocks(")
        assertTrue("확정 화면이 잠금표를 부르는 자리를 못 찾았다.", callStart >= 0)
        val call = panel.substring(callStart, panel.indexOf(')', callStart) + 1)
        for (argument in listOf(
            "fetching = confirmPreviewBusy",
            "confirming = confirmingGeneration != null",
            "savingText = confirmPreviewSaving",
            "profileBusy = voiceProfileBusy",
            "editing = confirmPreviewEditing",
        )) {
            assertTrue(argument, call.contains(argument))
        }
    }

    // ── 문구 — iOS 카탈로그의 같은 알럿과 같은 말 ──────────────────────────

    @Test
    fun theMonthlyLimitAlertSaysTheSameThingAsTheIosCatalog() {
        val titleKey = "이번 달 목소리는 다 만들었어요"
        val messageKey = "목소리는 한 달에 1개 만들 수 있어요. 다음 달에 새로 만들 수 있고, 지금 목소리를 지워도 이번 달에는 다시 만들 수 없어요."
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            assertEquals(language, iosCatalogValue(titleKey, language), context.getString(R.string.voices_monthly_limit_title))
            assertEquals(language, iosCatalogValue(messageKey, language), context.getString(R.string.voices_monthly_limit_message))
        }
    }

    @Test
    fun theNoSpeechSentenceSaysTheSameThingAsTheIosCatalog() {
        // 말소리 없음의 문장은 두 앱의 오류 표가 짝으로 든다(안드로이드 `ApiErrorMessages.kt` / iOS `APIErrorMessages.swift`).
        // 한쪽만 고치면 같은 거절이 두 앱에서 다르게 읽힌다 — iOS 카탈로그는 한국어 문장이 열쇠다.
        val key = "녹음에서 말소리를 거의 찾지 못했어요. 조용한 곳에서 문장을 또렷하게 읽으며 다시 녹음해 주세요."
        for (language in listOf("ko", "en", "ja")) {
            assertEquals(language, iosCatalogValue(key, language), context(language).getString(R.string.msg_voice_clone_no_speech))
        }
    }

    /** iOS 카탈로그(`Localizable.xcstrings`)의 값 — 한국어는 열쇠 자체다. 없으면 열쇠를 알려 주며 실패한다. */
    private fun iosCatalogValue(key: String, language: String): String {
        assertTrue("iOS 카탈로그에 `$key` 가 없다.", iosCatalog.has(key))
        if (language == "ko") return key
        return iosCatalog.getAsJsonObject(key).getAsJsonObject("localizations").getAsJsonObject(language)
            .getAsJsonObject("stringUnit").get("value").asString
    }

    private val iosCatalog by lazy {
        JsonParser.parseString(File("../../ios-native/AlarmTalk/Localizable.xcstrings").readText())
            .asJsonObject.getAsJsonObject("strings")
    }

    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return base.createConfigurationContext(configuration)
    }

    /** 거절 효과의 한 갈래 — `RegistrationFailureSurface.<name> ->` 부터 다음 갈래 앞까지(마지막 갈래면 끝까지). */
    private fun surfaceBranch(effect: String, name: String): String {
        val start = effect.indexOf("RegistrationFailureSurface.$name ->")
        assertTrue("거절 효과에 `$name` 갈래가 없다.", start >= 0)
        val next = effect.indexOf("RegistrationFailureSurface.", start + 1)
        return if (next < 0) effect.substring(start) else effect.substring(start, next)
    }

    private val voiceActions: String by lazy { withoutLineComments(readSource("ui/main/MainViewModelVoiceActions.kt")) }
    private val panel: String by lazy { withoutLineComments(readSource("ui/voices/VoiceProfileManagementPanel.kt")) }
    private val rules: String by lazy { withoutLineComments(readSource("ui/voices/VoicePreviewConfirmRules.kt")) }
}
