package com.alarmtalk.app

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **보낸 생체정보 동의 철회는 화면을 떠나도 끝까지 처리한다**(`docs/spec/consent.md` 「철회 = 삭제」).
 *
 * 철회는 동의 내역 화면의 코루틴에서 돈다. 응답을 기다리는 사이 화면을 나가면 그 코루틴이 취소되고, `runCatching` 이 취소를
 * 실패로 받아 '철회에 실패했어요' 를 띄우며 로컬 강등(`degradeAlarmsUsingVoiceProfile`)을 건너뛰었다. 서버는 이미 지웠을 수 있어,
 * 그러면 철회한 목소리가 이 기기에서 계속 운다. 보낸 순간부터는 취소되지 않는 구간에서 끝까지 간다.
 * `MainViewModel` 은 단위 테스트에서 세울 수 없어 소스로 본다(`SourceWiring`).
 */
class VoiceConsentWithdrawalWiringTest {
    @Test
    fun theWithdrawalRequestAndLocalDowngradeRunToTheEndEvenIfTheScreenLeaves() {
        val actions = withoutLineComments(readSource("ui/main/MainViewModelAuthActions.kt"))
        val withdraw = functionBody(actions, "internal suspend fun MainViewModel.withdrawVoiceBiometricConsent(")
        val guarded = withdraw.indexOf("withContext(NonCancellable)")
        assertTrue("철회 요청은 취소되지 않는 구간 안에서 보낸다", guarded >= 0)
        assertTrue(withdraw.indexOf("type = \"voice_biometric\"") > guarded)
        assertTrue("로컬 강등도 그 구간 안이다", withdraw.indexOf("degradeAlarmsUsingVoiceProfile") > guarded)
    }
}
