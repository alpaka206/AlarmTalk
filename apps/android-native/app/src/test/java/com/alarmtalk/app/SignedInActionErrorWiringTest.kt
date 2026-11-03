package com.alarmtalk.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **로그인한 동안의 실패는 그 자리에 빨간 글자로 남는다**(2026-10-29 오너: 알림이 아니라 빨간 글자 — iOS `AuthViewModel.actionError` 짝).
 *
 * 예전에는 상단 스낵바(`message`)로만 말해, 탈퇴 확인 창·민감 동의 시트처럼 **자기 창**을 연 채 실패하면 그 창의 어두운 막
 * 아래에 깔렸다. 뷰모델은 세울 수 없어 배선을 소스로 본다(`SourceWiring.kt` 머리말).
 */
class SignedInActionErrorWiringTest {

    private val auth: String by lazy { withoutLineComments(readSource("ui/main/MainViewModelAuthActions.kt")) }
    private val app: String by lazy { withoutLineComments(readSource("ui/app/AlarmTalkApp.kt")) }

    @Test
    fun `다섯 동작의 실패가 그 동작의 자리로 간다`() {
        for (action in listOf("ACCOUNT_DELETION", "CONSENT", "SENSITIVE_CONSENT", "MARKETING", "WITHDRAWAL")) {
            assertTrue("$action 실패를 그 자리에 적지 않는다", auth.contains("failAction(\n") && auth.contains("SignedInAction.$action,"))
            assertTrue("$action 를 그리는 화면이 없다", app.contains("actionErrorFor(SignedInAction.$action)"))
        }
    }

    @Test
    fun `실패 문장을 스낵바로 보내지 않는다`() {
        for (res in listOf(
            "msg_account_deletion_request_failed",
            "msg_marketing_consent_update_failed",
            "msg_voice_consent_withdraw_failed",
        )) {
            assertFalse("$res 가 아직 스낵바(`message =`)로 간다", Regex("""message = userFacingError\([^)]*\n?[^)]*R\.string\.$res""").containsMatchIn(auth))
        }
    }

    @Test
    fun `철회 전 조회가 화면을 떠나 취소되면 실패로 적지 않는다`() {
        val body = functionBody(auth, "internal suspend fun MainViewModel.withdrawVoiceBiometricConsent(")
        val fetch = body.indexOf("api.listVoiceProfiles(authorization)")
        val rethrow = body.indexOf("if (error is kotlinx.coroutines.CancellationException) throw error")
        assertTrue("취소를 실패로 받는다 — 떠난 화면에 '철회에 실패했어요' 가 남는다", rethrow > fetch && fetch >= 0)
    }
}
