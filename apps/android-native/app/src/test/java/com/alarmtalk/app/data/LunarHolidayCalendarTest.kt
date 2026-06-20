package com.alarmtalk.app.data

import java.time.LocalDate
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 음력 공휴일 엔진의 **순수 로직**(대체공휴일 규칙 + 변환기 통합)을 JVM 단위 테스트로 검증한다.
 *
 * 설계(risk #2 (c)안): `android.icu.util.ChineseCalendar` 는 Android 프레임워크 클래스라
 * desktop OpenJDK 에서 로드되지 않는다. 따라서 여기서는 음→양 변환을 [FakeLunarConverter] 로 주입해
 * KASI(=시드) 공식 날짜를 고정 입력으로 주고, **대체공휴일 규칙과 통합 동작**만 검증한다.
 * 실제 ICU 변환(KST 보정 포함)은 instrumented 테스트(`LunarHolidayCalendarInstrumentedTest`)가 담당한다.
 *
 * [KoreanHolidaySubstituteRules] 와 [LunarHolidayCalendar] 의 비-ICU 경로는 순수 [LocalDate] 함수이므로
 * 결과가 JVM 기본 TimeZone 에 의존하지 않아야 한다 — UTC / Asia/Seoul / America/Los_Angeles 에서 반복 검증.
 */
class LunarHolidayCalendarTest {

    private var originalZone: TimeZone? = null

    /** KASI 공식(시드와 동일) 음력 기준일. 변환기 결과의 ground truth. */
    private val seollalByYear = mapOf(
        2025 to LocalDate.of(2025, 1, 29),
        2026 to LocalDate.of(2026, 2, 17),
        2027 to LocalDate.of(2027, 2, 7),
        2028 to LocalDate.of(2028, 1, 27),
        2029 to LocalDate.of(2029, 2, 13),
        2030 to LocalDate.of(2030, 2, 3),
        2031 to LocalDate.of(2031, 1, 23),
    )
    private val chuseokByYear = mapOf(
        2025 to LocalDate.of(2025, 10, 6),
        2026 to LocalDate.of(2026, 9, 25),
        2027 to LocalDate.of(2027, 9, 15),
        2028 to LocalDate.of(2028, 10, 3),
        2029 to LocalDate.of(2029, 9, 22),
        2030 to LocalDate.of(2030, 9, 12),
        2031 to LocalDate.of(2031, 10, 1),
    )
    private val buddhaByYear = mapOf(
        2025 to LocalDate.of(2025, 5, 5),
        2026 to LocalDate.of(2026, 5, 24),
        2027 to LocalDate.of(2027, 5, 13),
        2028 to LocalDate.of(2028, 5, 2),
        2029 to LocalDate.of(2029, 5, 20),
        2030 to LocalDate.of(2030, 5, 9),
        2031 to LocalDate.of(2031, 5, 28),
    )

    private inner class FakeLunarConverter : LunarConverter {
        override fun lunarToGregorian(
            gregorianYear: Int,
            lunarMonth: Int,
            lunarDayOneBased: Int,
            leap: Boolean,
        ): LocalDate? = when {
            lunarMonth == 1 && lunarDayOneBased == 1 -> seollalByYear[gregorianYear]
            lunarMonth == 4 && lunarDayOneBased == 8 -> buddhaByYear[gregorianYear]
            lunarMonth == 8 && lunarDayOneBased == 15 -> chuseokByYear[gregorianYear]
            else -> null
        }
    }

    @Before
    fun setUp() {
        originalZone = TimeZone.getDefault()
        LunarHolidayCalendar.converter = FakeLunarConverter()
    }

    @After
    fun tearDown() {
        originalZone?.let { TimeZone.setDefault(it) }
        LunarHolidayCalendar.converter = IcuLunarConverter
    }

    private val zones = listOf("UTC", "Asia/Seoul", "America/Los_Angeles")

    private fun underEachZone(block: () -> Unit) {
        for (zone in zones) {
            TimeZone.setDefault(TimeZone.getTimeZone(zone))
            block()
        }
    }

    // --- 음력 기준일(대체 없음) ------------------------------------------------

    @Test
    fun seollalMatchesSeedDates() = underEachZone {
        assertEquals(LocalDate.of(2026, 2, 17), LunarHolidayCalendar.seollal(2026))
        assertEquals(LocalDate.of(2027, 2, 7), LunarHolidayCalendar.seollal(2027))
        assertEquals(LocalDate.of(2028, 1, 27), LunarHolidayCalendar.seollal(2028))
        assertEquals(LocalDate.of(2029, 2, 13), LunarHolidayCalendar.seollal(2029))
    }

    @Test
    fun chuseokMatchesSeedDates() = underEachZone {
        assertEquals(LocalDate.of(2026, 9, 25), LunarHolidayCalendar.chuseok(2026))
        assertEquals(LocalDate.of(2027, 9, 15), LunarHolidayCalendar.chuseok(2027))
        assertEquals(LocalDate.of(2028, 10, 3), LunarHolidayCalendar.chuseok(2028))
        assertEquals(LocalDate.of(2029, 9, 22), LunarHolidayCalendar.chuseok(2029))
    }

    @Test
    fun buddhasBirthdayMatchesSeedDates() = underEachZone {
        assertEquals(LocalDate.of(2026, 5, 24), LunarHolidayCalendar.buddhasBirthday(2026))
        assertEquals(LocalDate.of(2027, 5, 13), LunarHolidayCalendar.buddhasBirthday(2027))
        assertEquals(LocalDate.of(2028, 5, 2), LunarHolidayCalendar.buddhasBirthday(2028))
        assertEquals(LocalDate.of(2029, 5, 20), LunarHolidayCalendar.buddhasBirthday(2029))
    }

    @Test
    fun koreanLunarHolidaysAreMembershipTested() = underEachZone {
        assertTrue(LunarHolidayCalendar.isKoreanLunarHoliday(LocalDate.of(2026, 2, 17)))
        assertTrue(LunarHolidayCalendar.isKoreanLunarHoliday(LocalDate.of(2026, 9, 25)))
        assertTrue(LunarHolidayCalendar.isKoreanLunarHoliday(LocalDate.of(2026, 5, 24)))
        assertFalse(LunarHolidayCalendar.isKoreanLunarHoliday(LocalDate.of(2026, 2, 16))) // 연휴(시드 담당)
        assertFalse(LunarHolidayCalendar.isKoreanLunarHoliday(LocalDate.of(2026, 9, 26))) // 연휴(시드 담당)
    }

    @Test
    fun outOfSeedYearsAreComputed() = underEachZone {
        // 시드 밖(2025-, 2030+) 도 변환기만 있으면 계산된다.
        assertEquals(LocalDate.of(2025, 10, 6), LunarHolidayCalendar.chuseok(2025))
        assertEquals(LocalDate.of(2030, 2, 3), LunarHolidayCalendar.seollal(2030))
        assertEquals(LocalDate.of(2031, 1, 23), LunarHolidayCalendar.seollal(2031))
    }

    // --- 대체공휴일 (LocalHolidayCalendar.isHoliday 통합) ---------------------------

    @Test
    fun buddhaSundaySubstituteMatchesSeed2026() = underEachZone {
        // 2026 부처님오신날 5/24(일) → 대체 5/25(월).
        assertTrue(LocalHolidayCalendar.isHoliday(LocalDate.of(2026, 5, 25)))
    }

    @Test
    fun buddhaSundaySubstituteMatchesSeed2029() = underEachZone {
        // 2029 부처님오신날 5/20(일) → 대체 5/21(월).
        assertTrue(LocalHolidayCalendar.isHoliday(LocalDate.of(2029, 5, 21)))
    }

    @Test
    fun chuseokSundayInBlockSubstituteMatchesSeed2029() = underEachZone {
        // 2029 추석 9/22(토), 블록 [9/21,9/22,9/23] 중 9/23(일) 포함 → 대체 9/24(월).
        assertTrue(LocalHolidayCalendar.isHoliday(LocalDate.of(2029, 9, 24)))
    }

    @Test
    fun chuseokGaecheonjeolOverlap2028ProducesSingleSubstitute() = underEachZone {
        // 2028 추석 10/3 이 개천절 10/3 과 겹침 → 대체 1일 10/5(목). 이중 계산 없음.
        assertTrue(LocalHolidayCalendar.isHoliday(LocalDate.of(2028, 10, 5)))
        // 추석 블록의 추가 대체나 잘못된 10/4 대체가 생기면 안 된다(10/4 는 추석 연휴=시드 담당이라 엔진 비방출).
        assertFalse(LunarHolidayCalendar.isKoreanLunarHoliday(LocalDate.of(2028, 10, 4)))
    }

    @Test
    fun substituteRulesAreDeterministicGivenAnchors2029() {
        // 순수 규칙 직접 검증: 어린이날 5/5(토) → 대체, 부처님오신날 5/20(일) → 대체, 추석 블록 일요일 → 대체.
        val fixed = setOf(
            LocalDate.of(2029, 1, 1),
            LocalDate.of(2029, 3, 1),
            LocalDate.of(2029, 5, 5),
            LocalDate.of(2029, 6, 6),
            LocalDate.of(2029, 8, 15),
            LocalDate.of(2029, 10, 3),
            LocalDate.of(2029, 10, 9),
            LocalDate.of(2029, 12, 25),
        )
        val subs = KoreanHolidaySubstituteRules.substitutes(
            year = 2029,
            fixedHolidays = fixed,
            seollal = LocalDate.of(2029, 2, 13),
            chuseok = LocalDate.of(2029, 9, 22),
            buddha = LocalDate.of(2029, 5, 20),
        )
        assertTrue(LocalDate.of(2029, 5, 7) in subs)  // 어린이날(토) 대체
        assertTrue(LocalDate.of(2029, 5, 21) in subs) // 부처님오신날(일) 대체
        assertTrue(LocalDate.of(2029, 9, 24) in subs) // 추석 블록 일요일 대체
    }

    @Test
    fun newYearAndMemorialDayNeverSubstituted() = underEachZone {
        // 신정 1/1, 현충일 6/6 은 제3조 제외 — 주말이어도 대체 없음.
        // 2023-01-01 은 일요일이지만 1/1 대체는 발생하지 않는다(엔진 기준 연도 무관 규칙).
        val subs2023 = KoreanHolidaySubstituteRules.substitutes(
            year = 2023,
            fixedHolidays = setOf(LocalDate.of(2023, 1, 1), LocalDate.of(2023, 6, 6)),
            seollal = null,
            chuseok = null,
            buddha = null,
        )
        assertFalse(LocalDate.of(2023, 1, 2) in subs2023)
        assertTrue(subs2023.isEmpty())
    }

    @Test
    fun solarHolidayObservedRuleIsNotRegressed() = underEachZone {
        // 2026 삼일절 3/1(일) → 대체 3/2(월) (기존 월요일 규칙도 잡던 케이스).
        assertTrue(LocalHolidayCalendar.isHoliday(LocalDate.of(2026, 3, 2)))
        // 2026 광복절 8/15(토) → 대체 8/17(월) (기존 월요일 규칙도 잡던 케이스).
        assertTrue(LocalHolidayCalendar.isHoliday(LocalDate.of(2026, 8, 17)))
    }
}
