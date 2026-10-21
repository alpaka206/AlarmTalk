package com.alarmtalk.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReceivedAlarmLabelDisplayTest {
    @Test
    fun `세 언어의 기본 이름은 제목에서 빼고 직접 지은 이름은 보존한다`() {
        for (label in listOf("알람", "Alarm", "アラーム", "", "  ")) assertNull(customRingingAlarmLabel(label))
        assertEquals("출근", customRingingAlarmLabel("  출근  "))
    }
}
