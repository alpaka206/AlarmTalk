import SwiftUI

/// Pretendard-backed typography scale that mirrors the Material 3
/// `Typography()` defaults customized in Android
/// `apps/android-native/.../ui/theme/AlarmTalkTypography.kt:16-33`.
///
/// PostScript names for `Font(custom:size:)` were verified directly from the
/// shipped OTF files (`name` table, nameID 6):
///   - Pretendard-Regular
///   - Pretendard-Medium
///   - Pretendard-SemiBold
///   - Pretendard-Bold
struct AlarmTalkTypography {
    let displayLarge: Font
    let displayMedium: Font
    let displaySmall: Font

    let headlineLarge: Font
    let headlineMedium: Font
    let headlineSmall: Font

    let titleLarge: Font
    let titleMedium: Font
    let titleSmall: Font

    let bodyLarge: Font
    let bodyMedium: Font
    let bodySmall: Font

    let labelLarge: Font
    let labelMedium: Font
    let labelSmall: Font
}

enum PretendardWeight: String {
    case regular = "Pretendard-Regular"
    case medium = "Pretendard-Medium"
    case semibold = "Pretendard-SemiBold"
    case bold = "Pretendard-Bold"

}

extension Font {
    /// Returns Pretendard at the given size, falling back to the system font
    /// (matched weight) when the bundled OTF is unavailable. SwiftUI silently
    /// substitutes the system font if `Font(custom:size:)` cannot resolve the
    /// PostScript name, so no manual probe is required.
    static func pretendard(_ weight: PretendardWeight, size: CGFloat) -> Font {
        Font.custom(weight.rawValue, size: size)
    }
}

extension AlarmTalkTypography {
    /// Default scale, matching Material 3 sizes used by Android (Compose M3
    /// `Typography()` defaults). Line heights are documented in comments since
    /// SwiftUI `Font` does not encode leading directly — call sites that need
    /// the leading should reference the constants in `LineHeight` below.
    static let `default` = AlarmTalkTypography(
        displayLarge: .pretendard(.bold, size: 57),
        displayMedium: .pretendard(.bold, size: 45),
        displaySmall: .pretendard(.semibold, size: 36),

        headlineLarge: .pretendard(.semibold, size: 32),
        headlineMedium: .pretendard(.semibold, size: 28),
        headlineSmall: .pretendard(.semibold, size: 24),

        titleLarge: .pretendard(.semibold, size: 22),
        titleMedium: .pretendard(.medium, size: 16),
        titleSmall: .pretendard(.medium, size: 14),

        bodyLarge: .pretendard(.regular, size: 16),
        bodyMedium: .pretendard(.regular, size: 14),
        bodySmall: .pretendard(.regular, size: 12),

        labelLarge: .pretendard(.medium, size: 14),
        labelMedium: .pretendard(.medium, size: 12),
        labelSmall: .pretendard(.medium, size: 11)
    )

    /// Leading (line height) tokens paired with the scale above. Mirrors the
    /// Material 3 defaults Compose applies on top of `Typography()`.
    ///
    /// ⚠ **이 값들은 참고용이고, 실제로 적용되지 않는다**(2026-08-07 확인).
    /// SwiftUI 는 `Font` 에 리딩을 담지 못해 여러 줄 문구는 Pretendard 자체 리딩으로
    /// 그려진다. 안드로이드(Material 3 lineHeight)와의 차이는 **줄당 최대 2pt** 라
    /// 눈에 띄지 않고, 맞추려면 여러 줄 문구 16곳에 `lineSpacing` 을 일일이 붙여야 해서
    /// 그대로 두기로 했다.
    ///
    /// 언젠가 맞추기로 한다면 **한 곳도 빠뜨리지 말 것** — 절반만 적용하면 같은 화면 안에서
    /// 문단마다 줄 간격이 달라져 지금보다 나빠진다.
    enum LineHeight {
        static let displayLarge: CGFloat = 64
        static let displayMedium: CGFloat = 52
        static let displaySmall: CGFloat = 44
        static let headlineLarge: CGFloat = 40
        static let headlineMedium: CGFloat = 36
        static let headlineSmall: CGFloat = 32
        static let titleLarge: CGFloat = 28
        static let titleMedium: CGFloat = 24
        static let titleSmall: CGFloat = 20
        static let bodyLarge: CGFloat = 24
        static let bodyMedium: CGFloat = 20
        static let bodySmall: CGFloat = 16
        static let labelLarge: CGFloat = 20
        static let labelMedium: CGFloat = 16
        static let labelSmall: CGFloat = 16
    }
}
