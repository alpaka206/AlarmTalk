import XCTest
@testable import AlarmTalk

/// 이메일 형식 판정이 **서버와 같은 답**을 내는지 고정한다.
///
/// 같은 표가 세 곳에 있다 — `packages/shared/test/schemas.test.ts`,
/// 안드로이드 `app/src/test/java/com/alarmtalk/app/AuthEmailFormatTest.kt`.
/// **한 줄을 고치면 셋을 같이 고친다.** 앱이 서버보다 느슨하면 서버가 거절하고,
/// 빡빡하면 서버가 허용하는 주소를 못 쓴다 — 예전에는 후자였고, 아포스트로피가 든
/// 주소로 가입한 사람은 **로그인 자체가 불가능**했다.
final class AuthEmailFormatTests: XCTestCase {

    /// 입력 · 기대 · 무엇을 보는 줄인지. 세 구현이 공유하는 목록이다.
    private let cases: [(input: String, expected: Bool, why: String)] = [
        // ⚠ 이 줄이 이 표가 생긴 이유다. CLAUDE.md 「"O'Brien" 은 정당한 이름이다」.
        ("o'brien@example.com", true, "아포스트로피"),
        // 반대 방향. 앱은 받았는데 서버가 거절해 왔다 — 이제 앱도 같이 거절한다.
        ("user%tag@example.com", false, "퍼센트"),
        ("  KIM@Example.COM  ", true, "앞뒤 공백 + 대문자"),
        ("WITH-CAPS@DOMAIN.COM", true, "대문자"),
        ("a.b+tag@sub.example.co", true, "점·플러스·서브도메인"),
        ("no-at-sign", false, "@ 없음"),
        ("a@example.c", false, "TLD 1글자"),
        ("@no-local.com", false, "로컬 파트 없음"),
        ("space in@local.com", false, "가운데 공백"),
        ("", false, "빈 문자열"),
    ]

    func testSharedCaseTable() {
        for (input, expected, why) in cases {
            XCTAssertEqual(
                AuthEmailFormat.isValid(input),
                expected,
                "\(why): [\(input)]"
            )
        }
    }

    /// 서버 `packages/shared/src/schemas/auth.ts` 의 `EMAIL_PATTERN` 과 같은 값.
    /// 여기서 바뀌면 서버도 같이 바꿔야 하므로 값을 못 박아 "한쪽만 고치고 끝" 을 막는다.
    func testPatternMatchesServerConstant() {
        XCTAssertEqual(
            AuthEmailFormat.pattern,
            #"^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$"#
        )
    }

    /// 자동완성·복사붙여넣기가 붙이는 값이다. 순서가 뒤집히면 공백 하나에 막힌다.
    func testNormalizeRunsBeforeFormatCheck() {
        XCTAssertEqual(AuthEmailFormat.normalize("  KIM@Example.COM \n"), "kim@example.com")
    }

    /// ⚠ **형식으로 버튼을 죽이지 않는다**(CLAUDE.md 「잠그는 것은 '저장 중' 일 때뿐이다」).
    /// 죽은 버튼은 이유를 알려 주지 않아 고장으로 읽힌다 — 누를 수 있게 두고, 누르면
    /// 왜 안 되는지 말한다.
    func testMalformedEmailKeepsSubmitButtonAlive() {
        XCTAssertTrue(AuthEmailFormat.canSubmitLogin(email: "o'brien@", password: "any-non-empty"))
        XCTAssertEqual(
            AuthEmailFormat.submitOutcome(email: "o'brien@"),
            .showEmailFormatError
        )
    }

    /// ⚠ **가입·재설정도 같은 규칙이다**(2026-09-21 리뷰). 예전에는 로그인만 "누를 수 있고
    /// 누르면 말한다" 였고, 가입의 '이메일 인증' 과 재설정의 '인증 코드 받기' 는 형식으로
    /// 버튼을 죽인 채 **아무 말도 하지 않았다.** 같은 주소를 두고 화면마다 다르게 굴면
    /// 사용자는 어느 쪽이 고장인지 알 수 없다.
    func testEmailOnlyButtonsAreNotLockedByFormat() {
        XCTAssertTrue(AuthEmailFormat.canRequestEmailCode("o'brien@"))
        XCTAssertEqual(
            AuthEmailFormat.submitOutcome(email: "o'brien@"),
            .showEmailFormatError
        )
        // 잠기는 것은 보낼 것이 없을 때뿐이다.
        XCTAssertFalse(AuthEmailFormat.canRequestEmailCode(""))
        XCTAssertFalse(AuthEmailFormat.canRequestEmailCode("   "))
    }

    /// ⚠ **갈래는 번역된 문구가 아니라 에러 코드로 가른다**(2026-09-21 리뷰).
    /// 예전에는 `LoginView` 가 `auth.loginError == APIErrorMessages.emailInvalid` 로
    /// 비교해서, 문구를 한 글자 고치거나 다른 코드가 같은 문장을 쓰는 순간 **아무 경고
    /// 없이** 형식 오류가 비밀번호 칸 아래로 내려갔다.
    func testEmailFormatBranchIsDecidedByErrorCode() {
        XCTAssertEqual(AuthEmailFormat.emailInvalidErrorCode, "AUTH_EMAIL_INVALID")
        XCTAssertTrue(AuthEmailFormat.isEmailFormatErrorCode(AuthEmailFormat.emailInvalidErrorCode))
        // 비밀번호를 보고 낸 실패는 이 갈래가 아니다 — 비밀번호 칸이 맡는다.
        XCTAssertFalse(AuthEmailFormat.isEmailFormatErrorCode("AUTH_INVALID_CREDENTIALS"))
        XCTAssertFalse(AuthEmailFormat.isEmailFormatErrorCode("AUTH_VALIDATION_FAILED"))
        // 코드가 없는 실패(네트워크 단절 등)도 형식 갈래가 아니다.
        XCTAssertFalse(AuthEmailFormat.isEmailFormatErrorCode(nil))
    }

    /// 형식과 달리 이쪽은 "무엇을 보낼지" 자체가 없다 — 알럿으로 말할 내용도 없다.
    func testEmptyFieldsLockTheButton() {
        XCTAssertFalse(AuthEmailFormat.canSubmitLogin(email: "", password: "any-non-empty"))
        XCTAssertFalse(AuthEmailFormat.canSubmitLogin(email: "kim@example.com", password: "   "))
    }

    func testWellFormedEmailGoesToServer() {
        XCTAssertEqual(
            AuthEmailFormat.submitOutcome(email: "o'brien@example.com"),
            .submit
        )
        // 앞뒤 공백은 정규화가 걷어내므로 그대로 보낼 수 있다.
        XCTAssertEqual(
            AuthEmailFormat.submitOutcome(email: "  KIM@Example.COM  "),
            .submit
        )
    }

    /// 옛 입구(`LoginValidator`)도 같은 판정이어야 한다 — 여기만 갈라지면 로그인은
    /// 되는데 비밀번호 재설정만 막히는 계정이 생긴다.
    func testLoginValidatorDelegatesToTheSameRule() {
        for (input, expected, why) in cases {
            XCTAssertEqual(LoginValidator.isValidEmail(input), expected, "\(why): [\(input)]")
        }
    }
}
