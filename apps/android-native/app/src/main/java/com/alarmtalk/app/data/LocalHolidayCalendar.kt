package com.alarmtalk.app.data

import java.time.LocalDate

object LocalHolidayCalendar {
    fun isHoliday(date: LocalDate): Boolean =
        isHoliday(countryCode = HolidayCalendarStore.DEFAULT_COUNTRY_CODE, date = date)

    fun isHoliday(countryCode: String, date: LocalDate): Boolean =
        when (countryCode.uppercase()) {
            // 우선순위: cachedDates(서버/시드) → THIS(양력 고정 + 음력 + 대체) → (없음).
            // cachedDates 가 holidayPredicate 에서 먼저 short-circuit 하므로, 여기서는 시드 밖 연도까지
            // 양력 고정·음력 기준일·대체공휴일을 투명하게 잡아준다. 공개 시그니처는 그대로다.
            "KR" ->
                isKoreanFixedHoliday(date) ||
                    LunarHolidayCalendar.isKoreanLunarHoliday(date) ||
                    isKoreanObservedHoliday(date)
            else -> false
        }

    private fun isKoreanFixedHoliday(date: LocalDate): Boolean =
        (date.monthValue to date.dayOfMonth) in KOREAN_FIXED_DAYS

    /**
     * 일반화된 대체공휴일 판정. 기존 "월요일 한정" 규칙([isKoreanObservedFixedHoliday]) 대신
     * 양력 고정 + 음력(설날/추석/부처님오신날) 기준일 전체에 [KoreanHolidaySubstituteRules] 를 적용한다.
     * 기존 월요일 규칙은 이 superset 의 부분집합이므로 양력 동작은 보존되거나 확장된다(절대 후퇴 없음).
     */
    private fun isKoreanObservedHoliday(date: LocalDate): Boolean =
        date in koreanSubstitutes(date.year)

    /** 해당 양력 연도의 대체공휴일 집합(양력 고정 + 음력 기준일 기반). */
    private fun koreanSubstitutes(year: Int): Set<LocalDate> {
        val fixed = KOREAN_FIXED_DAYS.mapTo(mutableSetOf()) { (month, day) -> LocalDate.of(year, month, day) }
        return KoreanHolidaySubstituteRules.substitutes(
            year = year,
            fixedHolidays = fixed,
            seollal = LunarHolidayCalendar.seollal(year),
            chuseok = LunarHolidayCalendar.chuseok(year),
            buddha = LunarHolidayCalendar.buddhasBirthday(year),
        )
    }

    /** 양력 고정 공휴일 (월, 일). 신정·삼일절·어린이날·현충일·광복절·개천절·한글날·기독탄신일. */
    private val KOREAN_FIXED_DAYS = setOf(
        1 to 1,    // 신정
        3 to 1,    // 삼일절
        5 to 5,    // 어린이날
        6 to 6,    // 현충일
        8 to 15,   // 광복절
        10 to 3,   // 개천절
        10 to 9,   // 한글날
        12 to 25,  // 기독탄신일
    )
}
