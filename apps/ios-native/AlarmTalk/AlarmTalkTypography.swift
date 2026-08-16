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
    ///
    /// ⚠ **`relativeTo:` 를 빼지 말 것**(2026-08-17). 이게 없으면 글자가 **사용자의 텍스트
    /// 크기 설정을 완전히 무시한다.** 실제로 그랬다 — 설정이 M(기본보다 한 칸 작음)인
    /// 아이폰에서 시스템 `.body` 는 16pt 로 그려지는데 우리 글자만 17pt 그대로였다.
    /// 안드로이드는 `sp` 라 처음부터 따라가고 있었으므로, 같은 앱이 한쪽에서만 설정을
    /// 무시하고 있던 셈이다.
    ///
    /// 애플 기준으로도 이건 상품 페이지에 공개되는 항목이다 — App Store Connect 의
    /// 'Larger Text' 평가 기준은 "200% 또는 시스템 최대치까지 키울 수 있어야" 지원으로
    /// 표시할 수 있다고 적는다.
    static func pretendard(_ weight: PretendardWeight, size: CGFloat, relativeTo style: TextStyle) -> Font {
        Font.custom(weight.rawValue, size: size, relativeTo: style)
    }

    /// 스타일을 지정하지 않은 호출 — **크기에 가장 가까운 시스템 스타일**에 묶는다.
    ///
    /// 짝을 자동으로 고르는 이유: 이 함수를 부르는 자리가 수십 곳인데, 거기에 일일이
    /// `relativeTo:` 를 적게 하면 빠뜨린 곳만 안 커진다(그게 지금까지의 상태였다).
    /// 크기로 고르면 큰 글자는 큰 스타일의 증가 속도를, 작은 글자는 작은 쪽 속도를 따라가
    /// **화면 안의 위계가 유지된다.**
    static func pretendard(_ weight: PretendardWeight, size: CGFloat) -> Font {
        Font.custom(weight.rawValue, size: size, relativeTo: nearestTextStyle(size))
    }

    /// 크기 → 가장 가까운 시스템 텍스트 스타일. 경계값은 iOS 기본 크기(Large)다:
    /// caption2 11 / caption 12 / footnote 13 / subheadline 15 / callout 16 / body 17 /
    /// headline 17 / title3 20 / title2 22 / title 28 / largeTitle 34.
    private static func nearestTextStyle(_ size: CGFloat) -> TextStyle {
        switch size {
        case ..<11.5: return .caption2
        case ..<12.5: return .caption
        case ..<14: return .footnote
        case ..<15.5: return .subheadline
        case ..<16.5: return .callout
        case ..<18.5: return .body
        case ..<21: return .title3
        case ..<25: return .title2
        case ..<31: return .title
        default: return .largeTitle
        }
    }

    /// **설정을 따르지 않는** 고정 크기 Pretendard.
    ///
    /// ⚠ 아무 데나 쓰지 말 것 — 여기 쓰면 그 글자는 사용자가 키워도 커지지 않는다.
    /// 쓰는 자리는 **줄바꿈으로 흐를 수 없는 곳**뿐이다(시각 휠 숫자처럼 칸 높이가 정해진
    /// 컨트롤). 안드로이드도 같은 규약이다 — `WakerDesign.kt` 의 `fitToWidthScale` 주석에
    /// 어디를 줄이고 어디를 두는지 표가 있다.
    static func pretendardFixed(_ weight: PretendardWeight, size: CGFloat) -> Font {
        Font.custom(weight.rawValue, fixedSize: size)
    }
}

extension AlarmTalkTypography {
    /// Default scale, matching Material 3 sizes used by Android (Compose M3
    /// `Typography()` defaults). Line heights are documented in comments since
    /// SwiftUI `Font` does not encode leading directly — call sites that need
    /// the leading should reference the constants in `LineHeight` below.
    /// ⚠ **각 토큰의 `relativeTo:` 는 크기가 가장 가까운 시스템 스타일**로 짝지었다.
    /// 이 짝이 증가 속도를 정한다 — 예를 들어 `.caption`(11~12)에 묶은 글자는 큰 설정에서
    /// `.body`(17)에 묶은 글자보다 덜 커진다. 아무 스타일에나 묶으면 같은 화면 안에서
    /// 글자들이 서로 다른 속도로 자라 위계가 뒤집힌다.
    static let `default` = AlarmTalkTypography(
        displayLarge: .pretendard(.bold, size: 57, relativeTo: .largeTitle),
        displayMedium: .pretendard(.bold, size: 45, relativeTo: .largeTitle),
        displaySmall: .pretendard(.semibold, size: 36, relativeTo: .largeTitle),

        headlineLarge: .pretendard(.semibold, size: 32, relativeTo: .title),
        headlineMedium: .pretendard(.semibold, size: 28, relativeTo: .title),
        headlineSmall: .pretendard(.semibold, size: 24, relativeTo: .title2),

        titleLarge: .pretendard(.semibold, size: 22, relativeTo: .title2),
        titleMedium: .pretendard(.medium, size: 16, relativeTo: .callout),
        titleSmall: .pretendard(.medium, size: 14, relativeTo: .subheadline),

        bodyLarge: .pretendard(.regular, size: 16, relativeTo: .callout),
        bodyMedium: .pretendard(.regular, size: 14, relativeTo: .subheadline),
        bodySmall: .pretendard(.regular, size: 12, relativeTo: .caption),

        labelLarge: .pretendard(.medium, size: 14, relativeTo: .subheadline),
        labelMedium: .pretendard(.medium, size: 12, relativeTo: .caption),
        labelSmall: .pretendard(.medium, size: 11, relativeTo: .caption2)
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
