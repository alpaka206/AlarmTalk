package com.alarmtalk.app.alarm

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 리시버→서비스 인계 표시.
 *
 * 이 표시가 없거나 덮이면 예약 정합성 워커가 그 알람을 '안 울리는 중' 으로 보고 **이미 지난
 * 시각**(스누즈 마감)을 그대로 다시 등록해 한 번 더 울린다(Codex #666 P2).
 *
 * 정적 상태를 공유하므로 테스트마다 **다른 알람 id** 를 쓰고, 같은지(equals)가 아니라
 * 들어 있는지(contains)로 본다 — 다른 테스트가 남긴 표시에 의존하지 않기 위해서다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RingingHandoffMarkersTest {

    @Test
    fun keepsEveryPendingHandoffWhenTwoAlarmsArriveBeforeTheirService() {
        // 지연·스누즈 마감이 겹쳐 두 알람이 연달아 배달된 상황. 서비스는 아직 안 떴다.
        RingingService.markAlarmHandoff("handoff-pair-b")
        RingingService.markAlarmHandoff("handoff-pair-c")

        val ids = RingingService.ringingOrHandingOffAlarmIds()

        assertTrue(
            "나중에 온 인계가 앞엣것을 덮으면 앞 알람이 무방비가 된다 — 실제 값: $ids",
            ids.containsAll(listOf("handoff-pair-b", "handoff-pair-c")),
        )
    }

    @Test
    fun anUnmarkedAlarmIsNotReportedAsHandingOff() {
        assertFalse(
            "표시한 적 없는 알람이 보호 대상으로 잡히면, 굳은 행이 복구에서 영구 배제된다",
            "handoff-never-marked" in RingingService.ringingOrHandingOffAlarmIds(),
        )
    }
}
