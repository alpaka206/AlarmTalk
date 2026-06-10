import SwiftUI

/// Legacy static accessor preserved for compatibility with existing call sites
/// (ContentView, AuthGateView, AlarmKitViewModel). New code should prefer
/// `@Environment(\.voiceAlarmTheme)` defined in `AlarmTalkTheme.swift`.
///
/// Color values are sourced from the Android light palette in
/// `apps/android-native/app/src/main/java/com/voicealarm/nativeapp/ui/theme/AlarmTalkTheme.kt:60-85`.
enum AlarmTalkTheme {
    // Brand / primary
    static let primary = Color(red: 0x3F / 255.0, green: 0x6F / 255.0, blue: 0x9E / 255.0)
    static let primaryDark = Color(red: 0x2A / 255.0, green: 0x52 / 255.0, blue: 0x78 / 255.0)
    static let secondary = Color(red: 0x5F / 255.0, green: 0x8F / 255.0, blue: 0xAF / 255.0)
    static let accent = Color(red: 0x5E / 255.0, green: 0x7D / 255.0, blue: 0x70 / 255.0)

    // Surfaces
    static let background = Color(red: 0xF7 / 255.0, green: 0xF7 / 255.0, blue: 0xFA / 255.0)
    static let surface = Color.white
    static let surfaceVariant = Color(red: 0xED / 255.0, green: 0xEE / 255.0, blue: 0xF3 / 255.0)

    // Text
    static let text = Color(red: 0x18 / 255.0, green: 0x19 / 255.0, blue: 0x22 / 255.0)
    static let textSecondary = Color(red: 0x5F / 255.0, green: 0x64 / 255.0, blue: 0x70 / 255.0)

    // Signal
    static let error = Color(red: 0xC2 / 255.0, green: 0x3E / 255.0, blue: 0x32 / 255.0)
    static let outline = Color(red: 0xCC / 255.0, green: 0xCE / 255.0, blue: 0xD8 / 255.0)
}
