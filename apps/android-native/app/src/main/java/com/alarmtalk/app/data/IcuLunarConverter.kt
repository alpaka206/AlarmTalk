package com.alarmtalk.app.data

import android.icu.util.ChineseCalendar
import android.icu.util.TimeZone as IcuTimeZone
import java.time.LocalDate

/**
 * framework ICU([android.icu.util.ChineseCalendar]) 기반 음→양 변환기.
 *
 * KST 보정(핵심 위험):
 *   [android.icu.util.ChineseCalendar] 는 천문 기준 자오선을 중국표준시(CST, UTC+8, 120°E)로 고정한다.
 *   기기/지역 zone 도, 한국(UTC+9)도 아니다. 신월(삭)·절기 순간이 UTC+8 자정 경계로 계산된다.
 *   한국은 음력 민간력에 UTC+9(135°E)를 쓰므로, 대략 15:00~16:00 UTC 저녁 구간에 발생한 신월은
 *   UTC+8 에서는 D일, UTC+9 에서는 D+1일(또는 그 반대)이 될 수 있다. 그 신월이 "달의 시작"이면
 *   그 달 전체(설날/추석/부처님오신날)가 한국 공식 달력 대비 정확히 하루 어긋난다(문서화된 off-by-one).
 *   예: 설날 2027 삭 = 02-07 00:55 KST = 02-06 23:55 CST → CST 자정 버킷으로는 2/6(하루 빠름),
 *       설날 2028 삭 = 01-27 00:12 KST = 01-26 23:12 CST → 1/26(하루 빠름).
 *
 *   변환 방향이 음→양(주어진 양력 연도 안에서 음력 월/일을 양력으로)이라 윤달·연 경계 모호성은
 *   "결과 양력 연도 != 요청 연도면 폐기"로 결정적으로 걸러진다. 남는 위험은 위 신월 경계의 ±1일뿐이다.
 *
 *   보정 전략(iOS 엔진과 동일한 일반 해법): iOS 는 .chinese / .gregorian 캘린더를 모두
 *   TimeZone(Asia/Seoul) 로 고정해 "민간일(civil day) 버킷팅"을 KST 자정 경계에서 수행한다.
 *   Android 도 이를 그대로 미러한다 — [ChineseCalendar] 의 timeZone 을 Asia/Seoul(UTC+9)로 두고,
 *   getTimeInMillis()(그 음력일 00:00 KST 의 UTC epoch)를 KST 자정 기준으로 [LocalDate] 로 환산한다.
 *   이러면 신월 경계가 KST 자정으로 잡혀 2027/2028 같은 경계 연도도 KASI 와 일치하며, 시드 밖
 *   미래 연도까지 같은 원리로 정확하다. (ICU 의 천문 자오선 자체는 여전히 CST 고정이지만, 우리가 읽는
 *   값은 "그 음력일이 시작되는 KST 민간일"이라 일관된다.)
 *
 *   [KST_CORRECTION_DAYS] 는 만에 하나 ICU 버전 드리프트로 특정 연도가 여전히 ±1 어긋날 때를 위한
 *   escape hatch(명시적 override)다. timeZone 고정만으로 대상 연도가 전부 맞으면 비워 둔다.
 *
 * zone 독립성: 결과는 (gregorianYear, lunar m/d) 만의 함수여야 한다. ZoneId.systemDefault() 나
 *   JVM 기본 TimeZone 을 경유하지 않는다. [ChineseCalendar] 는 명시적 고정 TimeZone(Asia/Seoul)으로
 *   생성하고 getTimeInMillis()(= UTC epoch)를 KST 자정 기준으로 환산해 bare [LocalDate] 만 방출한다.
 *   (테스트는 TZ=UTC / Asia/Seoul / America/Los_Angeles 에서 동일해야 함.)
 *
 * EXTENDED_YEAR: ICU epoch 이 2637 BCE 이므로 EXTENDED_YEAR = gregorianYear + 2637.
 *   ERA/YEAR(60간지) 대신 EXTENDED_YEAR + MONTH + DAY_OF_MONTH 를 set 해 60년 주기 모호성을 회피한다.
 *   IS_LEAP_MONTH 는 세 공휴일 모두 명시적으로 0 으로 둔다(부처님오신날은 윤4월에도 첫 4월 사용).
 */
object IcuLunarConverter : LunarConverter {
    /** ICU 의 EXTENDED_YEAR 기준 = gregorianYear + 2637 (epoch 2637 BCE). */
    private const val ICU_EPOCH_OFFSET = 2637

    private const val DAY_MS = 24L * 60L * 60L * 1000L
    private const val KST_OFFSET_MS = 9L * 60L * 60L * 1000L

