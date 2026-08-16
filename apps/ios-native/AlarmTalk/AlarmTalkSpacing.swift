import SwiftUI

/// Spacing tokens used across the Android app. Derived from the `.dp` values
/// scattered through Compose call sites in
/// `apps/android-native/.../ui/components/WakerDesign.kt` and the screen
/// composables that build on `AlarmTalkTheme`.
///
/// The scale follows a 4-pt grid so iOS layouts can be measured against the
/// Android screenshots without translation.
struct AlarmTalkSpacing: Equatable {
    let xxs: CGFloat  // 4
    let xs: CGFloat   // 8
    let sm: CGFloat   // 12
    let md: CGFloat   // 16
    let lg: CGFloat   // 20
    let xl: CGFloat   // 24
    let xxl: CGFloat  // 32
    let xxxl: CGFloat // 40
}

extension AlarmTalkSpacing {
    static let `default` = AlarmTalkSpacing(
        xxs: 4,
        xs: 8,
        sm: 12,
        md: 16,
        lg: 20,
        xl: 24,
        xxl: 32,
        xxxl: 40
    )
}

/// 한 줄에 나란히 놓이는 컨트롤의 **공통 높이** — 입력칸과 그 옆 버튼이 같이 쓴다.
///
/// ⚠ **기본값끼리 두면 높이가 어긋난다.** SwiftUI `TextField`(패딩으로 44 남짓)와
/// `.borderedProminent` 버튼(34 남짓)은 서로 다르게 앉는다 — 코드 등록 화면이 실제로
/// 그랬다(2026-08-17 지적). 안드로이드도 같은 문제였다(입력칸 56 / 버튼 40).
///
/// **안드로이드 `WakerControlHeight` 와 같은 값(56)이다** — 두 앱의 버튼 크기를 맞춘
/// 기준점이라 한쪽만 바꾸지 말 것.
enum AlarmTalkControl {
    /// ⚠ **맞추는 방향은 '버튼을 키우기' 가 아니라 '입력칸을 줄이기' 다**(2026-08-17 지시).
    /// 56 짜리 버튼은 한 줄 액션치고 너무 크다.
    static let height: CGFloat = 48
    /// 라벨이 짧아도 지키는 최소 폭. 번역이 길어지면 자연히 늘어난다.
    static let minWidth: CGFloat = 88
}
