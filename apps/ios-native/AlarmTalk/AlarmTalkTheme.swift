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
    /// 탭·하위 전체화면이 공유하는 배경 그라데이션(안드로이드 `homeGradientBrush()` 대응).
    let homeGradient: LinearGradient
    let typography: AlarmTalkTypography
    let shapes: AlarmTalkShapes
    let spacing: AlarmTalkSpacing

    static func == (lhs: AlarmTalkThemeValues, rhs: AlarmTalkThemeValues) -> Bool {
        lhs.palette == rhs.palette &&
        lhs.shapes == rhs.shapes &&
        lhs.spacing == rhs.spacing
        // `typography` intentionally omitted: `SwiftUI.Font` does not conform to
        // Equatable. Palette/shape/spacing changes are sufficient signals for
        // SwiftUI invalidation.
    }
}

extension AlarmTalkThemeValues {
    static func resolve(for colorScheme: ColorScheme) -> AlarmTalkThemeValues {
        AlarmTalkThemeValues(
            palette: colorScheme == .dark ? .dark : .light,
            homeGradient: AlarmTalkGradient.home(for: colorScheme),
            typography: .default,
            shapes: .default,
            spacing: .default
        )
    }

    static let light = AlarmTalkThemeValues.resolve(for: .light)
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

/// 화면 배경을 홈 그라데이션으로 깐다.
///
/// 안드로이드는 `homeGradientBrush()` 를 **탭뿐 아니라 하위 전체화면에도** 깐다 —
/// 설정(`SettingsScreen.kt:73`)·구성원 관리(`MemberManagementScreen.kt:106`)·
/// 동의 내역(`ConsentHistoryScreen.kt:83`)·약관 전문(`LegalDocumentScreen.kt:41`)·
/// 오픈소스 라이선스(`OssLicensesScreen.kt:84`)까지. 그래서 탭에서 하위 화면으로
/// 들어가도 배경 톤이 튀지 않는다.
///
/// ⚠ iOS 는 탭(`MainTabsView`)에만 깔고 하위 화면은 단색 `background` 였다 — 설정에
/// 들어가는 순간 딥네이비가 회백으로 바뀌어 다른 앱처럼 보였다. **새 전체화면을
/// 만들면 이 모디파이어를 붙인다.** `theme.palette.background` 로 되돌리지 말 것.
extension View {
    func homeGradientBackground() -> some View {
        modifier(HomeGradientBackground())
    }
}

private struct HomeGradientBackground: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    func body(content: Content) -> some View {
        content
            // List/Form 은 자기 배경을 먼저 그리므로 걷어내야 그라데이션이 보인다.
            .scrollContentBackground(.hidden)
            .background(theme.homeGradient.ignoresSafeArea())
    }
}
