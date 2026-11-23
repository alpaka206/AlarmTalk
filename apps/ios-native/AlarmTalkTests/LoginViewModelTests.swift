import XCTest
@testable import AlarmTalk

/// Phase 3-C3 `LoginView` 에서 사용하는 검증 helper 의 단위 테스트.
///
/// 실제 네트워크 호출은 하지 않고, 입력 검증 규칙만 격리해서 검사한다.
///
/// ⚠ **이메일 형식은 더 이상 버튼을 죽이지 않는다** — 형식이 틀려도 누를 수 있고,
/// 누르면 이유를 말한다. 그 동작과 형식 규칙 본체는 `AuthEmailFormatTests` 가
/// 고정한다(여기 이메일 케이스는 그 표의 부분집합이다).
final class LoginViewModelTests: XCTestCase {
    // MARK: - Email

    func testValidEmailsAreAccepted() {
        XCTAssertTrue(AuthEmailFormat.isValid("user@example.com"))
        XCTAssertTrue(AuthEmailFormat.isValid("a.b+tag@sub.example.co"))
        XCTAssertTrue(AuthEmailFormat.isValid("WITH-CAPS@DOMAIN.COM"))
        // 서버(`@alarmtalk/shared` 의 `EMAIL_PATTERN`)가 받는 주소다. 예전 자체
        // 정규식은 이걸 거부해서, 이 주소로 가입한 사람은 로그인이 불가능했다.
        XCTAssertTrue(AuthEmailFormat.isValid("o'brien@example.com"))
    }

    func testInvalidEmailsAreRejected() {
        XCTAssertFalse(AuthEmailFormat.isValid(""))
        XCTAssertFalse(AuthEmailFormat.isValid("no-at-sign"))
        XCTAssertFalse(AuthEmailFormat.isValid("@no-local.com"))
        XCTAssertFalse(AuthEmailFormat.isValid("missing@tld"))
        XCTAssertFalse(AuthEmailFormat.isValid("space in@local.com"))
    }

    // MARK: - Password length

    func testPasswordLengthBoundary() {
        XCTAssertFalse(PasswordPolicy.lengthRange.contains("".count))
        XCTAssertFalse(PasswordPolicy.lengthRange.contains("1234567".count)) // 7 chars
        XCTAssertTrue(PasswordPolicy.lengthRange.contains("12345678".count)) // 8 chars
        XCTAssertTrue(PasswordPolicy.lengthRange.contains(String(repeating: "a", count: 128).count))
        XCTAssertFalse(PasswordPolicy.lengthRange.contains(String(repeating: "a", count: 129).count))
    }

    /// 가입과 재설정이 쓰는 한 벌(`PasswordPolicy`) — 서버 `PasswordSchema` 와 같은
    /// 8~128자 + 영문·숫자 각 1자 이상.
    func testPasswordPolicyRequiresLengthLetterAndDigit() {
        XCTAssertTrue(PasswordPolicy.isValid("abcd1234"))
        XCTAssertFalse(PasswordPolicy.isValid("abc1234"), "7자")
        XCTAssertFalse(PasswordPolicy.isValid("abcdefgh"), "숫자 없음")
        XCTAssertFalse(PasswordPolicy.isValid("12345678"), "영문 없음")
        XCTAssertTrue(PasswordPolicy.isValid(String(repeating: "a", count: 127) + "1"), "128자")
        XCTAssertFalse(PasswordPolicy.isValid(String(repeating: "a", count: 128) + "1"), "129자")
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
        XCTAssertEqual(PlanTier.from("plus"), .personal)
        // legacy iOS keys
        XCTAssertEqual(PlanTier.from("plus_monthly"), .personal)
        XCTAssertEqual(PlanTier.from("plus_yearly"), .personal)
        // 커플·가족 이용권은 없어졌다 — 남은 키는 유료가 아니다.
        XCTAssertEqual(PlanTier.from("couple"), .free)
        XCTAssertEqual(PlanTier.from("family"), .free)
        XCTAssertEqual(PlanTier.from("family_monthly"), .free)
        // unknown -> free
        XCTAssertEqual(PlanTier.from("enterprise"), .free)
    }

    func testPlanTierOrdering() {
        XCTAssertTrue(PlanTier.personal.meetsOrExceeds(.free))
        XCTAssertTrue(PlanTier.personal.meetsOrExceeds(.personal))
        XCTAssertFalse(PlanTier.free.meetsOrExceeds(.personal))
        XCTAssertEqual(PlanTier.allCases, [.free, .personal])
    }
}
