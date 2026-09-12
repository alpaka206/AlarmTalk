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
