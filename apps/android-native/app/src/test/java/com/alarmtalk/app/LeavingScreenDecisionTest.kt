package com.alarmtalk.app

import com.alarmtalk.app.ringing.LeavingScreenDecision
import com.alarmtalk.app.ringing.leavingScreenDecision
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * **울림 화면을 벗어나면 알람이 꺼진다** — 잠금 여부와 무관하게(2026-09-09 지시).
 *
 * ⚠ 이 규칙이 틀리면 증상이 **정반대 둘**로 갈린다. 너무 좁으면 전화를 받는데도 알람이
 * 계속 울고, 너무 넓으면 **가방 속에서 커버가 화면을 되끄는 것만으로 알람이 꺼져 자는
 * 사람이 못 일어난다.** 뒤쪽이 더 나쁘지만, 앞쪽도 실사용을 망친다 — 그래서 예외는
 * '잠긴 기기에서 뜬 직후의 화면 꺼짐' **하나뿐**이다.
 */
class LeavingScreenDecisionTest {

    private fun decide(
        handled: Boolean = false,
        superseded: Boolean = false,
        changingConfigurations: Boolean = false,
        isActiveRingingAlarm: Boolean = true,
        screenOff: Boolean = false,
        screenCovered: Boolean = false,
        seenUnlocked: Boolean = true,
        elapsedSinceShownMs: Long = 10_000L,
    ) = leavingScreenDecision(
        handled = handled,
        superseded = superseded,
        changingConfigurations = changingConfigurations,
        isActiveRingingAlarm = isActiveRingingAlarm,
        screenOff = screenOff,
        screenCovered = screenCovered,
        seenUnlocked = seenUnlocked,
        elapsedSinceShownMs = elapsedSinceShownMs,
    )

    @Test
    fun 전화가_오면_잠금_여부와_무관하게_꺼진다() {
        // 통화 화면이 덮으면 화면은 켜진 채 onStop 이 온다. 알람 때문에 전화를 못 받게 할 수는 없다.
        assertEquals(LeavingScreenDecision.DISMISS, decide(screenOff = false, seenUnlocked = true))
        assertEquals(LeavingScreenDecision.DISMISS, decide(screenOff = false, seenUnlocked = false))
    }

    @Test
    fun 화면이_켜진_채_떠나면_유예가_없다() {
        // 전화·홈·앱 전환은 언제나 사람이 한 일이다 — 0초에 일어나도 사람이다.
        assertEquals(
            LeavingScreenDecision.DISMISS,
            decide(screenOff = false, seenUnlocked = false, elapsedSinceShownMs = 0L),
        )
    }

    @Test
    fun 전원_버튼은_잠금화면에서도_끈다() {
        assertEquals(
            LeavingScreenDecision.DISMISS,
            decide(screenOff = true, seenUnlocked = false, elapsedSinceShownMs = 3_000L),
        )
    }

    @Test
    fun 쓰던_폰이면_전원_버튼이_곧바로_든다() {
        // 손에 들고 있던 폰이 그 순간 주머니로 들어갈 일은 없다 — 유예를 걸지 않는다.
        assertEquals(
            LeavingScreenDecision.DISMISS,
            decide(screenOff = true, seenUnlocked = true, elapsedSinceShownMs = 0L),
        )
    }

    @Test
    fun 덮여_있는데_화면이_꺼지면_잠금_여부도_시간도_보지_않는다() {
        // ⚠ 가장 무서운 오탐. 잠금을 안 쓰는 폰에서는 `seenUnlocked` 가 첫 프레임에 true 라
        //   유예가 아예 안 걸리고, 배낭 덮개가 8초 열렸다 닫히면 유예를 지나 버린다.
        //   덮임은 시간이 아니라 **사실**이라 두 구멍을 한꺼번에 막는다.
        assertEquals(
            LeavingScreenDecision.MACHINE_TURNED_SCREEN_OFF,
            decide(screenOff = true, screenCovered = true, seenUnlocked = true, elapsedSinceShownMs = 60_000L),
        )
    }

    @Test
    fun 덮여_있어도_화면이_켜진_채_떠나면_끈다() {
        // 전화가 오면 화면은 켜진 채 통화 UI 가 덮는다 — 근접 센서가 near 여도 사람이 한 일이다.
        assertEquals(
            LeavingScreenDecision.DISMISS,
            decide(screenOff = false, screenCovered = true, seenUnlocked = false),
        )
    }

    @Test
    fun 잠긴_기기에서_뜬_직후_꺼진_화면은_기계로_본다() {
        // 가방·주머니·플립커버. 유일하게 남은 오탐 방어선이다.
        assertEquals(
            LeavingScreenDecision.MACHINE_TURNED_SCREEN_OFF,
            decide(screenOff = true, seenUnlocked = false, elapsedSinceShownMs = 2_999L),
        )
    }

    @Test
    fun 끄기_다시알림으로_이미_끝냈으면_두_번_끄지_않는다() {
        // 두 번 끄면 무료 테마 클립 회전이 두 칸 전진해 클립 하나를 건너뛴다.
        assertEquals(LeavingScreenDecision.ALREADY_HANDLED, decide(handled = true))
    }

    @Test
    fun 같은_화면이_한_번_더_열려_밀려났으면_끄지_않는다() {
        // ⚠ 2026-09-09 SM-A325N 실기기: 알림의 전체화면 인텐트가 울림 화면을 한 번 더 열어
        //   `CLEAR_TASK` 가 먼저 뜬 인스턴스를 파괴했고, 그 onStop 이 '떠났다' 로 읽혀
        //   **알람이 2초 만에 스스로 꺼졌다.**
        assertEquals(LeavingScreenDecision.SUPERSEDED, decide(superseded = true))
    }

    @Test
    fun 설정_변경으로_다시_만들어지는_중이면_끄지_않는다() {
        // onStop 은 회전·설정 변경에서도 온다. 이걸 '떠났다' 로 읽으면 그 한 번이 알람을 끝낸다.
        assertEquals(LeavingScreenDecision.RECREATING, decide(changingConfigurations = true))
    }

    @Test
    fun 남의_알람은_끄지_않는다() {
        // A 가 울리는 중 B 로 인계될 수 있다. 이 화면의 알람이 지금 울리는 알람이 아니면 손대지 않는다.
        assertEquals(LeavingScreenDecision.NOT_THE_RINGING_ALARM, decide(isActiveRingingAlarm = false))
    }

    @Test
    fun 우선순위는_안전한_쪽부터다() {
        assertEquals(
            LeavingScreenDecision.ALREADY_HANDLED,
            decide(handled = true, superseded = true, changingConfigurations = true, screenOff = true, seenUnlocked = false),
        )
        assertEquals(
            LeavingScreenDecision.NOT_THE_RINGING_ALARM,
            decide(isActiveRingingAlarm = false, screenOff = true, seenUnlocked = false, elapsedSinceShownMs = 0L),
        )
    }
}
