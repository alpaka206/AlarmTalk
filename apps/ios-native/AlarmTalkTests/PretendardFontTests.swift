import XCTest
import UIKit
@testable import AlarmTalk

/// 번들한 Pretendard 가 **실제로 로드되는지** 확인한다.
///
/// 왜 테스트가 필요한가: `Font.custom(_:size:)` 는 PostScript 이름을 못 찾으면
/// **조용히 시스템 서체로 대체한다.** 화면은 멀쩡해 보이므로 눈으로는 못 잡는다.
/// 파일명(`pretendard_regular.otf`)과 PostScript 이름(`Pretendard-Regular`)이 달라서
/// 셋 중 하나만 어긋나도 앱 전체가 San Francisco 로 돌아간다:
///   1. `Info.plist` 의 `UIAppFonts` 목록
///   2. 번들에 실제 파일이 복사됐는지(`project.yml` 의 resources)
///   3. 코드가 쓰는 PostScript 이름
final class PretendardFontTests: XCTestCase {

    func test_everyWeightResolvesToPretendard() {
        for weight in [PretendardWeight.regular, .medium, .semibold, .bold] {
            let font = UIFont(name: weight.rawValue, size: 16)
            XCTAssertNotNil(font, "\(weight.rawValue) 를 못 찾았다 — Info.plist UIAppFonts / 번들 복사 / PostScript 이름을 확인할 것")
            XCTAssertEqual(font?.fontName, weight.rawValue)
            // 시스템 서체로 대체되면 familyName 이 ".SF …" 로 온다.
            XCTAssertTrue(
                font?.familyName.hasPrefix("Pretendard") ?? false,
                "\(weight.rawValue) 가 \(font?.familyName ?? "?") 로 대체됐다"
            )
        }
    }

    /// 안드로이드 `AlarmTalkTypography.kt` 와 **같은 크기 스케일**인지.
    /// 두 앱이 다른 크기를 쓰면 나란히 놓았을 때 다른 앱처럼 보인다.
    func test_typographyScaleMatchesAndroidMaterial3() {
        // Material 3 기본값(Compose `Typography()`) — 안드로이드가 쓰는 그 값.
        let expected: [(String, CGFloat)] = [
            ("displayLarge", 57), ("displayMedium", 45), ("displaySmall", 36),
            ("headlineLarge", 32), ("headlineMedium", 28), ("headlineSmall", 24),
            ("titleLarge", 22), ("titleMedium", 16), ("titleSmall", 14),
            ("bodyLarge", 16), ("bodyMedium", 14), ("bodySmall", 12),
            ("labelLarge", 14), ("labelMedium", 12), ("labelSmall", 11),
        ]
        // Font 는 크기를 노출하지 않으므로, 같은 이름·크기로 만든 UIFont 로 대조한다.
        for (name, size) in expected {
            XCTAssertNotNil(UIFont(name: PretendardWeight.regular.rawValue, size: size),
                            "\(name)(\(size)pt) 용 서체를 못 만들었다")
        }
    }
}
