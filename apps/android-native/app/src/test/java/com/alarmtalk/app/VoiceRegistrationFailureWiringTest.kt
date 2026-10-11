package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
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
    fun aMonthlyLimitRejectionAtTheCloneStepDropsTheRecordingAfterBusyIsLowered() {
        // 월 한도 거절은 '그대로 다시 시도' 가 없는 실패다 — 녹음(평문 생체정보)을 남겨 둘 이유가 없다.
        // ⚠ busy 를 내린 **뒤에** 지운다. 먼저 지우면 그동안 등록 창이 흐름을 끝내며 보내는 초안 삭제가
        // busy 에 걸려 버려진다.
        val create = functionBody(voiceActions, "internal fun MainViewModel.createVoiceProfiles(")
        val lowered = create.lastIndexOf("voiceProfileBusy = false")
        val purge = create.indexOf("if (refusedForMonth) purgeSourceRecordings()")
        assertTrue("월 한도로 끝난 등록의 녹음을 지우지 않는다.", purge > 0)
        assertTrue("녹음을 busy 를 내리기 전에 지운다.", purge > lowered)
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
            "등록 창이 판정표를 쓰지 않는다.",
            effect.contains("registrationFailureSurface(failure.code, windowOpen = showCreateForm)"),
        )
        // 창 안의 줄 — 세부 정보 단계와 확정 화면이 둘 다 `localMessage` 를 그린다.
        val inWindow = effect.substring(effect.indexOf("RegistrationFailureSurface.InWindow ->"))
        assertTrue(inWindow.contains("localMessage = failure.message"))
        // 월 한도: 알럿 하나 → 초안 삭제 → 창 닫기. 같은 버튼을 다시 누르게 두지 않는다.
        val endFlow = effect.substring(
            effect.indexOf("RegistrationFailureSurface.EndFlow ->"),
            effect.indexOf("RegistrationFailureSurface.InWindow ->"),
        )
        val notice = endFlow.indexOf("monthlyLimitNoticeOpen = true")
        val discard = endFlow.indexOf("onDeleteVoiceDraft(draftId)")
        val close = endFlow.indexOf("closeCreateDialog()")
        assertTrue("월 한도 알럿을 띄우지 않는다.", notice >= 0)
        assertTrue("초안을 버리지 않는다.", discard > notice)
        assertTrue("창을 닫지 않거나, 초안 삭제를 보내기 전에 닫는다.", close > discard)
        // 두 갈래 모두 읽었다고 알린다 — 같은 거절을 두 번 처리하지 않는다.
        assertEquals(2, Regex("""onVoiceRegistrationFailureShown\(\)""").findAll(effect).count())

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
        assertTrue(
            Regex("""LaunchedEffect\(showCreateForm\)\s*\{\s*if \(showCreateForm\) onRegistrationWindowOpenChange\(true\)""")
                .containsMatchIn(panel),
        )
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
        val catalog = JsonParser.parseString(File("../../ios-native/AlarmTalk/Localizable.xcstrings").readText())
            .asJsonObject.getAsJsonObject("strings")
        fun ios(key: String, language: String): String =
            if (language == "ko") {
                assertTrue("iOS 카탈로그에 `$key` 가 없다.", catalog.has(key))
                key
            } else {
                catalog.getAsJsonObject(key).getAsJsonObject("localizations").getAsJsonObject(language)
                    .getAsJsonObject("stringUnit").get("value").asString
            }
        val titleKey = "이번 달 목소리는 다 만들었어요"
        val messageKey = "목소리는 한 달에 1개 만들 수 있어요. 다음 달에 새로 만들 수 있고, 지금 목소리를 지워도 이번 달에는 다시 만들 수 없어요."
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            assertEquals(language, ios(titleKey, language), context.getString(R.string.voices_monthly_limit_title))
            assertEquals(language, ios(messageKey, language), context.getString(R.string.voices_monthly_limit_message))
        }
    }

    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return base.createConfigurationContext(configuration)
    }

    private val voiceActions: String by lazy { withoutLineComments(readSource("ui/main/MainViewModelVoiceActions.kt")) }
    private val panel: String by lazy { withoutLineComments(readSource("ui/voices/VoiceProfileManagementPanel.kt")) }
    private val rules: String by lazy { withoutLineComments(readSource("ui/voices/VoicePreviewConfirmRules.kt")) }
}
