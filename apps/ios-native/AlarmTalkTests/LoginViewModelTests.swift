import XCTest
@testable import AlarmTalk

/// Phase 3-C3 `LoginView` 에서 사용하는 검증 helper 의 단위 테스트.
///
/// 실제 네트워크 호출은 하지 않고, 입력 검증 규칙만 격리해서 검사한다. UI 가
/// disabled 처리하는 조건과 동일한 규칙을 사용하므로 본 테스트가 통과하면
/// "버튼 활성 조건" 도 만족된다.
final class LoginViewModelTests: XCTestCase {
    // MARK: - Email

    func testValidEmailsAreAccepted() {
        XCTAssertTrue(LoginValidator.isValidEmail("user@example.com"))
        XCTAssertTrue(LoginValidator.isValidEmail("a.b+tag@sub.example.co"))
        XCTAssertTrue(LoginValidator.isValidEmail("WITH-CAPS@DOMAIN.COM"))
    }

    func testInvalidEmailsAreRejected() {
        XCTAssertFalse(LoginValidator.isValidEmail(""))
        XCTAssertFalse(LoginValidator.isValidEmail("no-at-sign"))
        XCTAssertFalse(LoginValidator.isValidEmail("@no-local.com"))
        XCTAssertFalse(LoginValidator.isValidEmail("missing@tld"))
        XCTAssertFalse(LoginValidator.isValidEmail("space in@local.com"))
    }

    // MARK: - Password length

    func testPasswordLengthBoundary() {
        XCTAssertFalse(LoginValidator.isValidPasswordLength(""))
        XCTAssertFalse(LoginValidator.isValidPasswordLength("1234567")) // 7 chars
        XCTAssertTrue(LoginValidator.isValidPasswordLength("12345678")) // 8 chars
        XCTAssertTrue(LoginValidator.isValidPasswordLength(String(repeating: "a", count: 128)))
        XCTAssertFalse(LoginValidator.isValidPasswordLength(String(repeating: "a", count: 129)))
    }

    // MARK: - Verification code

    func testVerificationCodeRequiresSixDigits() {
        XCTAssertFalse(LoginValidator.isValidVerificationCode(""))
        XCTAssertFalse(LoginValidator.isValidVerificationCode("12345"))   // 5 digits
        XCTAssertFalse(LoginValidator.isValidVerificationCode("1234567")) // 7 digits
        XCTAssertFalse(LoginValidator.isValidVerificationCode("12345a"))  // contains letter
        XCTAssertTrue(LoginValidator.isValidVerificationCode("000000"))   // 6 zeros
        XCTAssertTrue(LoginValidator.isValidVerificationCode("987654"))
    }

    // MARK: - PlanTier mapping

    func testPlanTierMapsLegacyKeys() {
        XCTAssertEqual(PlanTier.from(nil), .free)
        XCTAssertEqual(PlanTier.from("free"), .free)
        XCTAssertEqual(PlanTier.from("personal"), .personal)
        XCTAssertEqual(PlanTier.from("couple"), .couple)
        XCTAssertEqual(PlanTier.from("family"), .family)
        // legacy iOS keys
        XCTAssertEqual(PlanTier.from("plus_monthly"), .personal)
        XCTAssertEqual(PlanTier.from("plus_yearly"), .personal)
        XCTAssertEqual(PlanTier.from("family_monthly"), .family)
        // unknown -> free
        XCTAssertEqual(PlanTier.from("enterprise"), .free)
    }

    func testPlanTierOrdering() {
        XCTAssertTrue(PlanTier.family.meetsOrExceeds(.couple))
        XCTAssertTrue(PlanTier.couple.meetsOrExceeds(.personal))
        XCTAssertTrue(PlanTier.personal.meetsOrExceeds(.free))
        XCTAssertFalse(PlanTier.free.meetsOrExceeds(.personal))
        XCTAssertFalse(PlanTier.personal.meetsOrExceeds(.family))
        XCTAssertTrue(PlanTier.family.meetsOrExceeds(.family))
    }
}
