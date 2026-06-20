import Foundation

// MARK: - KoreanLunarHolidayEngine
//
// 한국 음력 공휴일(설날·추석·부처님오신날)과 대체공휴일(관공서의 공휴일에 관한 규정 제3조)을
// 서버 동기화/번들 시드 없이 ON-DEVICE 로 계산하는 엔진.
//
// === 폴백 체인에서의 위치 (LocalHolidayCalendar 내부, OR 결합) ===
//   1. server cache    (source == "server_sync")          — HolidayStore.isHoliday 가 먼저 검사
//   2. bundled seed     (source == "bundled_seed")          — HolidayStore.isHoliday 가 먼저 검사
//   3. COMPUTED ENGINE  (본 파일: 음력 + 대체공휴일)         — LocalHolidayCalendar 내부
//   4. fixed-solar      (isKoreanFixedHoliday)               — LocalHolidayCalendar 내부
//
// 모든 레이어가 Bool 을 OR 결합하므로 체인은 boolean SUPERSET 이다. 더 권위 있는 소스(서버·시드)는
// 엔진이 놓친 휴일을 ADD 만 할 수 있고 SUBTRACT 는 못 한다. "휴일이면 알람 skip" 시맨틱에서 엔진은
// 오프라인 보장 FLOOR 이므로 안전하다. (de-dup/override 불필요 — 라벨 집합이 아니라 Bool 반환.)
//
// === KST 보정 (핵심 정확성 이슈) ===
// Apple 의 Calendar(identifier: .chinese) 는 음력 월 경계를 중국표준시(UTC+8)로 계산한다.
// 한국 민용 음력(KASI/한국천문연구원, 설날·추석의 법적 근거)은 KST(UTC+9)로 삭(신월) 순간이
// 속한 민용일을 정한다. 삭의 순간이 중국시 23:00~23:59 구간에 들면, 같은 순간이 한국시로는
// 이미 다음 날 00:00~00:59 이므로 그 해의 음력 월(=설날/추석)이 .chinese 원시값보다 양력 하루
// 늦게 떨어진다. 이 off-by-one 을 줄이기 위해:
//   (a) 모든 민용일 버킷팅/컴포넌트 추출을 Asia/Seoul 고정 캘린더로 수행한다. (UTC+8/디바이스로컬 금지)
//       이는 "삭 순간이 어느 민용일에 속하는가"를 KASI 방식으로 정렬하여 대다수 연도를 맞춘다.
//       또한 HolidaySeedData.ymd(역시 Asia/Seoul)와 같은 시계라서 epochDay 가 정확히 일치한다.
//   (b) ICU 의 천문 경계 자체는 CST 고정이라 (a)가 모든 희귀 연도를 증명하지는 못한다. 따라서 엔진을
//       체인의 3순위(서버 캐시·KASI 검증 시드 아래)에 둔다 — 발산 연도는 server_sync 또는 시드가 보정.
//   (c) kasiOverrides[year] 정적 테이블로 알려진 발산 연도를 코드 수정 없이 오프라인으로 pin.
//
// 모든 Date 생성/컴포넌트 추출/epochDay 도출은 고정 Asia/Seoul 캘린더만 사용한다 (Calendar.current 금지).
enum KoreanLunarHolidayEngine {

    // MARK: 음력 앵커 (gregorian 연도 → 음력 공휴일 양력 날짜 override 용)

    /// 알려진 KASI 발산 연도를 코드 변경 없이 핀하기 위한 escape hatch. 기본은 비어 있음.
    /// 키: gregorian 연도. 값: 해당 연도의 음력 앵커 양력 날짜(월/일).
    struct KoreanLunarAnchors {
        /// 설날 당일 (음력 1/1) 의 양력 (month, day)
        let seollalMonthDay: (Int, Int)
        /// 추석 당일 (음력 8/15) 의 양력 (month, day)
        let chuseokMonthDay: (Int, Int)
        /// 부처님오신날 (음력 4/8) 의 양력 (month, day)
        let buddhaMonthDay: (Int, Int)
    }

