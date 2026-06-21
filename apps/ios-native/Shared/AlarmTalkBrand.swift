import SwiftUI

/// Brand color tokens shared by the main app and the Live Activity widget target.
///
/// WHY THIS LIVES IN `Shared/`:
/// The widget extension only compiles `AlarmTalkWidget/` + `Shared/` sources, so it
/// cannot reach `AlarmTalkPalette` / `AlarmTalkTheme` (app target only). The Live
/// Activity previously hard-coded RGB literals that drifted from the app brand and
/// from the AlarmKit alert `tintColor`. Centralizing the canonical hexes here lets:
///   - `AlarmTalkPalette` (app) derive its light/dark `primary` from these constants,
///   - `AlarmLiveActivity` (widget) tint its lock-screen + Dynamic Island UI, and
///   - `AlarmKitViewModel.makeConfiguration` set the alert `tintColor`,
/// all from one source — so the LA and the system alert tint stay in sync.
///
/// These hexes are byte-identical to Android `AlarmTalkTheme.kt` and to
/// `Assets.xcassets/AccentColor.colorset` (the one OS-level mirror that cannot read
/// Swift). When changing the brand hue, update all three together.
enum AlarmTalkBrand {
    /// Locked light-mode brand primary. Android `AlarmTalkTheme.kt` light primary.
    static let primaryLightHex: UInt32 = 0x175FB0
    /// Locked dark-mode brand primary. Android `AlarmTalkTheme.kt` dark primary.
    static let primaryDarkHex: UInt32 = 0xA6D2FF

    static let primaryLight = Color.hex(primaryLightHex)
    static let primaryDark = Color.hex(primaryDarkHex)

    // Live Activity surface / accent tokens (lock screen reads dark by convention,
    // mirroring Android RingingActivity's dark-blue gradient surface).
    /// Lock-screen / activity background tint (deep brand navy).
    static let activityBackgroundHex: UInt32 = 0x0E2238
    static let activityBackground = Color.hex(activityBackgroundHex)
    /// Warm secondary text used for date / subtitle lines (RingingActivity parity).
    static let activitySecondaryTextHex: UInt32 = 0xA6BDDA
    static let activitySecondaryText = Color.hex(activitySecondaryTextHex)
}

extension Color {
    /// Constructs an opaque sRGB color from a 24-bit hex literal (e.g. `0x175FB0`).
    ///
    /// Single definition shared across both targets. (Previously duplicated inside
    /// `AlarmTalkPalette.swift`; that copy was removed so the widget target can use
    /// the same helper without a redeclaration conflict in the app target.)
    static func hex(_ value: UInt32) -> Color {
        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0
        return Color(.sRGB, red: r, green: g, blue: b, opacity: 1.0)
    }
}
