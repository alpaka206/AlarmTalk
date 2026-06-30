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
