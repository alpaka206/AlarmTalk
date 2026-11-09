package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 알람을 켠 순간의 하단 안내(`docs/spec/alarm-editor.md` §7)가 **어디서 바뀌고 어디서 뜨는가.**
 *
 * 규칙 자체 — 무엇이 안내가 되고 무엇이 거두는가, 띄울지 — 는 순수 함수라 `RingInNoticeTest` 가 이벤트 순서로 본다. 그런데
 * 그 함수를 **성공 갈래에서 반영된 그 행으로** 부르는지, 화면이 하단 탭에서만 띄우는지는 거기서 보이지 않는다. 뷰모델은
 * 세울 수 없어 배선을 소스로 본다(`SourceWiring.kt` 머리말). 아래 회귀는 이 파일이 없으면 모든 테스트가 초록인 채 들어온다:
 * 켜기에서 알리기를 빼거나 실패 갈래로 옮기는 것, 손으로 `ringInNotice` 를 덮어써 다른 알람·더 새 안내까지 지우는 것,
 * 하단바가 없는 화면에서 띄우거나 저장 직후의 안내를 버리는 것, 아래 안내를 다시 M3 스낵바로 그리는 것.
 */
class RingInNoticeWiringTest {
    private val actions: String by lazy { withoutLineComments(readSource("ui/main/MainViewModelAlarmActions.kt")) }
    private val viewModel: String by lazy { withoutLineComments(readSource("ui/main/MainViewModel.kt")) }
    private val app: String by lazy { withoutLineComments(readSource("ui/app/AlarmTalkApp.kt")) }

    @Test
    fun `편집기 저장은 성공 갈래에서 저장된 행으로 알리고 실패는 그대로 둔다`() {
        for (signature in listOf("internal fun MainViewModel.createAlarm(", "internal fun MainViewModel.updateAlarm(")) {
            val body = functionBody(actions, signature)
            assertTrue("$signature 성공 갈래가 안내를 알리지 않는다", "noteRingInApplied(saved)" in blockAfter(body, ".onSuccess { saved ->"))
            assertFalse("$signature 실패 갈래가 안내를 건드린다", mentionsRingIn(blockAfter(body, ".onFailure { error ->")))
        }
    }

    @Test
    fun `목록 스위치는 켜기·끄기 모두 반영된 행으로 알리고 실패는 그대로 둔다`() {
        val body = functionBody(actions, "internal fun MainViewModel.setAlarmEnabled(")
        // 켠 행이면 안내가 되고 끈 행이면 그 알람의 안내만 거둔다 — 갈래는 `after` 가 그 행의 `enabled` 로 가른다.
        assertTrue("스위치 성공 갈래가 반영된 행으로 알리지 않는다", "noteRingInApplied(updated)" in blockAfter(body, ".onSuccess { updated ->"))
        // 지난 날짜라 켜지지 않은 날짜 알람도 이 갈래다 — 그때는 날짜 알럿이 말한다.
        assertFalse("실패 갈래가 안내를 건드린다", mentionsRingIn(blockAfter(body, ".onFailure { error ->")))
    }

    @Test
    fun `삭제는 성공 갈래에서 그 알람의 안내를 거두고 실패는 그대로 둔다`() {
        val body = functionBody(actions, "internal fun MainViewModel.deleteAlarm(")
        assertTrue(
            "삭제 성공이 그 알람의 안내를 거두지 않는다",
            "applyRingInEvent(RingInEvent.Deleted(alarmId))" in blockAfter(body, ".onSuccess {"),
        )
        assertFalse("삭제 실패가 안내를 건드린다", mentionsRingIn(blockAfter(body, ".onFailure { error ->")))
    }

    @Test
    fun `안내를 바꾸는 곳은 순수 함수 하나다`() {
        // 손으로 덮어쓰면 `after` 의 규칙(다른 알람의 안내는 둔다·더 새 안내는 남긴다)을 비켜 간다.
        val assignments = Regex("""\bringInNotice\s*=(?!=)""").findAll(actions + viewModel + app).count()
        assertEquals("`ringInNotice` 를 `applyRingInEvent` 밖에서 덮어쓴다", 1, assignments)
        assertTrue("ringInNotice = ringInNotice.after(event)" in functionBody(viewModel, "internal fun applyRingInEvent("))
        assertTrue(
            "소진이 더 새 안내를 가리지 않는 `Finished` 를 거치지 않는다",
            "applyRingInEvent(RingInEvent.Finished(shown))" in functionBody(viewModel, "fun consumeRingInNotice("),
        )
    }

    @Test
    fun `화면은 하단 탭에서만 띄우고 하위 화면에서는 버리지 않고 기다린다`() {
        val effect = blockAfter(app, "LaunchedEffect(viewModel.ringInNotice, showAppChrome)")
        assertTrue("띄울지를 `ringInAction` 이 하단 탭 여부로 정하지 않는다", "onTabScreen = showAppChrome" in effect)
        val wait = effect.substringAfter("RingInAction.Wait ->").substringBefore("RingInAction.Drop ->")
        assertFalse("하위 화면에서 안내를 버린다 — 저장 직후 편집기가 닫히는 사이의 안내가 사라진다", "consumeRingInNotice" in wait)
        val drop = effect.substringAfter("RingInAction.Drop ->").substringBefore("RingInAction.Show ->")
        assertTrue("맞지 않게 된 안내를 남겨 둔다", "viewModel.consumeRingInNotice(notice)" in drop)
        val shown = effect.substringAfter("RingInAction.Show ->")
        assertTrue(
            "다 보였거나 도중에 걷혔을 때 소진하지 않는다 — 화면이 다시 만들어지면 지난 안내가 또 뜬다",
            Regex("""finally\s*\{\s*viewModel\.consumeRingInNotice\(notice\)""").containsMatchIn(shown),
        )
    }

    @Test
    fun `아래 호스트는 누르는 것을 받지 않는 카드로 그린다`() {
        // 카드가 실제로 터치를 넘기는지는 `PassThroughSnackbarTouchTest` 가 눌러 본다. 여기서는 아래 호스트가 그 카드를 쓰는지만.
        val host = blockAfter(app, "SnackbarHost(hostState = ringInSnackbarHostState)")
        assertTrue("아래 안내가 캡슐(`RingInCapsule`)이 아니다 — M3 스낵바면 그 띠에 걸친 행이 눌리지 않는다", "RingInCapsule(" in host)
    }

    private fun mentionsRingIn(source: String) = "RingIn" in source || "ringIn" in source
}
