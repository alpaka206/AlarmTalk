import XCTest
@testable import AlarmTalk

/// **로그인 실패 문구는 비밀번호 입력창 아래에 붙는다.**
///
/// 2026-08-19 실기기 보고: 비밀번호를 틀려도 **틀린 줄을 몰랐다.** 문구가 제출 버튼·
/// 비밀번호 찾기·애플 로그인 행을 다 지난 화면 맨 아래(`statusMessage`)에 떴기 때문이다.
/// 안드로이드는 처음부터 `OutlinedTextField.supportingText` 로 입력창에 붙이고 있었다.
///
/// 자리(뷰)는 `LoginView.passwordField` 가 잡고, 여기서는 **무슨 말을 하는가**만 고정한다.
final class LoginErrorMessageTests: XCTestCase {

    func test_자격증명_불일치는_이메일과_비밀번호를_함께_확인하게_말한다() {
        let message = AuthViewModel.loginErrorMessage(
            for: APIError.server(status: 401, message: "Unauthorized", errorCode: "AUTH_INVALID_CREDENTIALS")
        )

        // 서버가 미가입과 비밀번호 불일치를 구분하지 않으므로(계정 존재 노출 방지)
        // "비밀번호가 틀렸어요" 로 단정하면 **없는 계정을 있다고 알려 주는 셈**이 된다.
        XCTAssertTrue(message.contains("이메일"), "이메일도 함께 확인하게 말해야 한다: \(message)")
        XCTAssertTrue(message.contains("비밀번호"), "비밀번호도 함께 확인하게 말해야 한다: \(message)")
    }

    func test_이메일_형식_오류는_이메일만_지목해_말한다() {
        // 서버는 로그인 바디에서 **이메일만** 형식에 안 맞으면 `AUTH_EMAIL_INVALID` 로
        // 답한다(`packages/backend/src/routes/auth.ts`). 예전에는 이것도
        // `AUTH_VALIDATION_FAILED` 로 뭉뚱그려 와서 "로그인에 실패했어요" 로 읽혔고,
        // 사용자는 멀쩡한 비밀번호를 계속 다시 쳤다.
        let message = AuthViewModel.loginErrorMessage(
            for: APIError.server(status: 400, message: "Invalid email address", errorCode: "AUTH_EMAIL_INVALID")
        )

        // 표에 없으면 아래 '모르는 코드' 와 같은 폴백 문장이 나온다 — 그걸 못 박는다.
        let fallback = AuthViewModel.loginErrorMessage(
            for: APIError.server(status: 400, message: "Nope", errorCode: "SOME_CODE_WE_DO_NOT_MAP")
        )
        XCTAssertNotEqual(message, fallback, "이 코드에 정해 둔 문구가 없다: \(message)")

        // 앱 1차 방어선(`LoginView` 제출 전 검사)과 **같은 문구**여야 한다. 앱이 먼저
        // 잡든 서버가 잡든 같은 말을 해야 사용자가 두 번 헤매지 않는다.
        XCTAssertEqual(message, APIErrorMessages.emailInvalid)

        // ⚠ 자격증명 불일치와 같은 말을 하면 안 된다 — 서버는 비밀번호를 보지도 않았다.
        let credentials = AuthViewModel.loginErrorMessage(
            for: APIError.server(status: 401, message: "Unauthorized", errorCode: "AUTH_INVALID_CREDENTIALS")
        )
        XCTAssertNotEqual(message, credentials)
    }

    /// ⚠ **화면이 갈래를 가르는 값과 뷰모델이 싣는 값이 같아야 한다**(2026-09-21 리뷰).
    /// `AuthViewModel.loginErrorCode` 는 `APIError.serverErrorCode` 를 그대로 싣고,
    /// `LoginView` 는 그 값을 `AuthEmailFormat.isEmailFormatErrorCode` 로 가른다.
    /// 예전에는 번역된 문구를 비교해서, 문구를 한 글자만 고쳐도 **아무 경고 없이**
    /// 형식 오류가 비밀번호 칸 아래로 내려갔다.
    func test_이메일_형식_갈래는_문구가_아니라_코드로_가른다() {
        let error = APIError.server(
            status: 400,
            message: "Invalid email address",
            errorCode: "AUTH_EMAIL_INVALID"
        )

        // 뷰모델이 싣는 값(= 화면이 보는 값).
        XCTAssertTrue(AuthEmailFormat.isEmailFormatErrorCode(error.serverErrorCode))
        // 그 코드의 문구는 앱 1차 방어선과 같은 한 줄이다 — 자리는 이메일 칸 하나뿐이다.
        XCTAssertEqual(AuthViewModel.loginErrorMessage(for: error), APIErrorMessages.emailInvalid)

        // 자격증명 실패는 이 갈래가 아니다 — 비밀번호 칸이 맡는다.
        let credentials = APIError.server(
            status: 401,
            message: "Unauthorized",
            errorCode: "AUTH_INVALID_CREDENTIALS"
        )
        XCTAssertFalse(AuthEmailFormat.isEmailFormatErrorCode(credentials.serverErrorCode))
    }

    func test_공용표가_있는_코드는_표의_문구를_쓴다() {
        // 로그인은 rate limit 미들웨어 뒤에 있어 429 가 실제로 온다. 그 코드에 문구가
        // 정해져 있으면 **표가 이긴다** — 안드로이드 로그인 갈래와 같은 층 순서다.
        let message = AuthViewModel.loginErrorMessage(
            for: APIError.server(status: 429, message: "Too many requests", errorCode: "RATE_LIMITED")
        )

        XCTAssertEqual(message, APIErrorMessages.message(for: "RATE_LIMITED"))
    }

    func test_표에_없는_코드는_한국어_서버문장을_쓴다() {
        // 마지막 층은 그대로다 — 서버가 한국어로 말하면 그 말을 쓴다.
        let message = AuthViewModel.loginErrorMessage(
            for: APIError.server(status: 400, message: "요청을 확인해 주세요", errorCode: "AUTH_VALIDATION_FAILED")
        )

        XCTAssertEqual(message, "요청을 확인해 주세요")
    }

    func test_영어_서버메시지는_폴백으로_바꾼다() {
        // 서버 메시지는 영어인 갈래가 많다 — 그대로 띄우면 한국어 화면에 영어가 섞인다.
        let message = AuthViewModel.loginErrorMessage(
            for: APIError.server(status: 500, message: "Internal error", errorCode: nil)
        )

        XCTAssertFalse(message.contains("Internal"), "영어 원문을 그대로 노출했다: \(message)")
        XCTAssertFalse(message.isEmpty)
    }
}
