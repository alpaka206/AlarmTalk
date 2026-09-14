import Foundation

/// 테마(버킷) 알람이 **어느 클립을 틀지** 정하는 단일 출처.
///
/// 테마는 세 갈래로 다르게 고른다 — 안드로이드 `AlarmEntity.bucketVariantIndex()` 미러:
///
/// | 테마 | 고르는 방법 | 네트워크 |
/// | --- | --- | --- |
/// | 날씨 | 저장·갱신 때 서버가 준 **실제 예보 조건**(`contextVariantIndex`) | 저장 시 1회 |
/// | 운세 | **사주 + 발사 날짜**로 기기에서 결정적 계산 | 없음 |
/// | 그 외(약 등) | 울릴 때마다 다음 자리로 **순차 회전** | 없음 |
///
/// ⚠ **울리는 순간에는 어떤 조회도 하지 않는다.** iOS 는 발사 시점에 우리 코드가 돌지
/// 않으므로(AlarmKit 이 예약해 둔 사운드를 그대로 울린다) 조건은 **예약 전에** 확정돼
/// 있어야 한다. 그래서 날씨는 저장 시점에 받아 스냅샷하고, 여기서는 읽기만 한다.
/// **조건/테마로 클립을 고르는 버킷** — 순차 회전이 아니라 절대 인덱스로 고른다.
///
/// ⚠ 이 버킷들은 `contextVariantIndex`(날씨) 나 사주 입력(운세)이 있어야 제 클립을 고른다.
///   그 값이 없는 채로 전체 세트를 묶으면 날씨는 **마지막 '못 알아봤어요' 클립**으로,
///   운세는 빈 프로필 해시로 떨어진다. 안드로이드 짝은 `data.MatchingBucketIds` 다.
let MatchingBucketIds: Set<String> = ["weather", "fortune"]

enum BucketVariantResolver {

    /// 날씨 테마 클립 수 = 조건 8(맑음/비/눈/미세먼지/흐림/안개/더위/추위) + '못 받았어요' 안내 1.
    /// 서버 `CLONE_WEATHER_CONDITIONS` + 마지막 안내 seed 와 같은 계약이고,
    /// 안드로이드 `WEATHER_CLONE_CLIP_COUNT` 와 같은 값이어야 한다.
    static let weatherClipCount = 9

    /// 준비창 — 며칠 뒤 예보로 조건을 굳히면 엉뚱해지므로 곧 울릴 알람만 받는다.
    static let prepareWindowMillis: Int64 = 48 * 60 * 60 * 1000

    /// 이 발사분의 조건으로 인정하는 범위 — 발사 24시간 이내에 받은 값.
    static let resolveValidWindowMillis: Int64 = 24 * 60 * 60 * 1000

    // MARK: - 운세: 기기에서 결정적으로 고른다

    /// 사주+날짜로 운세 테마 자리를 고른다(0..count-1). 같은 사람·같은 날은 **항상 같은 테마**.
    ///
    /// ⚠ **안드로이드 `fortuneThemeIndex` 와 글자 단위로 같은 계산이어야 한다.** 한 사람이
    /// 두 기기를 쓰면 같은 날 다른 운세를 듣게 된다. 그래서 seed 문자열의 구분자·trim 규칙,
    /// 31배 해시, 32비트 마스크를 그대로 옮겼다. 코틀린 `Char.code` 는 UTF-16 코드 유닛이라
    /// Swift 도 `utf16` 으로 순회한다(`unicodeScalars` 로 바꾸면 이모지에서 갈라진다).
    static func fortuneThemeIndex(
        gender: String?,
        birthDate: String?,
        birthTime: String?,
        date: String,
        count: Int
    ) -> Int {
        guard count > 0 else { return 0 }
        let seed = [
            gender?.trimmed ?? "",
            birthDate?.trimmed ?? "",
            birthTime?.trimmed ?? "",
            date.trimmed,
        ].joined(separator: "|")
        var hash: UInt64 = 0
        for unit in seed.utf16 {
            hash = (hash &* 31 &+ UInt64(unit)) & 0xFFFF_FFFF
        }
        return Int(hash % UInt64(count))
    }

    // MARK: - 발사 시 재생할 자리

    /// 이 알람이 울릴 때 재생할 클립 자리(0-based). 테마가 아니거나 클립이 없으면 `nil`.
    ///
    /// 안드로이드 `AlarmEntity.bucketVariantIndex()` 와 같은 규칙이다.
    static func variantIndex(for record: LocalAlarmRecord, calendar: Calendar = .current) -> Int? {
        guard let bucketId = record.bucketId?.nilIfBlank,
              let keys = record.bucketClipKeys, !keys.isEmpty else { return nil }
        let size = keys.count
        let raw: Int
        switch bucketId {
        case "fortune":
            raw = fortuneThemeIndex(
                gender: record.voiceFortuneGender,
                birthDate: record.voiceFortuneBirthDate,
                birthTime: record.voiceFortuneBirthTime,
                date: localDateString(millis: record.fireAtMillis, calendar: calendar),
                count: size
            )
        case "weather":
            if let resolved = record.contextVariantIndex {
                raw = resolved
            } else if size >= weatherClipCount {
                // 조건을 못 받았다 — **맑음(0)으로 때우지 않는다.** 마지막 클립이 서버가
                // 넣어 둔 '인터넷이 안 돼서 날씨를 못 봤어요' 안내다. 오재생보다 정직한 안내.
                raw = size - 1
            } else {
                // 안내 클립이 없는 옛 묶음(8개 이하)은 size-1 이 '추위' 를 가리키므로
                // 폴백하지 않는다. 재저장·언어 재바인딩으로 9개가 채워지면 정상 폴백된다.
                return nil
            }
        default:
            raw = record.bucketRotationIndex ?? 0
        }
        return ((raw % size) + size) % size
    }

