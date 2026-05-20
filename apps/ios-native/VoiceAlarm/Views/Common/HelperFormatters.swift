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

    /// 캐릭터 단계 라벨(SP/FL/TR/SE)을 반환. nil/unknown 은 "SE".
    static func characterStageLabel(_ stage: String?) -> String {
        switch stage {
        case "sprout": return "SP"
        case "flower": return "FL"
        case "tree": return "TR"
        default: return "SE"
        }
    }

    /// 홈 화면 인사말. 시각대별로 두 줄로 갈라진 문구를 돌려준다.
    static func homeGreeting(now: Date = Date(), calendar: Calendar = .current) -> (top: String, bottom: String) {
        let hour = calendar.component(.hour, from: now)
        switch hour {
        case ..<6:
            return ("좋아하는 목소리로", "깨워드릴게요")
        case ..<12:
            return ("오늘 아침,", "어떤 목소리로 깨어났나요?")
        case ..<17:
            return ("내일의 목소리 알람을", "준비해요")
        case ..<21:
            return ("서로의 목소리로", "아침을 예약해요")
        default:
            return ("좋아하는 목소리로", "깨워드릴게요")
        }
    }

    /// 가족 알람 quiet schedule 라벨. 비어있으면 기본값(평일 09:00-18:30) 반환.
    static func quietScheduleLabel(_ windows: [FamilyAlarmQuietWindow]?) -> String {
        guard let first = windows?.first else {
            return "평일 09:00-18:30"
        }
        let days = first.days.map { day -> String in
            switch day {
            case 0, 1: return "일"
            case 2: return "월"
            case 3: return "화"
            case 4: return "수"
            case 5: return "목"
            case 6: return "금"
            default: return "토"
            }
        }.joined()
        return "\(days) \(first.start)-\(first.end)"
    }

    /// 알람 한 줄 요약. 반복요일/재생모드/스누즈/오디오캐시/서버동기화 상태를 합친다.
    static func alarmDetail(_ alarm: LocalAlarmRecord) -> String {
        let repeatLabel = alarm.repeatWeekdays.isEmpty
            ? "한 번"
            : alarm.repeatWeekdays.sorted().map(weekdayLabel).joined(separator: " ")
        let remoteLabel = alarm.remoteAlarmId == nil ? "서버 미저장" : "서버 저장됨"
        let audioLabel = alarm.localAudioUri == nil ? "로컬 음성 없음" : "로컬 음성 캐시"
        return "\(repeatLabel) · \(alarm.playModeEnum.label) · 다시 알림 \(alarm.snoozeMinutes)분 · \(audioLabel) · \(remoteLabel)"
    }
}
