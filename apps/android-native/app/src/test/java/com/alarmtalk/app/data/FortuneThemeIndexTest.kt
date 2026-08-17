package com.alarmtalk.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * 운세 테마 선택은 **두 앱이 같은 답을 내야 한다.** 한 사람이 폰과 아이폰을 같이 쓰면
 * 같은 날 같은 운세를 들어야 하는데, 이건 네트워크 없이 각 기기가 따로 계산하는 값이라
 * 산식이 조금만 어긋나도 조용히 갈라진다(둘 다 '그럴듯한' 값이 나오므로 눈치채기 어렵다).
 *
 * ⚠ **아래 표는 iOS `BucketVariantResolverTests.test_fortuneThemeIndex_matchesAndroid` 와
 * 글자 하나까지 같아야 한다.** 한쪽을 고치면 다른 쪽 테스트가 깨지도록 양쪽에 박아 둔다.
 */
class FortuneThemeIndexTest {

    @Test
    fun matchesTheSharedCrossPlatformTable() {
        val cases = listOf(
            Case("여자", "1994-03-02", "05:30", "2026-08-18", 9, 3),
            Case("남자", "1988-11-27", "", "2026-08-18", 9, 6),
            Case("여자", "1994-03-02", "05:30", "2026-08-19", 9, 4),
        )
        for (c in cases) {
            assertEquals(
                "seed=${c.gender}|${c.birthDate}|${c.birthTime}|${c.date}",
                c.expected,
                fortuneThemeIndex(c.gender, c.birthDate, c.birthTime, c.date, c.count),
            )
        }
    }

    @Test
    fun trimsTheSameWayOnBothPlatforms() {
        // 공백 처리가 갈리면 같은 사람이 기기마다 다른 운세를 듣는다.
        assertEquals(
            fortuneThemeIndex("여자", "1994-03-02", "05:30", "2026-08-18", 9),
            fortuneThemeIndex(" 여자 ", "1994-03-02 ", " 05:30", "2026-08-18", 9),
        )
    }

    @Test
    fun changesWithTheDay() {
        assertNotEquals(
            fortuneThemeIndex("여자", "1994-03-02", "05:30", "2026-08-18", 9),
            fortuneThemeIndex("여자", "1994-03-02", "05:30", "2026-08-19", 9),
        )
    }

    private data class Case(
        val gender: String,
        val birthDate: String,
        val birthTime: String,
        val date: String,
        val count: Int,
        val expected: Int,
    )
}
