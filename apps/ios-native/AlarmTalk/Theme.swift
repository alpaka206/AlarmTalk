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
    /// 모서리 반경 토큰 — `AlarmTalkShapes.default` 와 **같은 값**이다.
    ///
    /// 왜 두 갈래인가: 대부분의 뷰는 `@Environment(\.voiceAlarmTheme)` 로 `theme.shapes.*`
    /// 를 읽지만, 환경을 안 받는 작은 시트·다이얼로그가 몇 개 있다. 그 화면들이 생 숫자를
    /// 쓰다 보니 같은 카드가 파일마다 다른 반경으로 그려졌다(2026-08-07 iOS 생 숫자 47곳).
    /// 여기 정적 접근자를 두어 **환경이 없어도 토큰을 쓸 수 있게** 한다.
    ///
    /// ⚠ 생 숫자(`cornerRadius: 14`)를 새로 박지 말 것 — 안드로이드 `WakerDesign.kt` 의
    /// `Waker*Shape` 규약과 같은 이유다(CLAUDE.md 「디자인 토큰」).
    enum Shape {
        static let extraSmall = AlarmTalkShapes.default.extraSmall   // 12
        static let small = AlarmTalkShapes.default.small             // 14
        static let medium = AlarmTalkShapes.default.medium           // 18
        static let large = AlarmTalkShapes.default.large             // 24
        static let extraLarge = AlarmTalkShapes.default.extraLarge   // 28
        static let card = AlarmTalkShapes.default.vocaCard           // 22
        static let button = AlarmTalkShapes.default.vocaButton       // 18
    }

    // Brand / primary — 다이내믹(밝게/어둡게).
    static let primary = Color.dynamicScheme(light: AlarmTalkPalette.light.primary, dark: AlarmTalkPalette.dark.primary)
    /// `primary` 채움 **위에 얹는** 글자·아이콘 색.
    ///
    /// ⚠ **`.white` 로 고정하지 말 것.** 다크의 `primary` 는 연하늘(#A6D2FF)이라 흰 글자가
    /// 묻힌다(라이트는 진파랑이라 우연히 멀쩡해서 눈에 안 띈다). 채움과 글자는 **같은 축에서**
    /// 나와야 한쪽만 바뀌어도 대비가 유지된다.
    static let onPrimary = Color.dynamicScheme(light: AlarmTalkPalette.light.onPrimary, dark: AlarmTalkPalette.dark.onPrimary)
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