    /**
     * KASI 민간력 대비 ICU off-by-one 이 *그래도* 남을 때를 위한 escape hatch:
     * (gregorianYear, lunarMonth) → 보정일(±1) override 맵.
     * 민간일 버킷팅을 KST 자정으로 고정([KST])한 뒤로는 알려진 경계 연도(2027/2028 포함)가 모두
     * KASI 와 일치하므로 비어 있다 — 이 맵이 비었다는 것은 "timeZone 고정만으로 충분"하다는 사실의 정직한 표현이다.
     * 미래 ICU 버전 드리프트로 특정 연도가 어긋나면(instrumented 테스트가 큰 소리로 잡음) 여기에 항목을 추가한다.
     * (예: 만약 2027/2028 이 여전히 빠르면 (2027,1)->+1, (2028,1)->+1 을 등록.)
     */
    private val KST_CORRECTION_DAYS: Map<Pair<Int, Int>, Int> = emptyMap()

    /** 민간일(civil day) 버킷팅 기준 zone = 한국표준시(KST, UTC+9).
     *  iOS 엔진이 .chinese/.gregorian 을 Asia/Seoul 로 고정한 것을 미러한다. [ChineseCalendar] 의
     *  timeZone 을 이것으로 두면 신월 경계가 KST 자정에서 잡혀 China-meridian off-by-one 이 사라진다.
     *  lazy 로 둬서 단순히 [IcuLunarConverter] 를 참조(예: 기본 변환기 할당)하는 것만으로는
     *  `android.icu` 클래스를 로드하지 않게 한다 — JVM 단위 테스트가 fake 변환기를 주입할 여지를 준다. */
    private val KST: IcuTimeZone by lazy { IcuTimeZone.getTimeZone("Asia/Seoul") }

    override fun lunarToGregorian(
        gregorianYear: Int,
        lunarMonth: Int,
        lunarDayOneBased: Int,
        leap: Boolean,
    ): LocalDate? {
        val raw = readLunarDate(gregorianYear, lunarMonth, lunarDayOneBased, leap)
            ?: return null
        val correction = KST_CORRECTION_DAYS[gregorianYear to lunarMonth] ?: 0
        val corrected = raw.plusDays(correction.toLong())
        // 설날이 1월이어도 그 양력 연도에 귀속. 다른 연도로 떨어진 결과(윤달/연 경계 잡음)는 폐기.
        return corrected.takeIf { it.year == gregorianYear }
    }

    /**
     * ICU 가 KST(UTC+9) 민간일 기준으로 둔 양력 날짜를 읽는다.
     * 음력 1월은 양력 1~2월이라 같은 음력 연도가 두 양력 연도에 걸치므로,
     * EXTENDED_YEAR 후보를 {year, year-1, year+1} 로 시도해 요청 연도에 맞는 결과를 고른다.
     */
    private fun readLunarDate(
        gregorianYear: Int,
        lunarMonth: Int,
        lunarDayOneBased: Int,
        leap: Boolean,
    ): LocalDate? {
        for (extendedYear in intArrayOf(gregorianYear, gregorianYear - 1, gregorianYear + 1)) {
            val date = chineseCalendarToLocalDate(extendedYear, lunarMonth, lunarDayOneBased, leap)
            if (date.year == gregorianYear) {
                return date
            }
        }
        return null
    }

    /** EXTENDED_YEAR + 음력 월/일을 set 한 ChineseCalendar 를 KST 자정 기준 양력 [LocalDate] 로 환산. */
    private fun chineseCalendarToLocalDate(
        extendedYear: Int,
        lunarMonth: Int,
        lunarDayOneBased: Int,
        leap: Boolean,
    ): LocalDate {
        val calendar = ChineseCalendar(KST).apply {
            clear()
            set(ChineseCalendar.EXTENDED_YEAR, extendedYear + ICU_EPOCH_OFFSET)
            set(ChineseCalendar.MONTH, lunarMonth - 1)
            set(ChineseCalendar.IS_LEAP_MONTH, if (leap) 1 else 0)
            set(ChineseCalendar.DAY_OF_MONTH, lunarDayOneBased)
        }
        // getTimeInMillis() = 그 음력일 00:00(KST) 의 UTC epoch millis. KST 자정 기준으로 다시 환산해
        // systemDefault/Instant 경유 없이 bare LocalDate 를 얻는다(민간일 버킷팅이 KST 에서 일어남).
        return LocalDate.ofEpochDay(Math.floorDiv(calendar.timeInMillis + KST_OFFSET_MS, DAY_MS))
    }
}
