import Foundation
import SwiftUI

/// 화면 분해 과정에서 떠다니던 작은 format/label 헬퍼를 한 곳으로 모았다.
///
/// 모두 순수 함수라 어디서든 호출할 수 있고, 분리된 화면 파일들이
/// 동일한 표기 규칙(요일 라벨/캐릭터 단계 라벨/시간 인사말)을 공유한다.
enum HelperFormatters {
    /// 알람 화면 weekday picker 에 쓰는 (Calendar.weekday, 한글 1글자) 쌍.
    /// `Calendar.weekday` 는 1=일요일, 2=월요일 … 7=토요일.
    static let weekdays: [(value: Int, label: String)] = [
        (2, "월"), (3, "화"), (4, "수"), (5, "목"), (6, "금"), (7, "토"), (1, "일"),
    ]

    /// 주어진 weekday 값(1..7)을 한글 1글자로 변환. 매칭 실패 시 빈 문자열.
    static func weekdayLabel(_ value: Int) -> String {
        weekdays.first { $0.value == value }?.label ?? ""
    }

    /// 밀리초를 "분:초"(m:ss) 로 표기. 오디오 크롭/길이 표시에 공용으로 쓴다.
    /// Android `audioTimeLabel` 대응. (여러 뷰에 흩어져 있던 동일 구현을 통합.)
    static func audioTimeLabel(_ millis: Int) -> String {
        let seconds = max(0, millis / 1000)
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    /// Android `stageEmoji` 와 같은 캐릭터 단계 이모지. nil/unknown 은 씨앗.
    static func characterStageEmoji(_ stage: String?) -> String {
        switch stage {
        case "sprout": return "🌱"
        case "tree": return "🌳"
        case "bloom", "flower": return "🌸"
        default: return "🌰"
        }
    }

    /// Android `stageLabel` 과 같은 캐릭터 단계 이름. nil/unknown 은 씨앗.
    static func characterStageName(_ stage: String?) -> String {
        switch stage {
        case "sprout": return "새싹"
        case "tree": return "나무"
        case "bloom", "flower": return "꽃"
        default: return "씨앗"
        }
    }

    /// 이전 화면 분해 코드 호환용. 새 화면은 `characterStageEmoji` 를 직접 쓴다.
    static func characterStageLabel(_ stage: String?) -> String {
        characterStageEmoji(stage)
    }

    /// 홈 화면 인사말. 시각대별로 두 줄로 갈라진 문구를 돌려준다.
    static func homeGreeting(now: Date = Date(), calendar: Calendar = .current) -> (top: String, bottom: String) {
        let hour = calendar.component(.hour, from: now)
        switch hour {
        // Android `HomeComponents.kt:53` HomeHeader 와 동일한 시각대별 인사말.
        case ..<6:
            return ("좋아하는 목소리로", "깨워드릴게요")
        case ..<12:
            return ("오늘 아침,", "잘 일어나셨나요?")
        case ..<17:
            return ("내일 알람을", "준비해요")
        case ..<21:
            return ("서로의 목소리로", "아침을 예약해요")
        default:
            return ("좋아하는 목소리로", "깨워드릴게요")
        }
    }

    /// 가족 알람 quiet schedule 라벨. Android `quietScheduleLabel` (SettingsScreen.kt:746) 1:1.
    /// 앞 2개 윈도우만 표시하고 나머지는 "외 N개" 로 축약한다. 비어 있으면 "없음".
    static func quietScheduleLabel(_ windows: [FamilyAlarmQuietWindow]?) -> String {
        let list = windows ?? []
        if list.isEmpty { return "없음" }
        let visible = list.prefix(2).map(quietWindowLabel).joined(separator: " · ")
        let hidden = list.count - 2
        return hidden > 0 ? "\(visible) 외 \(hidden)개" : visible
    }

    private static func quietWindowLabel(_ window: FamilyAlarmQuietWindow) -> String {
        "\(quietDaysLabel(window.days)) \(formatQuietTime(window.start)) ~ \(formatQuietTime(window.end))"
    }

    /// "07:00" → "7:00" (시각 앞자리 0 제거, 분은 2자리 유지). Android `formatQuietTime`.
    private static func formatQuietTime(_ value: String) -> String {
        let parts = value.split(separator: ":")
        guard let hour = parts.first.flatMap({ Int($0) }),
              parts.count > 1, let minute = Int(parts[1]) else { return value }
        return String(format: "%d:%02d", hour, minute)
    }

    /// 요일 묶음 라벨. 0=일 … 6=토. Android `quietDaysLabel` 와 동일한 스마트 그룹핑.
    /// (에디터의 FamilyAlarmScheduleRules 와 공용으로 쓰도록 internal.)
    static func quietDaysLabel(_ days: [Int]) -> String {
        let sorted = Array(Set(days)).sorted()
        switch sorted {
        case []: return "없음"
        case [1, 2, 3, 4, 5]: return "평일"
        case [0, 6]: return "주말"
        case [0, 1, 2, 3, 4, 5, 6]: return "매일"
        default:
            let labels = ["일", "월", "화", "수", "목", "금", "토"]
            return sorted.map { labels[max(0, min(6, $0))] }.joined(separator: ",")
        }
    }
}
