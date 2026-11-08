package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.datedFireAtMillis
import com.alarmtalk.app.data.rehearsalCloneAlarm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 알람을 켠 순간 화면 아래에 잠깐 띄우는 "N 후에 울려요."(`docs/spec/alarm-editor.md` §7).
 *
 * - **언제**: 저장·스위치가 반영된 뒤의 그 행으로만 바뀐다(`after`). 켜진 행이면 그 알람이 안내가 되고, 끄거나 지운 알람은
 *   그 알람의 안내만 거두며, 화면이 다 띄운 안내를 소진해도 그 사이 들어온 새 안내는 남는다. 실패 갈래가 이걸 부르지 않는
 *   것은 `RingInNoticeWiringTest` 가 본다.
 * - **띄울지**: 하단 탭에서만, 아직 맞는 말일 때만(`ringInAction`). 하위 화면이면 버리지 않고 기다린다.
 * - **무엇을**: 홈 헤드라인과 같은 함수(`ringInSentence`)다. 올림이라 1분 미만도 "1분" 이고 날짜 지정 알람은 그 날짜까지다.
 * - **색**: 오류·성공이 아니라 정보로 뜬다(세 언어 모두).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RingInNoticeTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    /** 아무 안내도 없는 처음 상태. */
    private val noNotice: RingInNotice? = null

    // ── 언제 ──────────────────────────────────────────────────────────────────────────────

    @Test
    fun `켜진 행이 반영되면 그 알람의 예약 시각으로 안내한다`() {
        assertEquals(
            RingInNotice(alarmId = "a", fireAtMillis = NOW + 7 * HOUR, announcedAtElapsedMillis = T0),
            noNotice.after(RingInEvent.Applied(alarm("a", fireAtMillis = NOW + 7 * HOUR), T0)),
        )
    }

    @Test
    fun `끄기가 반영된 행은 안내를 만들지 않는다`() {
        assertNull(noNotice.after(RingInEvent.Applied(alarm("a", enabled = false), T0)))
    }

    @Test
    fun `A 를 켠 뒤 B 를 끄면 A 의 안내는 그대로다`() {
        val shown = checkNotNull(noNotice.after(RingInEvent.Applied(alarm("a"), T0)))

        assertEquals(shown, shown.after(RingInEvent.Applied(alarm("b", enabled = false), T0 + 500)))
    }

    @Test
    fun `A 를 켠 뒤 A 를 끄면 안내를 거둔다`() {
        val shown = checkNotNull(noNotice.after(RingInEvent.Applied(alarm("a"), T0)))

        assertNull(shown.after(RingInEvent.Applied(alarm("a", enabled = false), T0 + 500)))
    }

    @Test
    fun `A 를 켠 뒤 B 를 지우면 그대로고 A 를 지우면 거둔다`() {
        val shown = checkNotNull(noNotice.after(RingInEvent.Applied(alarm("a"), T0)))

        assertEquals(shown, shown.after(RingInEvent.Deleted("b")))
        assertNull(shown.after(RingInEvent.Deleted("a")))
    }

    @Test
    fun `여러 개를 지우면 한 개씩 와서 그 가운데 안내 중인 알람만 거둔다`() {
        var notice = noNotice.after(RingInEvent.Applied(alarm("b"), T0))
        notice = notice.after(RingInEvent.Deleted("a"))
        assertEquals("b", notice?.alarmId)
        notice = notice.after(RingInEvent.Deleted("b"))
        assertNull(notice.after(RingInEvent.Deleted("c")))
    }

    @Test
    fun `A 를 켠 뒤 B 를 켜면 방금 켠 B 를 말한다`() {
        val notice = noNotice
            .after(RingInEvent.Applied(alarm("a", fireAtMillis = NOW + 7 * HOUR), T0))
            .after(RingInEvent.Applied(alarm("b", fireAtMillis = NOW + 9 * HOUR), T0 + 800))

        assertEquals(RingInNotice("b", NOW + 9 * HOUR, T0 + 800), notice)
    }

    @Test
    fun `띄운 A 를 소진할 때 그 사이 들어온 B 는 남긴다`() {
        val a = checkNotNull(noNotice.after(RingInEvent.Applied(alarm("a"), T0)))
        val b = checkNotNull(a.after(RingInEvent.Applied(alarm("b"), T0 + 800)))
        assertEquals("b", b.alarmId)

        assertEquals(b, b.after(RingInEvent.Finished(a)))
    }

    @Test
    fun `띄운 그 안내를 소진하면 비운다`() {
        val a = checkNotNull(noNotice.after(RingInEvent.Applied(alarm("a"), T0)))

        assertNull(a.after(RingInEvent.Finished(a)))
    }

    @Test
    fun `같은 알람을 끄고 다시 켠 안내는 앞 안내의 소진에 지워지지 않는다`() {
        // 화면은 앞 안내(켬)를 걷으며 그것을 소진한다 — 같은 알람·같은 시각이어도 다시 켠 안내는 남아야 다시 뜬다.
        val first = checkNotNull(noNotice.after(RingInEvent.Applied(alarm("a"), T0)))
        val again = first
            .after(RingInEvent.Applied(alarm("a", enabled = false), T0 + 300))
            .after(RingInEvent.Applied(alarm("a"), T0 + 600))
        assertEquals(RingInNotice("a", first.fireAtMillis, T0 + 600), again)

        assertEquals(again, again.after(RingInEvent.Finished(first)))
    }

    // ── 띄울지 ────────────────────────────────────────────────────────────────────────────

    @Test
    fun `하위 화면에서는 버리지 않고 기다렸다가 탭이 돌아오면 띄운다`() {
        // 저장 직후 — 안내는 생겼는데 편집기가 아직 닫히는 중이다.
        val notice = RingInNotice("a", NOW + 7 * HOUR, T0)

        assertEquals(RingInAction.Wait, ringInAction(notice, onTabScreen = false, nowMillis = NOW, nowElapsedMillis = T0 + 50))
        assertEquals(RingInAction.Show, ringInAction(notice, onTabScreen = true, nowMillis = NOW + 300, nowElapsedMillis = T0 + 300))
    }

    @Test
    fun `그 시각이 지난 안내는 띄우지 않는다`() {
        // 1분 뒤 알람을 저장하는 중에 화면을 껐고, 그 사이 알람이 울렸다 — "1분 후에 울려요." 라고 말하면 거짓이다.
        val notice = RingInNotice("a", NOW + MINUTE, T0)

        assertEquals(
            RingInAction.Drop,
            ringInAction(notice, onTabScreen = true, nowMillis = NOW + MINUTE, nowElapsedMillis = T0 + 1_000),
        )
        assertEquals(
            RingInAction.Drop,
            ringInAction(notice, onTabScreen = true, nowMillis = NOW + 2 * MINUTE, nowElapsedMillis = T0 + 1_000),
        )
    }

    @Test
    fun `생긴 지 오래도록 못 뜬 안내는 띄우지 않는다`() {
        val notice = RingInNotice("a", NOW + 7 * HOUR, T0)

        assertEquals(
            RingInAction.Show,
            ringInAction(notice, onTabScreen = true, nowMillis = NOW, nowElapsedMillis = T0 + RING_IN_NOTICE_FRESH_MILLIS),
        )
        // 화면이 꺼져 있다 돌아왔다 — 그 사이 알람이 울려 다음 회차로 갔거나 꺼졌을 수 있다.
        assertEquals(
            RingInAction.Drop,
            ringInAction(notice, onTabScreen = true, nowMillis = NOW, nowElapsedMillis = T0 + RING_IN_NOTICE_FRESH_MILLIS + 1),
        )
    }

    // ── 무엇을 ────────────────────────────────────────────────────────────────────────────

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
        val trip = datedAlarm(id = "trip", targetDate = "2026-11-12")
        val notice = checkNotNull(noNotice.after(RingInEvent.Applied(trip, T0)))

        assertEquals(trip.datedFireAtMillis(), notice.fireAtMillis)
        val twoDaysThreeHoursBefore = notice.fireAtMillis - (2 * DAY + 3 * HOUR)
        assertEquals("2일 3시간 후에 울려요.", ringInSentence(context, notice.fireAtMillis, twoDaysThreeHoursBefore))
    }

    @Test
    fun `날짜가 지난 날짜 지정 알람의 안내는 띄우지 않는다`() {
        val trip = datedAlarm(id = "trip", targetDate = "2026-11-12")
        val notice = checkNotNull(noNotice.after(RingInEvent.Applied(trip, T0)))

        assertEquals(
            RingInAction.Drop,
            ringInAction(notice, onTabScreen = true, nowMillis = trip.fireAtMillis + HOUR, nowElapsedMillis = T0),
        )
    }

    // ── 색 ────────────────────────────────────────────────────────────────────────────────

    @Test
    fun `안내 색 표에 올라 있다 — 표에 없어 안내로 떨어지는 것과 다르다`() {
        // 표에 없는 글도 안내로 뜨지만(`SnackbarSeverityIndex.severityOf` 의 기본값), 그러면 더 넓은 틀을 가진 다른 문구가
        // 이 문장을 가져갈 수 있다. 표에 올려 두면 이 틀이 이긴다.
        assertTrue(R.string.hs_status_ring_in in SnackbarSeverities.info)
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

    private fun alarm(id: String, enabled: Boolean = true, fireAtMillis: Long = NOW + 7 * HOUR): AlarmEntity =
        rehearsalCloneAlarm(id = id).copy(enabled = enabled, fireAtMillis = fireAtMillis)

    /** 날짜 지정 알람 — 예약 시각은 그 날짜·시간대의 7시(저장소가 정하는 값과 같은 계산)다. */
    private fun datedAlarm(id: String, targetDate: String): AlarmEntity {
        val row = rehearsalCloneAlarm(id = id).copy(
            hour = 7,
            minute = 0,
            repeatDaysMask = 0,
            targetDate = targetDate,
            targetTimezone = "Asia/Seoul",
            enabled = true,
        )
        return row.copy(fireAtMillis = checkNotNull(row.datedFireAtMillis()))
    }

    private companion object {
        const val NOW = 1_800_000_000_000L
        const val T0 = 5_000_000L
        const val MINUTE = 60_000L
        const val HOUR = 60 * MINUTE
        const val DAY = 24 * HOUR
    }
}
