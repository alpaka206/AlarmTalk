import SwiftUI

enum AlarmTalkThemeMode: String, CaseIterable, Identifiable {
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

    static func normalized(_ rawValue: String) -> AlarmTalkThemeMode {
        AlarmTalkThemeMode(rawValue: rawValue) ?? .system
    }
}

/// Aggregated design-token bundle exposed via `@Environment(\.voiceAlarmTheme)`.
///
/// This mirrors the Compose `MaterialTheme` setup that runs inside
/// `AlarmTalkTheme(...)` in
/// `apps/android-native/.../ui/theme/AlarmTalkTheme.kt:22-100`. Light vs dark
/// is decided by the current `ColorScheme` of the surrounding view.
struct AlarmTalkThemeValues: Equatable {
    let palette: AlarmTalkPalette
    let typography: AlarmTalkTypography
    let shapes: AlarmTalkShapes
    let spacing: AlarmTalkSpacing
    let elevation: AlarmTalkElevation

    static func == (lhs: AlarmTalkThemeValues, rhs: AlarmTalkThemeValues) -> Bool {
        lhs.palette == rhs.palette &&
        lhs.shapes == rhs.shapes &&
        lhs.spacing == rhs.spacing &&
        lhs.elevation == rhs.elevation
        // `typography` intentionally omitted: `SwiftUI.Font` does not conform to
        // Equatable. Palette/shape/spacing changes are sufficient signals for
        // SwiftUI invalidation.
    }
}

extension AlarmTalkThemeValues {
    static func resolve(for colorScheme: ColorScheme) -> AlarmTalkThemeValues {
        AlarmTalkThemeValues(
            palette: colorScheme == .dark ? .dark : .light,
            typography: .default,
            shapes: .default,
            spacing: .default,
            elevation: .default
        )
    }

    static let light = AlarmTalkThemeValues.resolve(for: .light)
    static let dark = AlarmTalkThemeValues.resolve(for: .dark)
}

private struct AlarmTalkThemeKey: EnvironmentKey {
    static let defaultValue: AlarmTalkThemeValues = .light
}

extension EnvironmentValues {
    /// The active AlarmTalk theme bundle. Injected by `AlarmTalkThemeProvider`
    /// at the app root and updated when `ColorScheme` changes.
    var voiceAlarmTheme: AlarmTalkThemeValues {
        get { self[AlarmTalkThemeKey.self] }
        set { self[AlarmTalkThemeKey.self] = newValue }
    }
}

/// View that exposes the appropriate `AlarmTalkThemeValues` for the current
/// system color scheme. Wrap the root scene in this provider so descendants
/// can call `@Environment(\.voiceAlarmTheme) private var theme`.
struct AlarmTalkThemeProvider<Content: View>: View {
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
