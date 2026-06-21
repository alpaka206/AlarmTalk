import SwiftUI

/// Legacy static accessor preserved for compatibility with existing call sites
/// (ContentView, AuthGateView, AlarmKitViewModel). New code should prefer
/// `@Environment(\.voiceAlarmTheme)` defined in `AlarmTalkTheme.swift`.
///
/// Color values are derived from `AlarmTalkPalette.light`, which is the single
/// source of truth (mirrored from Android `AlarmTalkTheme.kt`). These constants
/// no longer re-declare brand hexes — they reference the canonical palette so a
/// future hue change only edits `AlarmTalkPalette.swift` (+ `AccentColor.colorset`).
///
/// Behavior note: this enum has no dark variant, so these sites render the light
/// palette values in dark mode too (unchanged from prior behavior).
enum AlarmTalkTheme {
    // Brand / primary — derived from the canonical palette.
    static let primary = AlarmTalkPalette.light.primary
    /// Previously a unique darker blue (#2A5278). Unified onto the canonical
    /// brand primary, which is now itself dark enough to read on light surfaces.
    /// Used as a readable foreground accent (icons/chevrons) by ~9 call sites.
    static let primaryDark = AlarmTalkPalette.light.primary
    static let secondary = AlarmTalkPalette.light.secondary
    static let accent = AlarmTalkPalette.light.tertiary

    // Surfaces
    static let background = AlarmTalkPalette.light.background
    static let surface = AlarmTalkPalette.light.surface
    static let surfaceVariant = AlarmTalkPalette.light.surfaceVariant

    // Text
    static let text = AlarmTalkPalette.light.onBackground
    static let textSecondary = AlarmTalkPalette.light.onSurfaceVariant

    // Signal
    static let error = AlarmTalkPalette.light.error
    static let outline = AlarmTalkPalette.light.outline
}
