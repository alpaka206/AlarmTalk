import SwiftUI

enum VoiceAlarmThemeMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    static let storageKey = "theme_mode"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "시스템 설정"
        case .light: return "밝게"
        case .dark: return "어둡게"
        }
    }

    var subtitle: String {
        switch self {
        case .system: return "휴대폰 설정을 따라가요."
        case .light: return "낮에도 선명한 밝은 화면이에요."
        case .dark: return "밤에 보기 편한 어두운 화면이에요."
        }
    }

    var pickerTitle: String {
        switch self {
        case .system: return "시스템"
        case .light: return "밝게"
        case .dark: return "어둡게"
        }
    }

    var systemImage: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max.fill"
        case .dark: return "moon.fill"
        }
    }

    var preferredColorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    static func normalized(_ rawValue: String) -> VoiceAlarmThemeMode {
        VoiceAlarmThemeMode(rawValue: rawValue) ?? .system
    }
}

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
