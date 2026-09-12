import XCTest
@testable import AlarmTalk

/// 이용권·초대·프로모션 코드 입력 규칙.
///
/// ⚠ **안드로이드 `sanitizeRedeemCode`(`ui/components/CodeRedeemField.kt`)와 같은 규칙이다.**
/// 한쪽만 고치면 한 앱에서만 통과하는 코드가 생긴다.
final class RedeemCodeSanitizerTests: XCTestCase {

    /// ⚠ **한글은 아예 들어가지 않아야 한다.**
    /// 예전에는 `isLetter` 로만 걸러서 한글이 그대로 통과했다 — 코드에는 쓰이지 않는데
    /// 입력은 되니, 사용자는 다 치고 나서야 "잘못된 코드" 를 봤다.
    func test_한글은_들어가지_않는다() {
        XCTAssertEqual(InputSanitizer.sanitizeRedeemCode("가나다"), "")
        XCTAssertEqual(InputSanitizer.sanitizeRedeemCode("AB가CD"), "ABCD")
    }

    /// 다른 문자 체계도 마찬가지다 — 코드는 ASCII 다.
    func test_한글_아닌_비ASCII_도_막는다() {
        XCTAssertEqual(InputSanitizer.sanitizeRedeemCode("ABひらCD"), "ABCD")
        XCTAssertEqual(InputSanitizer.sanitizeRedeemCode("АВС"), "", "키릴 문자는 라틴과 눈으로 같아 더 위험하다")
    }

    func test_소문자는_대문자로_바뀐다() {
        XCTAssertEqual(InputSanitizer.sanitizeRedeemCode("abcd1234"), "ABCD1234")
    }

    /// 하이픈·밑줄은 남긴다 — 발급 코드에 쓰인다.
    func test_하이픈과_밑줄은_남는다() {
        XCTAssertEqual(InputSanitizer.sanitizeRedeemCode("AB-CD_12"), "AB-CD_12")
    }

    func test_공백과_기호는_지운다() {
        XCTAssertEqual(InputSanitizer.sanitizeRedeemCode(" AB CD! "), "ABCD")
    }

    /// 발급 폼 상한(64)과 맞춘다.
    func test_예순네자에서_자른다() {
        XCTAssertEqual(InputSanitizer.sanitizeRedeemCode(String(repeating: "A", count: 70)).count, 64)
    }
}
