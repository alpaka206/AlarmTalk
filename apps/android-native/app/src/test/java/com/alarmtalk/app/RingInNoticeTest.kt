package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.rehearsalCloneAlarm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 알람을 켠 순간 화면 아래에 잠깐 띄우는 "N 후에 울려요."(`docs/spec/alarm-editor.md` §7).
 *
 * - 대상은 **반영된 뒤의 그 알람**이다 — 켜진 행이면 그 행의 예약 시각, 꺼진 행이면 띄우지 않는다.
 * - 문장은 홈 헤드라인과 **같은 함수**(`ringInSentence`)다. 올림이라 1분 미만도 "1분" 이고, 날짜 지정 알람은 그 날짜까지다.
 * - 오류·성공이 아니라 **정보** 색으로 뜬다(세 언어 모두).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RingInNoticeTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun `켜진 알람은 그 알람의 예약 시각으로 안내한다`() {
        val saved = rehearsalCloneAlarm(id = "morning").copy(enabled = true, fireAtMillis = NOW + 7 * HOUR)

        assertEquals(RingInNotice(alarmId = "morning", fireAtMillis = NOW + 7 * HOUR), ringInNoticeFor(saved))
    }

    @Test
    fun `꺼진 알람은 안내하지 않는다`() {
        // 끄기가 반영된 행 — 울릴 시각이 없다.
        assertNull(ringInNoticeFor(rehearsalCloneAlarm().copy(enabled = false, fireAtMillis = NOW + HOUR)))
    }

    @Test
    @Config(qualifiers = "ko")
    fun `문장은 홈 헤드라인과 같고 1분 미만도 1분이다`() {
        assertEquals("1분 후에 울려요.", ringInSentence(context, fireAtMillis = NOW + 30_000L, nowMillis = NOW))
        assertEquals("1분 후에 울려요.", ringInSentence(context, fireAtMillis = NOW + MINUTE, nowMillis = NOW))
        assertEquals(
            "7시간 30분 후에 울려요.",
            ringInSentence(context, fireAtMillis = NOW + 7 * HOUR + 30 * MINUTE, nowMillis = NOW),
        )
    }

    @Test
    @Config(qualifiers = "ko")
    fun `날짜 지정 알람은 그 날짜까지 남은 시간이다`() {
        assertEquals(
            "2일 3시간 후에 울려요.",
            ringInSentence(context, fireAtMillis = NOW + 2 * DAY + 3 * HOUR, nowMillis = NOW),
        )
    }

    @Test
    @Config(qualifiers = "ko")
    fun `한국어 안내는 정보 색이다`() = assertInfoInEveryShape()

    @Test
    @Config(qualifiers = "en")
    fun `영어 안내는 정보 색이다`() = assertInfoInEveryShape()

    @Test
    @Config(qualifiers = "ja")
    fun `일본어 안내는 정보 색이다`() = assertInfoInEveryShape()

    /** 분만·시간과 분·날짜와 시간 — 실제로 뜰 세 모양 모두. */
    private fun assertInfoInEveryShape() {
        listOf(30_000L, 7 * HOUR + 30 * MINUTE, 2 * DAY + 3 * HOUR).forEach { remaining ->
            val sentence = ringInSentence(context, fireAtMillis = NOW + remaining, nowMillis = NOW)
            assertEquals(sentence, MessageSeverity.Info, snackbarSeverity(context, sentence))
        }
    }

    private companion object {
        const val NOW = 1_800_000_000_000L
        const val MINUTE = 60_000L
        const val HOUR = 60 * MINUTE
        const val DAY = 24 * HOUR
    }
}
