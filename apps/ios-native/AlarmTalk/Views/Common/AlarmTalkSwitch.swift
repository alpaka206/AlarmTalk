import SwiftUI

/// 앱 공용 스위치 스타일. 안드로이드 `ui/components/AlarmTalkSwitch` 에 대응한다.
///
/// ⚠ **`Toggle` 을 맨몸으로 쓰지 말 것.** SwiftUI 기본 스위치는 iOS 기본 초록이라,
/// `.tint` 를 빠뜨린 화면만 앱 파란색이 아닌 초록으로 뜬다. 실제로 세 곳이 그랬고
/// (구성원 관리의 '상대 알람 허용', 목소리 등록의 '목소리 공유'·'잡음 제거'),
/// 같은 누락이 새 화면마다 반복될 자리였다 — 색을 호출부에 맡기는 대신 스타일에 넣는다.
///
/// 쓰는 법: `Toggle(...).alarmTalkSwitch()`
struct AlarmTalkSwitchStyle: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    func body(content: Content) -> some View {
        content
            .toggleStyle(.switch)
            .tint(theme.palette.primary)
    }
}

extension View {
    /// 앱 공용 스위치 색·스타일을 입힌다.
    func alarmTalkSwitch() -> some View {
        modifier(AlarmTalkSwitchStyle())
    }
}
