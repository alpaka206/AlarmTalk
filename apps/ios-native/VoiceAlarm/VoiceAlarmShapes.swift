import SwiftUI

/// Corner-radius tokens mirroring the Android Material 3 `Shapes` block in
/// `apps/android-native/.../ui/theme/VoiceAlarmTheme.kt:102-108` plus the
/// VocaWake-specific shapes from `ui/components/VocaWakeDesign.kt:12-14`.
struct VoiceAlarmShapes: Equatable {
    let extraSmall: CGFloat
    let small: CGFloat
    let medium: CGFloat
    let large: CGFloat
    let extraLarge: CGFloat

    /// `VocaWakeCardShape` — 22.dp on Android.
    let vocaCard: CGFloat
    /// `VocaWakeButtonShape` / `VocaWakeInputShape` — 18.dp on Android.
    let vocaButton: CGFloat
    /// Capsule-styled chip (effectively `999.dp` on Android).
    let vocaChip: CGFloat
}

extension VoiceAlarmShapes {
    static let `default` = VoiceAlarmShapes(
        extraSmall: 12,
        small: 14,
        medium: 18,
        large: 24,
        extraLarge: 28,
        vocaCard: 22,
        vocaButton: 18,
        vocaChip: 999
    )
}

extension View {
    /// Applies the Voca card corner radius via a `RoundedRectangle` clip shape.
    /// Matches `VocaWakeCardShape` (22.dp) from Android.
    func vocaCardShape() -> some View {
        clipShape(RoundedRectangle(cornerRadius: VoiceAlarmShapes.default.vocaCard, style: .continuous))
    }

    /// Applies the Voca button corner radius (18.dp on Android).
    func vocaButtonShape() -> some View {
        clipShape(RoundedRectangle(cornerRadius: VoiceAlarmShapes.default.vocaButton, style: .continuous))
    }
}
