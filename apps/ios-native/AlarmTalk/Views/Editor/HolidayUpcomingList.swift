import SwiftUI

/// 국가 flag emoji 헬퍼. region 코드(ISO-3166 alpha-2) → regional indicator symbol.
enum HolidayCountryFlag {
    static func emoji(for regionCode: String) -> String {
        let code = regionCode.uppercased()
        guard code.count == 2 else { return "🏳️" }
        var scalarView = String.UnicodeScalarView()
        let base: UInt32 = 0x1F1E6  // 🇦
        for ascii in code.unicodeScalars {
            guard ascii.value >= 65, ascii.value <= 90,
                  let scalar = Unicode.Scalar(base + (ascii.value - 65)) else {
                return "🏳️"
            }
            scalarView.append(scalar)
        }
        return String(scalarView)
    }
}

/// 선택 국가의 다가오는 공휴일 최대 5개를 보여주는 읽기 전용 리스트.
/// 에디터의 ‘공휴일에는 끄기’ 토글이 켜졌을 때 그 아래에 표시한다.
struct HolidayUpcomingList: View {
    /// 표시 대상 국가 코드 (앱 전역 설정값).
    let countryCode: String
    /// 에디터가 보유한 HolidayStore 를 그대로 전달받는다 (UserDefaults 공유로 국가 일치).
    @ObservedObject var holidayStore: HolidayStore

    @Environment(\.voiceAlarmTheme) private var theme

    /// from(오늘) 이후 가장 가까운 공휴일 최대 5개. Android DAO getUpcoming 과 동일하게 상한 없이 LIMIT 5.
    private var upcoming: [HolidayEntity] {
        holidayStore.upcomingHolidays(countryCode: countryCode)
    }

    var body: some View {
        let items = upcoming
        // Android HolidayUpcomingList: 섹션 제목은 빈/콜드캐시 상태 포함 모든 상태에서 항상 노출.
        // Column verticalArrangement spacedBy(6.dp) 동등 (전용 토큰 없어 6 리터럴).
        VStack(alignment: .leading, spacing: 6) {
            Text("다가오는 공휴일")
                .font(theme.typography.labelLarge)
                .fontWeight(.semibold)
                .foregroundStyle(theme.palette.onSurfaceVariant)

            if items.isEmpty {
                // Android 와 동일하게 국가 무관 단일 콜드캐시 문구. 비-KR 은 한 번 서버 동기화를 건다
                // (KR 은 ensureSynced 가 즉시 return 하는 no-op).
                Text("불러오는 중…")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .task(id: countryCode) {
                        await holidayStore.ensureSynced(countryCode: countryCode)
                    }
            } else {
                ForEach(items, id: \.epochDay) { item in
                    // Android HolidayRow: Row spacedBy(12.dp), 날짜는 고유 너비, 이름은 1줄 ellipsis.
                    HStack(spacing: theme.spacing.sm) {
                        Text(Self.shortDateLabel(epochDay: item.epochDay))
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                        Text(item.name)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurface)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// epochDay → "M.d (E)" (예: "9.25 (금)" / "9.25 (Fri)"). Android HolidayDateFormatter 와 동일 패턴.
    private static func shortDateLabel(epochDay: Int) -> String {
        let date = KoreanLunarHolidayEngine.dateOf(epochDay: epochDay)
        let fmt = DateFormatter()
        fmt.calendar = KoreanLunarHolidayEngine.seoulGregorian
        fmt.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        fmt.locale = Locale.current
        fmt.dateFormat = "M.d (E)"
        return fmt.string(from: date)
    }
}
