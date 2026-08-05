import SwiftUI

/// Material 3 color tokens mirrored from the Android source of truth at
/// `apps/android-native/.../ui/theme/AlarmTalkTheme.kt`.
///
/// Light palette: lines 60-85 (lightColorScheme block).
/// Dark palette: lines 32-58 (darkColorScheme block).
///
/// SINGLE SOURCE OF TRUTH for the iOS brand palette. All Swift color usage
/// (including the legacy `AlarmTalkTheme` enum in `Theme.swift`) derives from
/// the constants below — do NOT re-declare brand hexes elsewhere in code. The one
/// exception is the canonical `primary` light/dark hex, which lives in
/// `Shared/AlarmTalkBrand.swift` so the Live Activity widget (which cannot see this
/// app-target file) can tint its UI from the same value; `light.primary` /
/// `dark.primary` below derive from `AlarmTalkBrand.primaryLight/Dark`.
///
/// The ONE unavoidable hand-mirror is `Assets.xcassets/AccentColor.colorset`,
/// which the OS reads at the asset-catalog level (Xcode's implicit global accent)
/// and therefore cannot reference Swift. When `light.primary` / `dark.primary`
/// below change, update `AccentColor.colorset`'s light & dark sRGB components to
/// the byte-identical hex by hand. Current locked primary: light #175FB0,
/// dark #A6D2FF. These hexes are byte-identical to Android `AlarmTalkTheme.kt`.
struct AlarmTalkPalette: Equatable {
    let primary: Color
    let onPrimary: Color
    let primaryContainer: Color
    let onPrimaryContainer: Color

    let secondary: Color
    let onSecondary: Color
    let secondaryContainer: Color
    let onSecondaryContainer: Color

    let tertiary: Color
    let onTertiary: Color
    let tertiaryContainer: Color
    let onTertiaryContainer: Color

    let background: Color
    let onBackground: Color

    let surface: Color
    let onSurface: Color
    let surfaceVariant: Color
    let onSurfaceVariant: Color

    let outline: Color
    let outlineVariant: Color

    let error: Color
    let onError: Color
    let errorContainer: Color
    let onErrorContainer: Color
}

extension AlarmTalkPalette {
    /// Mirrors `lightColorScheme(...)` in Android `AlarmTalkTheme.kt:60-85`.
    static let light = AlarmTalkPalette(
        primary: AlarmTalkBrand.primaryLight,
        onPrimary: .hex(0xFFFFFF),
        primaryContainer: .hex(0xD6E9FF),
        onPrimaryContainer: .hex(0x0A2740),
        secondary: .hex(0x5F8FAF),
        onSecondary: .hex(0xFFFFFF),
        secondaryContainer: .hex(0xE3F4FA),
        onSecondaryContainer: .hex(0x12303C),
        tertiary: .hex(0x5E7D70),
        onTertiary: .hex(0xFFFFFF),
        tertiaryContainer: .hex(0xE2F2EA),
        onTertiaryContainer: .hex(0x163226),
        background: .hex(0xF7F7FA),
        onBackground: .hex(0x181922),
        surface: .hex(0xFFFFFF),
        onSurface: .hex(0x181922),
        surfaceVariant: .hex(0xEDEEF3),
        onSurfaceVariant: .hex(0x5F6470),
        outline: .hex(0xCCCED8),
        outlineVariant: .hex(0xE0E2EA),
        error: .hex(0xC23E32),
        onError: .hex(0xFFFFFF),
        errorContainer: .hex(0xFFDDD6),
        onErrorContainer: .hex(0x5F160E)
    )

    /// Mirrors `darkColorScheme(...)` in Android `AlarmTalkTheme.kt:32-58`.
    static let dark = AlarmTalkPalette(
        primary: AlarmTalkBrand.primaryDark,
        onPrimary: .hex(0x08243C),
        primaryContainer: .hex(0x1E4263),
        onPrimaryContainer: .hex(0xD9ECFF),
        secondary: .hex(0xB9DDEB),
        onSecondary: .hex(0x0F2B36),
        secondaryContainer: .hex(0x243F49),
        onSecondaryContainer: .hex(0xE2F5FC),
        tertiary: .hex(0xC7E5D6),
        onTertiary: .hex(0x123226),
        tertiaryContainer: .hex(0x28483B),
        onTertiaryContainer: .hex(0xE3F6EC),
        background: .hex(0x090A0F),
        onBackground: .hex(0xF7F7FA),
        surface: .hex(0x14161E),
        onSurface: .hex(0xF7F7FA),
        surfaceVariant: .hex(0x20232D),
        onSurfaceVariant: .hex(0xA8AEBA),
        outline: .hex(0x3A3D49),
        outlineVariant: .hex(0x2D313D),
        error: .hex(0xFF9A8A),
        onError: .hex(0x3D0703),
        errorContainer: .hex(0x5B211B),
        onErrorContainer: .hex(0xFFDAD4)
    )
}

// `Color.hex(_:)` now lives in `Shared/AlarmTalkBrand.swift` so both the app and the
// Live Activity widget target share one definition (the widget cannot see this file).
// The light/dark `primary` above derive from `AlarmTalkBrand.primaryLight/Dark`, which
// hold the canonical locked brand hexes (#175FB0 / #A6D2FF).
