package com.alarmtalk.app

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **계정을 떠날 때 앞 계정의 확인 창도 닫는다** — 같은 시각 알람 교체 확인(`duplicateAlarmPrompt`).
 *
 * 그 창이 떠 있는 채로 계정을 떠나면(다른 기기의 탈퇴 신청으로 403 등) 창은 세션과 무관하게 그려진다(`AlarmTalkApp`). 그때
 * '교체' 를 누르면 `createAlarm(replaceExisting = true)` 가 주인 없는 알람을 켜진 채 예약한다 — 로그인 화면 뒤에서 울고, 다음에
 * 로그인하는 계정이 물려받는다(`docs/spec/alarm-lifecycle.md` §1-1 — 종료 중에는 아무도 예약하지 못한다).
 * `MainViewModel` 은 단위 테스트에서 세울 수 없어 소스로 본다(`SourceWiring`).
 */
class UserScopedPromptResetWiringTest {
    @Test
    fun anAccountSwitchClosesTheDuplicateAlarmPrompt() {
        val viewModel = withoutLineComments(readSource("ui/main/MainViewModel.kt"))
        val clear = functionBody(viewModel, "fun clearUserScopedRemoteState(")
        assertTrue(clear.contains("duplicateAlarmPrompt = null"))
    }
}
