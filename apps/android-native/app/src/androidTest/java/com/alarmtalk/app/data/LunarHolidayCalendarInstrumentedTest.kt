package com.alarmtalk.app.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.LocalDate
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 실제 framework ICU([android.icu.util.ChineseCalendar]) 기반 음→양 변환(KST 보정 포함)을
 * 에뮬레이터/기기에서 검증한다. desktop OpenJDK 에는 해당 클래스가 없어 JVM 단위 테스트로는 못 돌린다.
 *
 * ground truth = KASI(한국천문연구원) 공식 민간력(= Android 시드 = iOS 시드와 동일).
 * ICU 버전 드리프트가 한 해라도 어긋나면 여기서 큰 소리로 실패하도록 2024~2031 하드코딩 표를 단언한다(risk #1).
 *
 * zone 독립성: JVM 기본 TimeZone 을 UTC / Asia/Seoul / America/Los_Angeles 로 바꿔도 동일 결과여야 한다
 * (변환은 (gregorianYear, lunar m/d) 만의 함수 — device-zone 누수 금지).
 */
@RunWith(AndroidJUnit4::class)
class LunarHolidayCalendarInstrumentedTest {

    private var originalZone: TimeZone? = null

    // 설날(음 1/1) — KASI.
    private val seollal = mapOf(
        2024 to LocalDate.of(2024, 2, 10),
        2025 to LocalDate.of(2025, 1, 29),
        2026 to LocalDate.of(2026, 2, 17),
        2027 to LocalDate.of(2027, 2, 7),
        2028 to LocalDate.of(2028, 1, 27),
        2029 to LocalDate.of(2029, 2, 13),
        2030 to LocalDate.of(2030, 2, 3),
        2031 to LocalDate.of(2031, 1, 23),
    )

    // 추석(음 8/15) — KASI.
    private val chuseok = mapOf(
        2024 to LocalDate.of(2024, 9, 17),
        2025 to LocalDate.of(2025, 10, 6),
        2026 to LocalDate.of(2026, 9, 25),
        2027 to LocalDate.of(2027, 9, 15),
        2028 to LocalDate.of(2028, 10, 3),
        2029 to LocalDate.of(2029, 9, 22),
        2030 to LocalDate.of(2030, 9, 12),
        2031 to LocalDate.of(2031, 10, 1),
    )

    // 부처님오신날(음 4/8) — KASI.
    private val buddha = mapOf(
        2024 to LocalDate.of(2024, 5, 15),
        2025 to LocalDate.of(2025, 5, 5),
        2026 to LocalDate.of(2026, 5, 24),
        2027 to LocalDate.of(2027, 5, 13),
        2028 to LocalDate.of(2028, 5, 2),
        2029 to LocalDate.of(2029, 5, 20),
        2030 to LocalDate.of(2030, 5, 9),
        2031 to LocalDate.of(2031, 5, 28),
    )

    private val zones = listOf("UTC", "Asia/Seoul", "America/Los_Angeles")

    @Before
    fun setUp() {
        originalZone = TimeZone.getDefault()
        // instrumented 환경에서도 기본 변환기(framework ICU)를 강제.
        LunarHolidayCalendar.converter = IcuLunarConverter
    }

    @After
    fun tearDown() {
        originalZone?.let { TimeZone.setDefault(it) }
    }

    @Test
    fun icuConversionMatchesKasiTableAcrossZones() {
        for (zone in zones) {
            TimeZone.setDefault(TimeZone.getTimeZone(zone))
            for (year in 2024..2031) {
                assertEquals("설날 $year ($zone)", seollal[year], IcuLunarConverter.lunarToGregorian(year, 1, 1, false))
                assertEquals("추석 $year ($zone)", chuseok[year], IcuLunarConverter.lunarToGregorian(year, 8, 15, false))
                assertEquals("부처님오신날 $year ($zone)", buddha[year], IcuLunarConverter.lunarToGregorian(year, 4, 8, false))
            }
        }
    }

    @Test
    fun isHolidayCatchesComputedLunarDatesOutOfSeedRange() {
        // 시드 밖(2030+) 설날/추석/부처님오신날을 엔진이 잡는다.
        assertEquals(true, LocalHolidayCalendar.isHoliday(LocalDate.of(2030, 2, 3)))   // 설날
        assertEquals(true, LocalHolidayCalendar.isHoliday(LocalDate.of(2030, 9, 12)))  // 추석
        assertEquals(true, LocalHolidayCalendar.isHoliday(LocalDate.of(2031, 5, 28)))  // 부처님오신날
    }
}
