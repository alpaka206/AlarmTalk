package com.alarmtalk.app.data

import java.time.LocalDate

/**
 * 한국 음력 기반 공휴일(설날·추석·부처님오신날)을 기기에서 직접 계산하는 엔진.
 *
 * 동작 우선순위(가장 권위 있는 것 우선)는 [HolidayCalendarStore.holidayPredicate] 가 결정한다:
 *   1. 서버 캐시(Room `source="server_sync"`) — cachedDates 에서 먼저 가로챈다.
 *   2. 시드(`HolidaySeedData` → `source="bundled_seed"`) — 2026~2029 의 연휴(±1일)까지 포함, 역시 cachedDates.
 *   3. THIS 엔진 — 시드가 없는 연도(2025-, 2030+)의 설날/추석/부처님오신날 + 대체공휴일.
 *   4. [LocalHolidayCalendar] 의 양력 고정 + 대체 규칙.
 * cachedDates 가 먼저 short-circuit 하므로, 이 엔진은 [LocalHolidayCalendar.isHoliday] 안에서만 OR 로 결합된다.
 *
 * 이 엔진은 법정 "기준일"(설날 음 1/1, 추석 음 8/15, 부처님오신날 음 4/8)과 대체공휴일만 계산한다.
 * 연휴(연속) 날짜는 의도적으로 시드/서버가 담당한다.
 *
 * iOS [HolidayStore.swift] 의 `LocalHolidayCalendar` 가 날짜 단위로 동일하게 재현해야 하는 모델이다
 * (iOS 는 추후 NSCalendar(.chinese) + 동일 KST 보정으로 이 날짜들을 맞춘다).
 *
 * 구조 결정(테스트 가능성): 순수 [LocalDate] 만 다루는 대체공휴일 규칙([KoreanHolidaySubstituteRules])과
 * 프레임워크 ICU 에 의존하는 음→양 변환([LunarConverter])을 분리한다. 전자는 JVM 단위 테스트로,
 * 후자는 instrumented 테스트(에뮬레이터/기기, 실제 framework ICU)로 검증한다.
 * desktop OpenJDK 에는 `android.icu.util.ChineseCalendar` 가 없어 순수 JVM 테스트로는 로드되지 않는다.
 */
object LunarHolidayCalendar {
    /** 변환기 주입 지점. 기본은 framework ICU 기반. 테스트에서 교체 가능. */
    @Volatile
    var converter: LunarConverter = IcuLunarConverter

    /** 음력 1/1. */
    private const val LUNAR_MONTH_SEOLLAL = 1
    private const val LUNAR_DAY_SEOLLAL = 1

    /** 음력 4/8 (윤4월이 있어도 항상 평달 4월). */
    private const val LUNAR_MONTH_BUDDHA = 4
    private const val LUNAR_DAY_BUDDHA = 8

    /** 음력 8/15. */
    private const val LUNAR_MONTH_CHUSEOK = 8
    private const val LUNAR_DAY_CHUSEOK = 15

    /**
     * 해당 양력 [year] 에 속하는 음력 공휴일 기준일(설날·부처님오신날·추석)의 양력 날짜 목록.
     * 대체공휴일은 포함하지 않는다.
     */
    fun koreanLunarHolidays(year: Int): List<LocalDate> =
        listOfNotNull(
            seollal(year),
            buddhasBirthday(year),
            chuseok(year),
        )

    /** [date] 가 (그 양력 연도의) 음력 공휴일 기준일 집합에 속하는지. */
    fun isKoreanLunarHoliday(date: LocalDate): Boolean =
        date in koreanLunarHolidays(date.year)

    /** 설날(음 1/1). */
    fun seollal(year: Int): LocalDate? =
        converter.lunarToGregorian(year, LUNAR_MONTH_SEOLLAL, LUNAR_DAY_SEOLLAL, leap = false)

    /** 부처님오신날(음 4/8). 윤4월이 있어도 첫 4월을 사용하므로 항상 leap=false. */
    fun buddhasBirthday(year: Int): LocalDate? =
        converter.lunarToGregorian(year, LUNAR_MONTH_BUDDHA, LUNAR_DAY_BUDDHA, leap = false)

    /** 추석(음 8/15). */
    fun chuseok(year: Int): LocalDate? =
        converter.lunarToGregorian(year, LUNAR_MONTH_CHUSEOK, LUNAR_DAY_CHUSEOK, leap = false)
}

/**
 * 음력(월/일)을 주어진 양력 연도의 양력 [LocalDate] 로 변환한다.
 * 결과는 (gregorianYear, lunarMonth/day) 만의 함수여야 하며, JVM 기본 TimeZone 에 의존하지 않는다.
 */
fun interface LunarConverter {
    /**
     * @param gregorianYear 결과가 속해야 할 양력 연도. 음력 새해는 1~2월에 들 수 있으므로
     *   변환 후 이 연도와 다른 결과는 버린다(설날이 1월이어도 그 양력 연도에 귀속).
     * @param lunarMonth 1-based 음력 월.
     * @param lunarDayOneBased 1-based 음력 일.
     * @param leap 윤달 여부.
     * @return 양력 날짜. 해당 연도에 존재하지 않으면(윤달 필터 등) null.
     */
    fun lunarToGregorian(
        gregorianYear: Int,
        lunarMonth: Int,
        lunarDayOneBased: Int,
        leap: Boolean,
    ): LocalDate?
}
