package com.alarmtalk.app


import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 홈 헤드라인 "N분 후에 울려요" 의 분 계산.
 *
 * ⚠ 2026-09-09 실기기 제보: **1분 뒤 알람이 "2분 후" 로 떴다.** 원인은 이 식이 아니라
 * 남은 시간을 재는 **현재 시각이 얼어 있던 것**이었다(`HomeHeader` 주석 참조).
 * 그래도 식을 고정해 둔다 — 앞으로 이 증상이 다시 나오면 **여기가 아니라 시각 쪽**을
 * 봐야 한다는 것을 이 테스트가 말해 준다.
 *
 * 판정 기준은 '몇 초 낡았나' 가 아니라 **'분 경계를 몇 번 넘겼나'** 다. 알람 시각의 초가
 * 0이면(`AlarmTimeCalculator` 가 그렇게 만든다) 같은 분 안에서는 몇 초가 지나도 라벨이
 * 같다 — 아래 `같은_분_안에서는_라벨이_변하지_않는다` 가 그걸 고정한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class RemainingDurationLabelTest {

    @Test
    fun 정각_1분은_1분이다() {
        assertEquals("1분", remainingDurationLabel(60_000L))
    }

    @Test
    fun 같은_분_안에서는_라벨이_변하지_않는다() {
        // 알람은 10:43:00, 현재 시각이 10:42:00 ~ 10:42:59 사이 어디든 "1분" 이어야 한다.
        // 여기가 깨지면 몇 초짜리 낡음만으로도 표시가 흔들린다는 뜻이다.
        for (elapsedMs in 0L until 60_000L step 1_000L) {
            val remaining = 60_000L - elapsedMs
            assertEquals("$elapsedMs ms 지난 시점", "1분", remainingDurationLabel(remaining))
        }
    }

    @Test
    fun 경계를_한_번_넘기면_한_칸_틀린다() {
        // 얼어붙은 시각이 분 경계를 하나 넘긴 상태 = 제보된 증상.
        assertEquals("1분", remainingDurationLabel(60_000L))
        assertEquals("2분", remainingDurationLabel(60_001L))
        assertEquals("2분", remainingDurationLabel(120_000L))
    }

    @Test
    fun 영분이라고_말하지_않는다() {
        // 1분 미만도 "1분" 이다 — '곧 울려요' 분기를 되살리지 않기로 한 결정(2026-08-18)의 짝.
        assertEquals("1분", remainingDurationLabel(1L))
        assertEquals("1분", remainingDurationLabel(0L))
        assertEquals("1분", remainingDurationLabel(-5_000L))
    }

    @Test
    fun 상위_두_단위만_말한다() {
        val threeHoursTen = 3 * 60 * 60_000L + 10 * 60_000L
        assertEquals("3시간 10분", remainingDurationLabel(threeHoursTen))
        assertEquals("3시간", remainingDurationLabel(3 * 60 * 60_000L))
        val twoDaysFive = 2 * 24 * 60 * 60_000L + 5 * 60 * 60_000L + 7 * 60_000L
        assertEquals("2일 5시간", remainingDurationLabel(twoDaysFive))
    }

    @Test
    fun 초가_붙은_알람은_한_칸_커진다() {
        // ⚠ 다시 울림은 "지금부터 5분" 이라 초가 0이 아니다(`AlarmRepository.snooze`).
        //   그런 알람은 시계가 10:40 인데 "2분 후" 로 읽힐 수 있다 — 식이 틀린 게 아니라
        //   올림이 정직한 것이다. **이걸 고치겠다고 스누즈를 분 단위로 자르지 말 것**
        //   (그러면 '5분 뒤' 가 4분 23초가 된다).
        assertEquals("2분", remainingDurationLabel(97_000L))
    }
}
