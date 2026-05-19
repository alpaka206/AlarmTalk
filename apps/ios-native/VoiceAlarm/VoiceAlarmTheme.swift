import SwiftUI

/// Aggregated design-token bundle exposed via `@Environment(\.voiceAlarmTheme)`.
///
/// This mirrors the Compose `MaterialTheme` setup that runs inside
/// `VoiceAlarmTheme(...)` in
/// `apps/android-native/.../ui/theme/VoiceAlarmTheme.kt:22-100`. Light vs dark
/// is decided by the current `ColorScheme` of the surrounding view.
struct VoiceAlarmThemeValues: Equatable {
    let palette: VoiceAlarmPalette
    let typography: VoiceAlarmTypography
    let shapes: VoiceAlarmShapes
    let spacing: VoiceAlarmSpacing
    let elevation: VoiceAlarmElevation

    static func == (lhs: VoiceAlarmThemeValues, rhs: VoiceAlarmThemeValues) -> Bool {
        lhs.palette == rhs.palette &&
        lhs.shapes == rhs.shapes &&
        lhs.spacing == rhs.spacing &&
        lhs.elevation == rhs.elevation
        // `typography` intentionally omitted: `SwiftUI.Font` does not conform to
        // Equatable. Palette/shape/spacing changes are sufficient signals for
        // SwiftUI invalidation.
    }
}

extension VoiceAlarmThemeValues {
    static func resolve(for colorScheme: ColorScheme) -> VoiceAlarmThemeValues {
        VoiceAlarmThemeValues(
            palette: colorScheme == .dark ? .dark : .light,
            typography: .default,
            shapes: .default,
            spacing: .default,
            elevation: .default
        )
    }

    static let light = VoiceAlarmThemeValues.resolve(for: .light)
    static let dark = VoiceAlarmThemeValues.resolve(for: .dark)
}

private struct VoiceAlarmThemeKey: EnvironmentKey {
    static let defaultValue: VoiceAlarmThemeValues = .light
}

extension EnvironmentValues {
    /// The active VoiceAlarm theme bundle. Injected by `VoiceAlarmThemeProvider`
    /// at the app root and updated when `ColorScheme` changes.
    var voiceAlarmTheme: VoiceAlarmThemeValues {
        get { self[VoiceAlarmThemeKey.self] }
        set { self[VoiceAlarmThemeKey.self] = newValue }
    }
}

/// View that exposes the appropriate `VoiceAlarmThemeValues` for the current
/// system color scheme. Wrap the root scene in this provider so descendants
/// can call `@Environment(\.voiceAlarmTheme) private var theme`.
struct VoiceAlarmThemeProvider<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        content()
            .environment(\.voiceAlarmTheme, .resolve(for: colorScheme))
    }
}