    /// 비어 있는 것이 기본. 알려진 KASI 발산 연도가 생기면 여기에 핀한다.
    /// 예) `[2031: KoreanLunarAnchors(...)]`
    static let kasiOverrides: [Int: KoreanLunarAnchors] = [:]

    // MARK: 고정 Asia/Seoul 캘린더 (엔진 전역에서 동일 시계 사용)

    /// 양력 민용일 계산용. epochDay/컴포넌트 추출/Date 생성 전부 이 인스턴스로.
    static let seoulGregorian: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul") ?? TimeZone(secondsFromGMT: 9 * 3600)!
        cal.locale = Locale(identifier: "en_US_POSIX")
        return cal
    }()

    /// 음력 월/일 추출용. KST 버킷팅으로 KASI 경계에 정렬.
    private static let seoulChinese: Calendar = {
        var cal = Calendar(identifier: .chinese)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul") ?? TimeZone(secondsFromGMT: 9 * 3600)!
        cal.locale = Locale(identifier: "en_US_POSIX")
        return cal
    }()

    // MARK: epochDay (1970-01-01 = 0), 항상 Asia/Seoul 기준

    /// LocalDate.toEpochDay 동등. HolidaySeedData.ymd 와 같은 Asia/Seoul 시계라 값이 정확히 일치.
    static func epochDay(of date: Date) -> Int {
        let cal = seoulGregorian
        let comps = cal.dateComponents([.year, .month, .day], from: date)
        guard let y = comps.year, let m = comps.month, let d = comps.day else { return 0 }
        return epochDay(year: y, month: m, day: d)
    }

    /// (양력 y/m/d) → epochDay. Asia/Seoul 자정 기준.
    static func epochDay(year: Int, month: Int, day: Int) -> Int {
        let cal = seoulGregorian
        let epochStart = cal.date(from: DateComponents(year: 1970, month: 1, day: 1))
            ?? Date(timeIntervalSince1970: 0)
        guard let target = cal.date(from: DateComponents(year: year, month: month, day: day)) else {
            return 0
        }
        return cal.dateComponents([.day], from: epochStart, to: target).day ?? 0
    }

    // MARK: 캐시 (per-gregorian-year). 공유 정적 상태이므로 lock 으로 보호.

    private struct YearHolidaySets {
        /// 음력 공휴일(설날 3일·추석 3일·부처님) epochDay 집합
        let lunar: Set<Int>
        /// 대체공휴일 epochDay 집합
        let substitute: Set<Int>
    }

    // 공유 정적 캐시. NSLock 으로 직렬화하므로 Swift 6 strict concurrency 하에서 nonisolated(unsafe) 로 표시.
    // (모든 접근은 sets(forYear:) 의 lock/unlock 사이에서만 일어난다.)
    private static let cacheLock = NSLock()
    private nonisolated(unsafe) static var cache: [Int: YearHolidaySets] = [:]

    private static func sets(forYear year: Int) -> YearHolidaySets {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if let cached = cache[year] { return cached }
        let computed = computeSets(forYear: year)
        cache[year] = computed
        return computed
    }

    // MARK: 공개 멤버십 테스트

    /// 설날·추석·부처님오신날(계산) 멤버십. countryCode 는 KR 전제(호출부에서 보장).
    static func isLunarHoliday(_ date: Date) -> Bool {
        let day = epochDay(of: date)
        let y = seoulGregorian.component(.year, from: date)
        // 설날/추석 연휴는 연말·연초 양력 경계를 넘을 수 있으므로 인접 연도까지 본다.
        return sets(forYear: y).lunar.contains(day)
            || sets(forYear: y - 1).lunar.contains(day)
            || sets(forYear: y + 1).lunar.contains(day)
    }

    /// 대체공휴일 멤버십. 제3조 규정대로 계산된 집합 기준.
    static func isSubstituteHoliday(_ date: Date) -> Bool {
        let day = epochDay(of: date)
        let y = seoulGregorian.component(.year, from: date)
        return sets(forYear: y).substitute.contains(day)
            || sets(forYear: y - 1).substitute.contains(day)
            || sets(forYear: y + 1).substitute.contains(day)
    }

    // MARK: 연도별 집합 계산

    private static func computeSets(forYear year: Int) -> YearHolidaySets {
        // 1) 음력 앵커(설날/추석/부처님)의 양력 epochDay 도출.
        let anchors = lunarAnchorEpochDays(forYear: year)

        // 2) 음력 공휴일 집합: 설날 3일 [-1,0,+1], 추석 3일 [-1,0,+1], 부처님 1일.
        var lunar = Set<Int>()
        if let seollal = anchors.seollal {
            lunar.insert(seollal - 1)
            lunar.insert(seollal)
            lunar.insert(seollal + 1)
        }
        if let chuseok = anchors.chuseok {
            lunar.insert(chuseok - 1)
            lunar.insert(chuseok)
            lunar.insert(chuseok + 1)
        }
        if let buddha = anchors.buddha {
            lunar.insert(buddha)
        }

        // 3) 대체공휴일 계산: 기본 공휴일(고정양력 + 음력, 대체 제외) 집합에 제3조 적용.
        let substitute = computeSubstituteDays(
            forYear: year,
            lunar: lunar,
            seollalDay1: anchors.seollal,
            chuseokDay15: anchors.chuseok,
            buddhaDay: anchors.buddha
        )

        return YearHolidaySets(lunar: lunar, substitute: substitute)
    }

    private struct AnchorEpochDays {
        let seollal: Int?   // 음력 1/1 의 epochDay
        let chuseok: Int?   // 음력 8/15 의 epochDay
        let buddha: Int?    // 음력 4/8 의 epochDay
    }

    /// 해당 gregorian 연도의 음력 앵커 양력 epochDay. override 가 있으면 우선.
    private static func lunarAnchorEpochDays(forYear year: Int) -> AnchorEpochDays {
        if let o = kasiOverrides[year] {
            return AnchorEpochDays(
                seollal: epochDay(year: year, month: o.seollalMonthDay.0, day: o.seollalMonthDay.1),
                chuseok: epochDay(year: year, month: o.chuseokMonthDay.0, day: o.chuseokMonthDay.1),
                buddha: epochDay(year: year, month: o.buddhaMonthDay.0, day: o.buddhaMonthDay.1)
            )
        }
        return AnchorEpochDays(
            seollal: gregorianEpochDay(forLunarMonth: 1, day: 1, gregorianYear: year, seedMonth: 2, seedDay: 1),
            chuseok: gregorianEpochDay(forLunarMonth: 8, day: 15, gregorianYear: year, seedMonth: 9, seedDay: 22),
            buddha: gregorianEpochDay(forLunarMonth: 4, day: 8, gregorianYear: year, seedMonth: 5, seedDay: 10)
        )
    }

    /// 주어진 음력(month, day)에 해당하는 양력 epochDay 를 gregorian 연도 Y 안에서 찾는다.
    /// seedMonth/seedDay 근방 ±25일 윈도우만 스캔(365일 전체 스캔 회피).
    /// isLeapMonth == true 는 거부 — calendar 순서상 첫 비윤달 일치가 표준 월.
    private static func gregorianEpochDay(
        forLunarMonth lunarMonth: Int,
        day lunarDay: Int,
        gregorianYear year: Int,
        seedMonth: Int,
        seedDay: Int
    ) -> Int? {
        let greg = seoulGregorian
        let chinese = seoulChinese
        guard let seed = greg.date(from: DateComponents(year: year, month: seedMonth, day: seedDay)) else {
            return nil
        }
        // 윈도우 시작: seed - 25일.
        guard let start = greg.date(byAdding: .day, value: -25, to: seed) else { return nil }

        var cursor = start
        // 51일 윈도우(±25)를 스캔.
        for _ in 0...50 {
            // month/day/isLeapMonth 를 한 번에 요청(개별 요청 시 isLeapMonth 미채움 가능성 회피).
            let comps = chinese.dateComponents([.month, .day, .isLeapMonth], from: cursor)
            let isLeap = comps.isLeapMonth ?? false
            if comps.month == lunarMonth, comps.day == lunarDay, isLeap == false {
                // 이 양력 일자가 반드시 gregorianYear 안에 있어야 한다 (윈도우가 연 경계 근처일 때 보호).
                let gy = greg.component(.year, from: cursor)
                if gy == year {
                    return epochDay(of: cursor)
                }
            }
            guard let next = greg.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return nil
    }

    // MARK: 대체공휴일 (관공서의 공휴일에 관한 규정 제3조)

    /// 제3조 대체공휴일 계산.
    /// - SET A (설날·추석 각 3일): 그 날이 "일요일" 이거나 다른 공휴일과 겹칠 때만 대체. (토요일 X)
    /// - SET B (삼일절·광복절·개천절·한글날·어린이날·부처님오신날·기독탄신일):
    ///        그 날이 "토/일" 이거나 다른 공휴일과 겹칠 때 대체.
    /// - 신정(1/1)·현충일(6/6): 대체 없음.
    /// - 배치: 원래 공휴일 블록 뒤의 "공휴일도 주말도 아닌 첫 날" 로 전진 cascade.
    private static func computeSubstituteDays(
        forYear year: Int,
        lunar: Set<Int>,
        seollalDay1: Int?,
        chuseokDay15: Int?,
        buddhaDay: Int?
    ) -> Set<Int> {
        // 1) 기본 공휴일(대체 제외) 집합 = 고정양력 + 음력. 인접 연도의 설날/추석 꼬리도 포함해
        //    겹침/배치가 연 경계에서 끊기지 않도록 한다.
        var basePublic = Set<Int>()
        basePublic.formUnion(lunar)
        for (m, d) in fixedSolarMonthDays {
            basePublic.insert(epochDay(year: year, month: m, day: d))
        }
        // 인접 연도 음력 + 고정양력도 겹침 판정/배치 cascade 정확도를 위해 합친다.
        for adj in [year - 1, year + 1] {
            let a = lunarAnchorEpochDays(forYear: adj)
            if let s = a.seollal { basePublic.formUnion([s - 1, s, s + 1]) }
            if let c = a.chuseok { basePublic.formUnion([c - 1, c, c + 1]) }
            if let b = a.buddha { basePublic.insert(b) }
            for (m, d) in fixedSolarMonthDays {
                basePublic.insert(epochDay(year: adj, month: m, day: d))
            }
        }

        var substitutes = Set<Int>()
        // 이미 배치된 대체일도 다음 배치 cascade 에서 "공휴일" 취급해 점프시켜야 함.
        var occupied = basePublic

        // 대체 대상 후보를 "구별되는 민용일(epochDay)" 단위로 모은다. 같은 날에 두 공휴일이 겹치면
        // (예: 2028 추석 10/3 == 개천절) 하루치 손실이므로 대체도 1개만 발생해야 한다.
        // allowSaturday: 그 날의 공휴일 중 하나라도 SET B 면 토요일도 대체 트리거(더 permissive 한 규칙 채택).
        var allowSaturday: [Int: Bool] = [:]   // day → SET B 포함 여부

        func mark(day: Int, isSetB: Bool) {
            if let existing = allowSaturday[day] {
                allowSaturday[day] = existing || isSetB
            } else {
                allowSaturday[day] = isSetB
            }
        }

        // SET A — 설날 3일, 추석 3일 (일요일/겹침만, 토요일 X)
        if let s = seollalDay1 {
            for d in [s - 1, s, s + 1] { mark(day: d, isSetB: false) }
        }
        if let c = chuseokDay15 {
            for d in [c - 1, c, c + 1] { mark(day: d, isSetB: false) }
        }
        // SET B — 삼일절/광복절/개천절/한글날/어린이날/기독탄신일 (토/일/겹침) + 부처님오신날(음력)
        for (m, d) in setBFixedMonthDays {
            mark(day: epochDay(year: year, month: m, day: d), isSetB: true)
        }
        if let b = buddhaDay {
            mark(day: b, isSetB: true)
        }

        // 전진 cascade 의 결정성을 위해 후보일을 오름차순 처리.
        let candidateDays = allowSaturday.keys.sorted()

        for day in candidateDays {
            let weekday = weekdayOf(epochDay: day)   // 1=Sun..7=Sat
            let setBApplies = allowSaturday[day] ?? false

            // 겹침: 이 민용일에 둘 이상의 공휴일이 떨어지는가.
            let overlaps = isOverlappingOtherHoliday(
                day: day,
                year: year,
                seollalDay1: seollalDay1,
                chuseokDay15: chuseokDay15,
                buddhaDay: buddhaDay
            )

            // 트리거: 일요일 항상, 토요일은 SET B 가 끼어있을 때만, 그리고 겹침은 양쪽 다.
            let needsSubstitute = (weekday == 1)
                || (weekday == 7 && setBApplies)
                || overlaps
            guard needsSubstitute else { continue }

            // 배치: day 다음부터 "주말도 아니고 occupied(공휴일/이미 배정된 대체)도 아닌" 첫 날.
            var placement = day + 1
            while true {
                let wd = weekdayOf(epochDay: placement)
                let isWeekend = (wd == 1) || (wd == 7)
                if !isWeekend && !occupied.contains(placement) {
                    break
                }
                placement += 1
            }
            substitutes.insert(placement)
            occupied.insert(placement)
        }

        // 현재 연도(gregorian year)에 속한 대체일만 반환(인접 연도 분은 그 연도 계산이 담당).
        return substitutes.filter { seoulGregorian.component(.year, from: dateOf(epochDay: $0)) == year }
    }

    /// day 가 자기 정의 외의 다른 공휴일 날짜에도 해당하는지 (겹침). 예: 2028 추석(10/3)이 개천절과 겹침.
    private static func isOverlappingOtherHoliday(
        day: Int,
        year: Int,
        seollalDay1: Int?,
        chuseokDay15: Int?,
        buddhaDay: Int?
    ) -> Bool {
        var hits = 0
        // 음력 설날 3일
        if let s = seollalDay1, [s - 1, s, s + 1].contains(day) { hits += 1 }
        // 음력 추석 3일
        if let c = chuseokDay15, [c - 1, c, c + 1].contains(day) { hits += 1 }
        // 부처님
        if let b = buddhaDay, b == day { hits += 1 }
        // 고정양력 전체(대체 대상 아님 포함: 신정/현충일도 "겹침 상대"로는 공휴일이다)
        for (m, d) in fixedSolarMonthDays {
            if epochDay(year: year, month: m, day: d) == day { hits += 1 }
        }
        return hits >= 2
    }

    // MARK: 고정 양력 날짜 테이블

    /// 모든 고정 양력 공휴일 (대체 자격 무관 — 겹침 판정/기본 집합용).
    /// 신정(1/1), 삼일절(3/1), 어린이날(5/5), 현충일(6/6), 광복절(8/15), 개천절(10/3), 한글날(10/9), 기독탄신일(12/25)
    private static let fixedSolarMonthDays: [(Int, Int)] = [
        (1, 1), (3, 1), (5, 5), (6, 6), (8, 15), (10, 3), (10, 9), (12, 25)
    ]

    /// SET B 대체 자격 고정 양력 (토/일/겹침 시 대체). 신정·현충일 제외.
    private static let setBFixedMonthDays: [(Int, Int)] = [
        (3, 1), (5, 5), (8, 15), (10, 3), (10, 9), (12, 25)
    ]

    // MARK: epochDay <-> weekday / Date 헬퍼 (모두 Asia/Seoul)

    /// epochDay → Date (Asia/Seoul 자정).
    static func dateOf(epochDay: Int) -> Date {
        let cal = seoulGregorian
        let epochStart = cal.date(from: DateComponents(year: 1970, month: 1, day: 1))
            ?? Date(timeIntervalSince1970: 0)
        return cal.date(byAdding: .day, value: epochDay, to: epochStart) ?? epochStart
    }

    /// epochDay 의 요일. 1=Sun..7=Sat (Calendar.weekday 규약).
    private static func weekdayOf(epochDay: Int) -> Int {
        seoulGregorian.component(.weekday, from: dateOf(epochDay: epochDay))
    }
}