    // MARK: - 날씨: 언제 다시 받아야 하는가

    /// 이 날씨 알람의 조건을 지금 받아야 하는가 — **한 발사분에 한 번만** 받는다.
    ///
    ///  - 준비창(48h) 밖이면 대상이 아니다. 며칠 뒤 예보는 정확도가 떨어져 지금 굳히면 어긋난다.
    ///  - 아직 못 받았으면 받는다.
    ///  - 이미 받았고 발사까지 24시간 넘게 남았으면 그대로 둔다.
    ///  - 임박(24h)했는데 그 값이 '이 발사분의 것' 이 아니면 다시 받는다. 반복 알람이 한 번
    ///    울리고 다음 날로 넘어가면 옛 값은 자연히 이 조건에서 벗어나므로, 별도 상태 없이
    ///    발사분마다 정확히 한 번 갱신된다.
    ///
    /// 안드로이드 `weatherVariantNeedsRefresh` 와 같은 판정이다.
    static func weatherVariantNeedsRefresh(_ record: LocalAlarmRecord, nowMillis: Int64) -> Bool {
        guard record.enabled, record.bucketId == "weather" else { return false }
        if record.fireAtMillis > nowMillis + prepareWindowMillis { return false }
        // 이미 지난 발사분은 준비할 게 없다 — 울리는 중이거나 놓친 알람에 재시도가
        // 무한정 붙는 것을 막는다.
        if record.fireAtMillis <= nowMillis { return false }
        if record.contextVariantIndex == nil { return true }
        if record.fireAtMillis > nowMillis + resolveValidWindowMillis { return false }
        return (record.contextResolvedAtMillis ?? 0) < record.fireAtMillis - resolveValidWindowMillis
    }

    // MARK: - 저장할 때 어떤 값을 남길 것인가

    struct WeatherVariantState: Equatable {
        var index: Int?
        var resolvedAtMillis: Int64?
    }

    /// 저장 시 `contextVariantIndex`/`contextResolvedAtMillis` 에 넣을 값.
    /// 안드로이드 `nextWeatherVariantState` 와 같은 우선순위다.
    ///
    /// - Parameters:
    ///   - resetVariant: 지역·발사날짜·목소리가 바뀌어 옛 조건이 무의미해졌는가.
    ///   - freshIndex: **이번 저장에서 새로 받아 온** 조건(없으면 nil).
    static func nextWeatherVariantState(
        nextBucketId: String?,
        resetVariant: Bool,
        currentIndex: Int?,
        currentResolvedAtMillis: Int64?,
        freshIndex: Int?,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> WeatherVariantState {
        // 새로 받아 온 값이 reset 보다 먼저다. 날짜·지역을 바꾼 편집이야말로 reset 이 켜지는
        // 경우인데, 그때 버리면 저장 전에 받아 온 의미가 없어진다 — 갱신이 돌기 전에 울리면
        // '못 받았어요' 안내가 나간다. 이 값은 **이미 새 조건으로** 받은 것이다.
        if nextBucketId == "weather", let freshIndex {
            return WeatherVariantState(index: freshIndex, resolvedAtMillis: nowMillis)
        }
        if resetVariant { return WeatherVariantState(index: nil, resolvedAtMillis: nil) }
        if nextBucketId == "weather" {
            return WeatherVariantState(index: currentIndex, resolvedAtMillis: currentResolvedAtMillis)
        }
        return WeatherVariantState(index: nil, resolvedAtMillis: nil)
    }

    /// 옛 조건을 버려야 하는가 — 지역이나 발사 날짜가 바뀌면 그 값은 다른 조건의 것이다.
    static func shouldResetWeatherVariant(
        previous: LocalAlarmRecord?,
        nextBucketId: String?,
        nextCountry: String?,
        nextCity: String?,
        nextFireAtMillis: Int64,
        calendar: Calendar = .current
    ) -> Bool {
        guard let previous else { return false }
        if nextBucketId != "weather" { return true }
        if previous.bucketId != "weather" { return true }
        if (previous.voiceWeatherCountry?.trimmed ?? "") != (nextCountry?.trimmed ?? "") { return true }
        if (previous.voiceWeatherCity?.trimmed ?? "") != (nextCity?.trimmed ?? "") { return true }
        return localDateString(millis: previous.fireAtMillis, calendar: calendar)
            != localDateString(millis: nextFireAtMillis, calendar: calendar)
    }

    // MARK: - Helpers

    /// 기기 표준시 기준 `yyyy-MM-dd`. 서버에 넘기는 `target_date` 와 운세 seed 가 같은 값을 쓴다.
    static func localDateString(millis: Int64, calendar: Calendar = .current) -> String {
        let components = calendar.dateComponents(
            [.year, .month, .day],
            from: Date(timeIntervalSince1970: TimeInterval(millis) / 1000)
        )
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
