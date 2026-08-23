package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.gson.Gson
import com.alarmtalk.app.data.fortuneThemeIndex
import com.alarmtalk.app.network.FamilyAlarmQuietWindow
import com.alarmtalk.app.network.FamilyGroupMember
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// 라벨 함수가 Context(앱 리소스)에 의존하므로 Robolectric 으로 실행한다.
// 기본 로케일(values/ = 한국어)이 로드되어 기존 한국어 단언이 그대로 통과한다.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class AlarmEditorScreenTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun familyAlarmQuietScheduleFallsBackWhenQuietWindowsIsNull() {
        val member = Gson().fromJson(
            """
            {
              "id": "member-id",
              "user_id": "recipient-id",
              "role": "member",
              "joined_at": "2026-05-11T00:00:00.000Z",
              "email": "recipient@example.com",
              "name": "Recipient",
              "allow_family_alarms": true,
              "family_alarm_quiet_days": [1, 2, 3, 4, 5],
              "family_alarm_quiet_start": "09:00",
              "family_alarm_quiet_end": "18:30",
              "family_alarm_quiet_windows": null
            }
            """.trimIndent(),
            FamilyGroupMember::class.java,
        )

        val label = familyAlarmQuietScheduleLabel(context, member)

        assertTrue(label.contains("09:00-18:30"))
    }

    @Test
    fun familyAlarmTimeUnavailableWhenSelectedTimeIsInsideRecipientQuietWindow() {
        val member = member(
            windows = listOf(FamilyAlarmQuietWindow(days = listOf(1, 2, 3, 4, 5), start = "09:00", end = "18:30")),
        )

        assertTrue(
            isFamilyAlarmTimeUnavailable(
                member = member,
                hour = 10,
                minute = 0,
                repeatDaysMask = 1 shl 1,
            ),
        )
    }

    @Test
    fun familyAlarmTimeAvailableWhenSelectedTimeIsOutsideRecipientQuietWindow() {
        val member = member(
            windows = listOf(FamilyAlarmQuietWindow(days = listOf(1, 2, 3, 4, 5), start = "09:00", end = "18:30")),
        )

        assertFalse(
            isFamilyAlarmTimeUnavailable(
                member = member,
                hour = 6,
                minute = 0,
                repeatDaysMask = 1 shl 1,
            ),
        )
    }

    /**
     * ⚠ **분 단위 숫자를 다시 박지 말 것.** 예전 이름은
     * `familyAlarmLeadRequiresAtLeastThirtyMinutes` 였고 6:20/6:30 을 고정으로 넣어
     * **30분을 지키고 있었다.** 리드타임을 5분으로 내렸을 때 세 상수(서버·안드·iOS)는
     * 고쳤는데 이 테스트만 남아, 값이 맞는데도 CI 가 빨간불이 됐다.
     *
     * 그래서 경계는 [FAMILY_ALARM_MIN_LEAD_MILLIS] 에서 **계산해서** 쓴다 — 값이 바뀌면
     * 테스트도 따라 움직이고, 지키는 것은 숫자가 아니라 **경계의 방향**이다.
     */
    @Test
    fun familyAlarmLeadRejectsTimesInsideTheMinimumLead() {
        val nowMillis = LocalDateTime.of(2026, 5, 11, 6, 0)
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()
        val leadMinutes = (FAMILY_ALARM_MIN_LEAD_MILLIS / 60_000L).toInt()

        // 상한 바로 안쪽(1분 모자람) → 막는다.
        val tooSoon = LocalDateTime.of(2026, 5, 11, 6, 0).plusMinutes(leadMinutes - 1L)
        assertTrue(
            isFamilyAlarmLeadTooSoon(
                hour = tooSoon.hour,
                minute = tooSoon.minute,
                repeatDaysMask = 0,
                holidayOff = false,
                nowMillis = nowMillis,
            ),
        )
        // 정확히 상한 → 통과한다(판정은 `<` 이므로 경계값은 허용이다).
        val exactly = LocalDateTime.of(2026, 5, 11, 6, 0).plusMinutes(leadMinutes.toLong())
        assertFalse(
            isFamilyAlarmLeadTooSoon(
                hour = exactly.hour,
                minute = exactly.minute,
                repeatDaysMask = 0,
                holidayOff = false,
                nowMillis = nowMillis,
            ),
        )
    }

    @Test
    fun repeatSummaryShowsNextOneShotDateOrWeeklyDays() {
        val zoneId = ZoneId.of("UTC")
        val nowMillis = LocalDateTime.of(2026, 5, 13, 8, 0)
            .atZone(zoneId)
            .toInstant()
            .toEpochMilli()

        assertEquals("오늘 - 5월 13일(수)", repeatSummaryLabel(context, 8, 30, 0, nowMillis, zoneId))
        assertEquals("내일 - 5월 14일(목)", repeatSummaryLabel(context, 7, 30, 0, nowMillis, zoneId))
        assertEquals(
            "매주 월, 화, 수",
            repeatSummaryLabel(context, 7, 30, (1 shl 1) or (1 shl 2) or (1 shl 3), nowMillis, zoneId),
        )
    }

    @Test
    fun fortuneThemeIndexIsDeterministicPerDayAndInRange() {
        // 같은 사람·같은 날은 항상 같은 테마(결정적, 오프라인 재생 일관성).
        val a = fortuneThemeIndex("female", "1995-05-19", "07:30", "2026-07-14", 5)
        val b = fortuneThemeIndex("female", "1995-05-19", "07:30", "2026-07-14", 5)
        assertEquals(a, b)
        assertTrue(a in 0..4)
        // 날짜가 바뀌면 테마가 갈릴 수 있다(매일 신선).
        val overDays = (10..25).map {
            fortuneThemeIndex("female", "1995-05-19", "07:30", "2026-07-$it", 5)
        }
        assertTrue(overDays.toSet().size > 1)
        // count<=0 방어.
        assertEquals(0, fortuneThemeIndex("x", "y", "z", "d", 0))
    }

    @Test
    fun voicePreviewContentDescriptionShowsPlaybackState() {
        assertEquals("미리듣기 재생", voicePreviewContentDescription(context, active = false, preparing = false))
        assertEquals("미리듣기 준비 중", voicePreviewContentDescription(context, active = false, preparing = true))
        // 이 토글은 일시정지가 아니라 정지다(다시 누르면 처음부터 재생) — 아이콘·문구를 그에 맞췄다.
        assertEquals("미리듣기 정지", voicePreviewContentDescription(context, active = true, preparing = false))
    }

    private fun member(
        windows: List<FamilyAlarmQuietWindow>? = listOf(FamilyAlarmQuietWindow()),
    ): FamilyGroupMember =
        FamilyGroupMember(
            id = "member-id",
            userId = "recipient-id",
            role = "member",
            joinedAt = "2026-05-11T00:00:00.000Z",
            email = "recipient@example.com",
            name = "Recipient",
            allowFamilyAlarms = true,
            familyAlarmQuietWindows = windows,
        )
}
