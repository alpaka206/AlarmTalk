import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

extension Color {
    /// light/dark 두 팔레트 색을 현재 trait collection(밝게/어둡게)에 따라 자동 전환하는
    /// 다이내믹 Color.
    ///
    /// SwiftUI 의 정적 `Color` 상수는 color scheme 변화를 따라가지 못한다(생성 시점 값으로 고정).
    /// UIKit 의 `UIColor(dynamicProvider:)` 로 감싸면 렌더 시점의 trait 으로 해석되어,
    /// 같은 상수 하나가 밝게/어둡게에서 각각 올바른 색을 낸다. 이 덕분에 레거시
    /// `AlarmTalkTheme.*` 호출부(앱 전반 ~430곳)를 수정하지 않고도 다크모드가 정상 동작한다.
    static func dynamicScheme(light: Color, dark: Color) -> Color {
        #if canImport(UIKit)
        return Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
        #else
        return light
        #endif
    }
}

/// Legacy static accessor preserved for compatibility with existing call sites
/// (ContentView, AuthGateView, AlarmKitViewModel, 그 외 다수). 신규 코드는
/// `@Environment(\.voiceAlarmTheme)`(AlarmTalkTheme.swift) 를 우선 사용한다.
///
/// 색 값은 `AlarmTalkPalette.light` / `.dark` (Android `AlarmTalkTheme.kt` 미러)에서
/// 파생하며, 두 값을 `Color.dynamicScheme` 으로 묶어 **trait collection 기준으로
/// 밝게/어둡게를 자동 전환**한다. (이전에는 light 전용이라 다크모드에서 밝은 팔레트가
/// 그대로 렌더되는 버그가 있었음 — Android M3 colorScheme 동작과 일치하도록 수정.)
enum AlarmTalkTheme {
    // Brand / primary — 다이내믹(밝게/어둡게).
    static let primary = Color.dynamicScheme(light: AlarmTalkPalette.light.primary, dark: AlarmTalkPalette.dark.primary)
    static let secondary = Color.dynamicScheme(light: AlarmTalkPalette.light.secondary, dark: AlarmTalkPalette.dark.secondary)
    static let accent = Color.dynamicScheme(light: AlarmTalkPalette.light.tertiary, dark: AlarmTalkPalette.dark.tertiary)

    // Surfaces
    static let background = Color.dynamicScheme(light: AlarmTalkPalette.light.background, dark: AlarmTalkPalette.dark.background)
    static let surface = Color.dynamicScheme(light: AlarmTalkPalette.light.surface, dark: AlarmTalkPalette.dark.surface)
    static let surfaceVariant = Color.dynamicScheme(light: AlarmTalkPalette.light.surfaceVariant, dark: AlarmTalkPalette.dark.surfaceVariant)

    // Text
    static let text = Color.dynamicScheme(light: AlarmTalkPalette.light.onBackground, dark: AlarmTalkPalette.dark.onBackground)
    static let textSecondary = Color.dynamicScheme(light: AlarmTalkPalette.light.onSurfaceVariant, dark: AlarmTalkPalette.dark.onSurfaceVariant)

    // Signal
    static let error = Color.dynamicScheme(light: AlarmTalkPalette.light.error, dark: AlarmTalkPalette.dark.error)
    static let outline = Color.dynamicScheme(light: AlarmTalkPalette.light.outline, dark: AlarmTalkPalette.dark.outline)

    /// 오버레이 스크림. 안드로이드 `WakerScrimColor`(0xBD05080E)와 같은 값 —
    /// 라이트/다크 공통이다(딥네이비 위에 얹는 어두운 막이라 모드별로 갈리지 않는다).
    /// 모달을 덮을 때 `Color.black.opacity(...)` 를 새로 박지 말고 이걸 쓴다.
    static let scrim = Color(red: 0x05 / 255, green: 0x08 / 255, blue: 0x0E / 255)
        .opacity(0xBD / 255)
}
