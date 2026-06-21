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

    private var upcoming: [HolidayEntity] {
        let now = Date()
        let end = now.addingTimeInterval(370 * 86_400)
        return holidayStore
            .holidaysIn(range: now...end, countryCode: countryCode)
            .sorted { $0.epochDay < $1.epochDay }
            .prefix(5)
            .map { $0 }
    }

    var body: some View {
        let items = upcoming
        if items.isEmpty {
            // KR 은 온디바이스라 비어 있을 일이 거의 없다. 비-KR 은 sync 대기 placeholder.
            Group {
                if countryCode.uppercased() != "KR" {
                    Text("공휴일 정보를 불러오는 중…")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .task(id: countryCode) {
                            await holidayStore.ensureSynced(countryCode: countryCode)
                        }
                } else {
                    Text("다가오는 공휴일이 없어요.")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: theme.spacing.xs) {
                ForEach(items, id: \.epochDay) { item in
                    HStack(spacing: theme.spacing.sm) {
                        Text(Self.shortDateLabel(epochDay: item.epochDay))
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .monospacedDigit()
                            .frame(width: 96, alignment: .leading)
                        Text(item.name)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurface)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    /// epochDay → 로컬라이즈된 짧은 날짜 (예: "2026. 1. 1. (목)").
    private static func shortDateLabel(epochDay: Int) -> String {
        let date = KoreanLunarHolidayEngine.dateOf(epochDay: epochDay)
        let fmt = DateFormatter()
        fmt.calendar = KoreanLunarHolidayEngine.seoulGregorian
        fmt.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        fmt.locale = Locale.current
        fmt.setLocalizedDateFormatFromTemplate("EEEMMMd")
        return fmt.string(from: date)
    }
}
