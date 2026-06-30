package com.alarmtalk.app.data

import java.time.DayOfWeek
import java.time.LocalDate

/**
 * 대체공휴일 규칙 엔진 (관공서의 공휴일에 관한 규정 제3조, 2023 개정 반영).
 *
 * 순수 함수: 입력은 양력 고정 + 음력 기준일의 [LocalDate], 출력은 추가되는 대체공휴일 집합.
 * 프레임워크(ICU)에 의존하지 않으므로 JVM 단위 테스트로 직접 검증 가능하다(설계 결정, risk #2 (c)안).
 *
 * 규칙:
 *   A) 설날·추석(3일 블록 = 전날/당일/다음날): 블록 중 하루라도 **일요일**이거나, 블록 중 하루가 다른
 *      공휴일과 겹치면 대체 1일 부여 → 블록 끝(다음날) 이후 첫 비공휴일 평일.
 *      (토요일 자체는 설날·추석 대체를 트리거하지 않음 — 일요일 또는 겹침만.)
 *   B) 부처님오신날 + 어린이날(5/5) + 삼일절(3/1)·광복절(8/15)·개천절(10/3)·한글날(10/9)·기독탄신일(12/25):
 *      토요일 또는 일요일이면 대체 → 다음 비공휴일 평일. (어린이날은 다른 공휴일과 같은 날 겹쳐도 대체.)
 *   C) 겹침: 대체일은 "주말도 아니고 이미 공휴일도 아닌" 첫 다음날로 굴러간다(인접/누적 공휴일을 건너뜀).
 *   D) 신정(1/1)·현충일(6/6): 대체 없음(제3조 제외).
 *
 * 2028 예시(겹침 비중복): 추석 10/3 이 개천절 10/3 과 겹침 → 추석 블록 겹침 규칙이 대체 1일(10/5) 부여.
 *   개천절 10/3 은 화요일이라 주말 규칙은 발화하지 않음 → 대체는 정확히 1일(10/5). 이중 계산 금지.
 */
object KoreanHolidaySubstituteRules {

    /**
     * 주어진 [year] 의 대체공휴일 집합.
     *
     * @param fixedHolidays 그 해의 양력 고정 공휴일(신정·삼일절·어린이날·현충일·광복절·개천절·한글날·기독탄신일).
     *   설날/추석 블록의 "다른 공휴일 겹침" 판정과 대체일 충돌 회피에 쓰인다.
     * @param seollal 설날 당일(음 1/1). 없으면 null.
     * @param chuseok 추석 당일(음 8/15). 없으면 null.
     * @param buddha 부처님오신날(음 4/8). 없으면 null.
     */
    fun substitutes(
        year: Int,
        fixedHolidays: Set<LocalDate>,
        seollal: LocalDate?,
        chuseok: LocalDate?,
        buddha: LocalDate?,
    ): Set<LocalDate> {
        val result = sortedSetOf<LocalDate>()
        val childrensDay = LocalDate.of(year, 5, 5)

        // 충돌/겹침 판정 집합 = 양력 고정 + 음력 기준일 + 누적 확정 대체일.
        val occupied = fixedHolidays.toMutableSet()
        listOfNotNull(seollal, chuseok, buddha).forEach { occupied.add(it) }

        fun addSubstitute(from: LocalDate) {
            val sub = nextFreeWeekday(from, occupied)
            result.add(sub)
            occupied.add(sub)
        }

        // 설날/추석 블록이 "자신 외 다른 공휴일"과 겹치는지: 블록의 어느 날이 양력 고정 공휴일이거나
        // 다른 음력 기준일과 같은 날인지.
        fun blockOverlapsOther(block: List<LocalDate>, selfAnchor: LocalDate): Boolean {
            val otherLunar = listOfNotNull(seollal, chuseok, buddha).filter { it != selfAnchor }
            return block.any { it in fixedHolidays || it in otherLunar }
        }

        // A) 설날·추석 3일 블록: 일요일 포함 또는 다른 공휴일 겹침이면 대체.
        seollal?.let { day ->
            val block = listOf(day.minusDays(1), day, day.plusDays(1))
            val triggers = block.any { it.dayOfWeek == DayOfWeek.SUNDAY } || blockOverlapsOther(block, day)
            if (triggers) addSubstitute(block.last())
        }
        chuseok?.let { day ->
            val block = listOf(day.minusDays(1), day, day.plusDays(1))
            val triggers = block.any { it.dayOfWeek == DayOfWeek.SUNDAY } || blockOverlapsOther(block, day)
            if (triggers) addSubstitute(block.last())
        }

        // B) 주말(토/일) 대체 대상: 부처님오신날 + 양력 단일 공휴일.
        val weekendEligible = buildList {
            buddha?.let { add(it) }
            add(LocalDate.of(year, 3, 1))   // 삼일절
            add(childrensDay)               // 어린이날
            add(LocalDate.of(year, 8, 15))  // 광복절
            add(LocalDate.of(year, 10, 3))  // 개천절
            add(LocalDate.of(year, 10, 9))  // 한글날
            add(LocalDate.of(year, 12, 25)) // 기독탄신일
        }
        // 어린이날(5/5)은 다른 공휴일(부처님오신날 등)과 같은 날에 겹쳐도 대체.
        val childrensDayOverlapsOther = listOfNotNull(seollal, chuseok, buddha).any { it == childrensDay }
        for (holiday in weekendEligible) {
            val isWeekend = holiday.dayOfWeek == DayOfWeek.SATURDAY || holiday.dayOfWeek == DayOfWeek.SUNDAY
            val overlaps = holiday == childrensDay && childrensDayOverlapsOther
            if (isWeekend || overlaps) addSubstitute(holiday)
        }

        return result
    }

    /** [from] 이후(미포함) 첫 평일이면서 [occupied] 에 없는 날짜. */
    private fun nextFreeWeekday(from: LocalDate, occupied: Set<LocalDate>): LocalDate {
        var candidate = from.plusDays(1)
        while (
            candidate.dayOfWeek == DayOfWeek.SATURDAY ||
            candidate.dayOfWeek == DayOfWeek.SUNDAY ||
            candidate in occupied
        ) {
            candidate = candidate.plusDays(1)
        }
        return candidate
    }
}
