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
    /// 카드 테두리 — 다크에서 `outlineVariant` 보다 한 단계 밝다.
    /// ⚠ 옅게 되돌리지 말 것: 알람 목록은 **카드와 배경의 대비가 1.0:1** 이라 테두리가
    /// 유일한 구분선이다(2026-08-17 실측). 안드로이드 `WakerCardBorderDark` 와 같은 값.
    let cardBorder: Color

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
        cardBorder: .hex(0xE0E2EA),
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
        // 배경/표면 계열은 랜딩(일출 씬)의 **딥 네이비** 축과 같은 색조로 맞춘다 —
        // 무채색 회흑 대신 밤바다 톤이라 랜딩 → 앱 진입 시 톤이 이어진다.
        // 카드(surface)는 탭 배경 그라데이션(#1A2A52→#070C1D)보다 어두우면 '검은 박스' 로
        // 꺼져 보이므로, 그라데이션 상단과 비슷한 밝기의 네이비로 한 단계 띄운다.
        //
        // ⚠ 값은 안드로이드 `AlarmTalkTheme.kt` 의 `AlarmTalkDarkColorScheme` 과 같아야 한다.
        // 예전 iOS 값은 무채색 회흑(#090A0F / #14161E / #20232D)이었는데, 그건 안드로이드가
        // 의도적으로 벗어난 바로 그 톤이라 두 앱이 다른 앱처럼 보였다.
        background: .hex(0x090D16),
        onBackground: .hex(0xF7F8FC),
        surface: .hex(0x1B2542),
        onSurface: .hex(0xF7F8FC),
        surfaceVariant: .hex(0x29345A),
        onSurfaceVariant: .hex(0xA7AFC0),
        outline: .hex(0x4C587E),
        outlineVariant: .hex(0x3B4870),
        cardBorder: .hex(0x5A6A9C),
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

// MARK: - 홈 그라데이션

/// 탭·하위 전체화면이 공유하는 **새벽 네이비 그라데이션 배경**(로그인 딥네이비 감성).
///
/// 안드로이드 `WakerDesign.kt` 의 `HomeGradientDark`/`HomeGradientLight` 와 **같은 값**이다.
/// 탭과 설정·구성원 관리·약관 동의 등 하위 화면이 같은 브러시를 써서 화면 전환 시
/// 배경 톤이 튀지 않는다. 라이트/다크 2종.
///
/// ⚠ iOS 에는 이게 아예 없어서 배경이 단색이었다. 안드로이드와 나란히 놓으면 다른 앱처럼 보인다.
enum AlarmTalkGradient {
    static let dark = LinearGradient(
        stops: [
            .init(color: .hex(0x1A2A52), location: 0),
            .init(color: .hex(0x0E1938), location: 0.55),
            .init(color: .hex(0x070C1D), location: 1),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    static let light = LinearGradient(
        stops: [
            .init(color: .hex(0xF4F7FD), location: 0),
            .init(color: .hex(0xDBE6F7), location: 0.5),
            .init(color: .hex(0xBED2EF), location: 1),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// 현재 테마 명암에 맞는 홈 그라데이션 — 시스템 값이 아니라 **앱이 실제 쓰는 스킴** 기준.
    static func home(for scheme: ColorScheme) -> LinearGradient {
        scheme == .dark ? dark : light
    }
}
