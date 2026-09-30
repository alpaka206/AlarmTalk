import Foundation

/// 알람 이름 칸이 비었을 때 두 앱이 저장하는 **기본 이름** — 사용자가 고른 이름이 아니다.
///
/// iOS 는 기기 언어와 무관하게 `"알람"`(`AlarmEditDraft.toRecord`), 안드로이드는 그 기기 언어의
/// `rd_default_alarm_label`(알람 / Alarm / アラーム)을 저장한다. 울림 알럿과 Live Activity 는 이
/// 값을 **이름이 없는 것**으로 본다 — 안드로이드 울림 화면도 기본 이름은 제목으로 쓰지 않는다
/// (`RingingActivity` 의 `customTitle`). 그대로 쓰면 영어·일본어 기기의 잠금 화면에 한국어
/// '알람' 이 섞인다(코덱스 #836).
///
/// 앱과 위젯 두 타깃이 함께 쓴다(`Shared`).
enum AlarmDefaultLabel {
    static let values: Set<String> = ["알람", "Alarm", "アラーム"]

    /// 사용자가 붙인 이름(앞뒤 공백 제거). 비었거나 기본 이름이면 nil.
    static func custom(_ label: String?) -> String? {
        let trimmed = (label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || values.contains(trimmed) ? nil : trimmed
    }
}
