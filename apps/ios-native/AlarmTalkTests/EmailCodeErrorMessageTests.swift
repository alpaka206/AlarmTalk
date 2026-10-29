import AuthenticationServices
import XCTest
@testable import AlarmTalk

/// **인증 코드의 거절은 코드(error_code)로 말하고, 거절된 숫자는 칸에 남기지 않는다** —
/// `docs/spec/session-and-auth.md` 「이메일 인증 코드」.
///
/// 2026-10-09 prod: 신규 가입자 한 명이 거절된 같은 여섯 자리를 3초 사이에 다섯 번 보내 시도
/// 상한을 태웠고, 그 뒤의 429 에도 "인증 코드가 맞지 않아요" 만 들었다. 코드를 다시 받아도 옛
/// 숫자가 칸에 남았다(꽉 찬 칸에 치는 새 숫자는 버려진다). iOS 도 같은 모양이었다 — 인증 확인의
/// 폴백이 '맞지 않아요' 였고 폴백 헬퍼는 코드를 보지 않아, 400·429·네트워크 실패가 전부 그 한
/// 문장이었다.
///
/// 자리(뷰)는 `LoginView.verificationCodeRow`·`PasswordResetView` 가 잡는다. 여기서는 **무슨 말을
/// 하는가**와 **뷰모델이 올리는 신호**를 고정한다. 화면이 그 신호로 칸을 비우는 것은 UI 테스트의
/// 몫인데 CI 에서 돌지 않는다 — 실기기로 본다.
@MainActor
final class EmailCodeErrorMessageTests: XCTestCase {
    private let mismatch = "맞지 않아요"
    private let verifyFallback = APIErrorMessages.temporaryFailure
    private let registerFallback = "회원가입에 실패했어요"
    private let resetFallback = "비밀번호 재설정에 실패했어요"
    private let sendFallback = "인증 코드를 보내지 못했어요"

    private func refusal(_ status: Int, _ code: String) -> APIError {
        .server(status: status, message: "refused", errorCode: code)
    }

    // MARK: - 문장

    func test_틀린_코드만_맞지_않다고_말한다() {
        let message = AuthViewModel.emailCodeErrorMessage(
            for: refusal(400, "AUTH_EMAIL_CODE_INVALID"), fallback: verifyFallback
        )

        XCTAssertEqual(message, "인증 코드가 맞지 않아요. 다시 확인해 주세요.")
        XCTAssertEqual(message, APIErrorMessages.message(for: "AUTH_EMAIL_CODE_INVALID"))
    }

    /// 상한(429) 뒤에는 **맞는 코드를 넣어도** 같은 답이다. '맞지 않아요' 라고 말하면 사용자는
    /// 숫자만 다시 본다 — 할 일은 다시 받기 하나다.
    func test_만료와_시도_상한은_다시_받으라고_말한다() {
        let expired = AuthViewModel.emailCodeErrorMessage(
            for: refusal(400, "AUTH_EMAIL_CODE_EXPIRED"), fallback: verifyFallback
        )
        let attempts = AuthViewModel.emailCodeErrorMessage(
            for: refusal(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"), fallback: verifyFallback
        )

        XCTAssertEqual(expired, "인증 코드가 만료됐어요. 다시 받아 주세요.")
        XCTAssertEqual(attempts, "인증 코드를 너무 많이 틀렸어요. 다시 받아 주세요.")
        for message in [expired, attempts] {
            XCTAssertFalse(message.contains(mismatch), "거절 이유가 다른데 틀렸다고 말한다: \(message)")
        }
    }

    /// 인증 라우트는 rate limit 미들웨어 뒤에 있어 `RATE_LIMITED` 429 가 실제로 온다. 상한의
    /// 429 와 상태코드가 같아도 **다른 말**이어야 한다 — 이쪽은 기다리면 풀린다.
    func test_그_밖의_코드는_표의_문장을_쓴다() {
        let message = AuthViewModel.emailCodeErrorMessage(
            for: refusal(429, "RATE_LIMITED"), fallback: verifyFallback
        )

        XCTAssertEqual(message, APIErrorMessages.message(for: "RATE_LIMITED"))
        XCTAssertFalse(message.contains(mismatch))
    }

    /// ⚠ **'맞지 않아요' 는 폴백이 아니다.** 코드가 없거나 표에 없는 실패(5xx·형식 오류·네트워크)는
    /// 코드가 틀렸다는 답이 아니다.
    func test_코드가_없거나_표에_없는_실패는_화면_폴백이고_맞지_않다고_말하지_않는다() {
        let failures: [Error] = [
            APIError.server(status: 500, message: "Internal error", errorCode: nil),
            APIError.server(status: 500, message: "boom", errorCode: "AUTH_EMAIL_CODE_VERIFY_FAILED"),
            APIError.server(status: 400, message: "Validation failed", errorCode: "AUTH_VALIDATION_FAILED"),
            APIError.invalidResponse,
        ]
        for failure in failures {
            let message = AuthViewModel.emailCodeErrorMessage(for: failure, fallback: verifyFallback)
            XCTAssertEqual(message, verifyFallback, "\(failure)")
            XCTAssertFalse(message.contains(mismatch), "\(failure)")
        }

        // 네트워크 실패는 시스템 문구가 나올 수 있다 — 무엇이든 '맞지 않아요' 는 아니다.
        let offline = AuthViewModel.emailCodeErrorMessage(
            for: URLError(.notConnectedToInternet), fallback: verifyFallback
        )
        XCTAssertFalse(offline.isEmpty)
        XCTAssertFalse(offline.contains(mismatch), offline)
    }

    /// 가입·재설정 확정도 서버의 같은 판정을 지난다 — 코드의 문장은 같고, 폴백만 그 화면의 것이다.
    func test_가입과_재설정도_같은_표를_쓰고_폴백만_그_화면의_실패_문장이다() {
        for fallback in [registerFallback, resetFallback] {
            XCTAssertEqual(
                AuthViewModel.emailCodeErrorMessage(for: refusal(400, "AUTH_EMAIL_CODE_EXPIRED"), fallback: fallback),
                "인증 코드가 만료됐어요. 다시 받아 주세요."
            )
            XCTAssertEqual(
                AuthViewModel.emailCodeErrorMessage(
                    for: refusal(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"), fallback: fallback
                ),
                "인증 코드를 너무 많이 틀렸어요. 다시 받아 주세요."
            )
            XCTAssertEqual(
                AuthViewModel.emailCodeErrorMessage(
                    for: APIError.server(status: 500, message: "boom", errorCode: nil), fallback: fallback
                ),
                fallback
            )
        }
    }

    // MARK: - 코드 칸을 비우는 판정

    /// 비우는 것은 **서버가 코드를 거절한 셋뿐**이다. 나머지는 코드가 틀렸다는 답이 아니므로
    /// 숫자를 그대로 두어 다시 누를 수 있게 한다.
    func test_코드_칸을_비우는_것은_거절_셋뿐이다() {
        for code in ["AUTH_EMAIL_CODE_INVALID", "AUTH_EMAIL_CODE_EXPIRED", "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"] {
            XCTAssertTrue(AuthViewModel.isEmailCodeRefusal(code), code)
        }
        let kept: [String?] = [
            "RATE_LIMITED", "AUTH_VALIDATION_FAILED", "AUTH_EMAIL_CODE_VERIFY_FAILED",
            "AUTH_EMAIL_TAKEN", "INTERNAL_ERROR", "", nil,
        ]
        for code in kept {
            XCTAssertFalse(AuthViewModel.isEmailCodeRefusal(code), code ?? "nil")
        }
    }

    // MARK: - 뷰모델이 올리는 신호(배선)

    func test_인증_확인이_거절되면_문장은_코드_줄_아래로_가고_코드_칸을_비운다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        for (status, code) in [
            (400, "AUTH_EMAIL_CODE_INVALID"), (400, "AUTH_EMAIL_CODE_EXPIRED"),
            (429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"),
        ] {
            api.verifyError = refusal(status, code)
            let before = model.emailCodeFieldClearTick

            let verified = await model.verifyEmailCode(email: "new@example.test", code: "123456")

            XCTAssertFalse(verified, code)
            XCTAssertEqual(model.emailCodeError, APIErrorMessages.message(for: code), code)
            XCTAssertNil(model.statusMessage, "문장을 하단 상태 줄에 두면 숫자 키패드 뒤에 놓인다: \(code)")
            XCTAssertEqual(model.emailCodeFieldClearTick, before + 1, "거절된 숫자가 칸에 남는다: \(code)")
            XCTAssertFalse(model.isBusy)
        }
    }

    func test_코드와_무관한_인증_확인_실패는_숫자를_그대로_둔다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        let failures: [Error] = [
            refusal(429, "RATE_LIMITED"),
            APIError.server(status: 500, message: "boom", errorCode: nil),
            URLError(.timedOut),
        ]
        for failure in failures {
            api.verifyError = failure
            let before = model.emailCodeFieldClearTick

            let verified = await model.verifyEmailCode(email: "new@example.test", code: "123456")

            XCTAssertFalse(verified)
            let message = model.emailCodeError ?? ""
            XCTAssertFalse(message.isEmpty, "실패했는데 코드 줄에 아무 말이 없다: \(failure)")
            XCTAssertFalse(message.contains(mismatch), "코드가 틀렸다는 답이 아니다: \(failure)")
            XCTAssertEqual(model.emailCodeFieldClearTick, before, "다시 누를 숫자를 지웠다: \(failure)")
        }
    }

    func test_인증_확인이_통과하면_경고도_신호도_없다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        let before = model.emailCodeFieldClearTick

        let verified = await model.verifyEmailCode(email: "new@example.test", code: "123456")

        XCTAssertTrue(verified)
        XCTAssertNil(model.emailCodeError)
        XCTAssertEqual(model.emailCodeFieldClearTick, before)
    }

    /// 칸은 6자에서 잘린다 — 비우지 않으면 새로 받은 코드를 쳐도 한 글자도 안 들어가고 옛 숫자가
    /// 다시 나간다. 다시 받는 중에 앞 코드에 대한 경고("…다시 받아 주세요")도 남기지 않는다.
    func test_다시_받기가_성공하면_코드_칸을_비우고_앞_경고를_지운다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        api.verifyError = refusal(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED")
        _ = await model.verifyEmailCode(email: "new@example.test", code: "123456")
        XCTAssertNotNil(model.emailCodeError)
        let before = model.emailCodeFieldClearTick

        let sent = await model.requestEmailVerification(email: "new@example.test")

        XCTAssertTrue(sent)
        XCTAssertNil(model.emailCodeError)
        XCTAssertEqual(model.emailCodeFieldClearTick, before + 1)

        // 보내지 못했으면 칸을 건드리지 않는다 — 쥐고 있는 코드가 아직 살아 있을 수 있다.
        api.requestError = URLError(.timedOut)
        let failed = await model.requestEmailVerification(email: "new@example.test")
        XCTAssertFalse(failed)
        XCTAssertEqual(model.emailCodeFieldClearTick, before + 1)
    }

    /// 다시 받기가 **실패해도** 답은 인라인 자리(`emailCodeError` — 가입 화면의 코드 줄 아래)에 선다.
    /// 상한·만료로 "…다시 받아 주세요" 를 읽고 다시 받기를 누른 사람에게 그 실패를 하단 상태 줄에
    /// 두면, 답이 숫자 키패드 뒤로 숨어 눌러도 반응이 없는 것처럼 보인다(2026-10-11 리뷰). 안드로이드도
    /// 같은 실패를 인라인 `registerError` 에 둔다.
    ///
    /// 실패에도 코드 줄을 닫지 않는 것은 화면(`LoginView.verifyEmailRow`)의 몫이고 자동 테스트가 없다 —
    /// 실기기로 본다.
    func test_다시_받기가_실패하면_문장은_인라인_자리로_가고_칸은_그대로다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        // 앞 회차: 코드를 받았고, 틀린 횟수가 상한에 닿았다.
        _ = await model.requestEmailVerification(email: "new@example.test")
        api.verifyError = refusal(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED")
        _ = await model.verifyEmailCode(email: "new@example.test", code: "123456")
        let before = model.emailCodeFieldClearTick

        let failures: [Error] = [
            URLError(.timedOut),
            APIError.server(status: 500, message: "boom", errorCode: nil),
            refusal(429, "RATE_LIMITED"),
        ]
        for failure in failures {
            api.requestError = failure

            let sent = await model.requestEmailVerification(email: "new@example.test")

            XCTAssertFalse(sent, "\(failure)")
            // 문장은 그대로다 — 코드 요청은 공용 표를 부르는 자리가 아니다(error-codes.md §4). 자리만 옮겼다.
            XCTAssertEqual(
                model.emailCodeError, userFacingErrorMessage(failure, fallback: sendFallback), "\(failure)"
            )
            XCTAssertNil(model.statusMessage, "다시 받기의 실패를 하단 상태 줄에 두면 숫자 키패드 뒤에 놓인다: \(failure)")
            XCTAssertEqual(model.emailCodeFieldClearTick, before, "보내지 못했는데 쥐고 있던 숫자를 지웠다: \(failure)")
            XCTAssertFalse(model.isBusy)
        }

        // 앞서 보냈다는 하단 안내도 지운다 — 남기면 한 화면이 '보냈어요' 와 '보내지 못했어요' 를 함께 말한다.
        api.requestError = nil
        _ = await model.requestEmailVerification(email: "new@example.test")
        XCTAssertNotNil(model.statusMessage)
        api.requestError = URLError(.timedOut)
        _ = await model.requestEmailVerification(email: "new@example.test")
        XCTAssertNil(model.statusMessage)
        XCTAssertNotNil(model.emailCodeError)
    }

    /// 가입은 같은 코드를 **한 번 더** 판정한다 — 인증을 통과하고도 10분이 지나 가입을 누르면
    /// 만료로 거절된다. 그때 화면은 이 신호로 '인증 완료' 를 내려 코드 줄과 다시 받기를 되돌린다
    /// (`LoginView`). 신호가 없으면 꺼진 다시 받기 옆에서 "다시 받아 주세요" 라고 말하게 된다.
    func test_가입이_코드를_거절하면_문장을_코드_줄에_세우고_신호를_올린다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        api.registerError = refusal(400, "AUTH_EMAIL_CODE_EXPIRED")
        let before = model.emailCodeFieldClearTick

        await model.registerWithEmail(
            email: "new@example.test", password: "abcd1234", name: "새 사용자", verificationCode: "123456"
        )

        XCTAssertEqual(model.emailCodeError, "인증 코드가 만료됐어요. 다시 받아 주세요.")
        XCTAssertNil(model.statusMessage)
        XCTAssertEqual(model.emailCodeFieldClearTick, before + 1)
    }

    /// 코드와 무관한 가입 실패는 '인증 완료' 를 내리지 않는다 — 같은 코드로 다시 누르면 된다.
    func test_코드와_무관한_가입_실패는_인증_상태를_건드리지_않는다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        let before = model.emailCodeFieldClearTick

        api.registerError = APIError.server(status: 500, message: "boom", errorCode: nil)
        await model.registerWithEmail(
            email: "new@example.test", password: "abcd1234", name: "새 사용자", verificationCode: "123456"
        )
        // 자리는 인증 확인의 실패와 같은 인라인 자리다 — 하단 상태 줄은 키패드 뒤에 놓일 수 있다.
        XCTAssertEqual(model.emailCodeError, registerFallback)
        XCTAssertNil(model.statusMessage)
        XCTAssertEqual(model.emailCodeFieldClearTick, before, "코드가 거절된 것이 아닌데 '인증 완료' 를 내린다")

        // 표에 있는 코드는 가입에서도 표의 문장이다(예전에는 전부 "회원가입에 실패했어요" 였다).
        api.registerError = refusal(429, "RATE_LIMITED")
        await model.registerWithEmail(
            email: "new@example.test", password: "abcd1234", name: "새 사용자", verificationCode: "123456"
        )
        XCTAssertEqual(model.emailCodeError, APIErrorMessages.message(for: "RATE_LIMITED"))
        XCTAssertEqual(model.emailCodeFieldClearTick, before)

        // 고쳐 치기 시작하면 화면이 지운다.
        model.clearEmailCodeError()
        XCTAssertNil(model.emailCodeError)
    }

    func test_재설정_확정이_코드를_거절하면_표의_문장을_말하고_코드_칸을_비운다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        api.resetConfirmError = refusal(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED")
        let before = model.emailCodeFieldClearTick

        let changed = await model.confirmPasswordReset(
            email: "old@example.test", code: "123456", newPassword: "abcd1234"
        )

        XCTAssertFalse(changed)
        XCTAssertEqual(model.statusMessage, "인증 코드를 너무 많이 틀렸어요. 다시 받아 주세요.")
        XCTAssertTrue(model.statusIsError)
        XCTAssertEqual(model.emailCodeFieldClearTick, before + 1)

        // 코드와 무관한 실패는 그 화면의 실패 문장이고, 숫자는 그대로 둔다.
        api.resetConfirmError = APIError.server(status: 500, message: "boom", errorCode: nil)
        _ = await model.confirmPasswordReset(email: "old@example.test", code: "123456", newPassword: "abcd1234")
        XCTAssertEqual(model.statusMessage, resetFallback)
        XCTAssertEqual(model.emailCodeFieldClearTick, before + 1)
    }

    func test_재설정_코드를_다시_받으면_코드_칸을_비운다() async {
        let api = StubEmailCodeAPI()
        let model = makeModel(api)
        let before = model.emailCodeFieldClearTick

        await model.requestPasswordReset(email: "old@example.test")

        XCTAssertEqual(model.passwordResetCodeSentTo, "old@example.test")
        XCTAssertEqual(model.emailCodeFieldClearTick, before + 1)
    }

    // MARK: - Sentry 보고 — 실패마다 한 번, 안드로이드와 같은 글자로

    /// 인증 코드 다섯 갈래는 잡은 실패를 **빠짐없이** 올린다. 2026-10-11 전에는 iOS 가 하나도 올리지 않아
    /// 1.2.10 의 막다른 길(시도 상한 뒤의 429)이 Sentry 에서 한쪽 앱으로만 보였다.
    ///
    /// 메시지는 안드로이드 `ui/main/MainViewModelAuthActions.kt` 의 보고와 **같은 글자**여야 한다 — 그 글자가
    /// `log.key` 태그이자 묶음 키의 셋째 마디라, 한 글자만 달라도 같은 실패가 두 프로젝트에서 다른 이름이 된다.
    /// 그래서 여기 글자를 그대로 적는다(상수를 따라가게 두면 상수를 고친 실수를 못 잡는다).
    func test_인증_코드_다섯_갈래의_실패는_정해진_글자로_한_번씩_올린다() async {
        let api = StubEmailCodeAPI()
        let reported = ReportedFailures()
        let model = makeModel(api, reported: reported)

        // 성공은 올리지 않는다.
        _ = await model.requestEmailVerification(email: "new@example.test")
        _ = await model.verifyEmailCode(email: "new@example.test", code: "123456")
        await model.requestPasswordReset(email: "old@example.test")
        _ = await model.confirmPasswordReset(email: "old@example.test", code: "123456", newPassword: "abcd1234")
        XCTAssertTrue(reported.entries.isEmpty, "성공을 올렸다: \(reported.messages)")

        let sendFailed = APIError.server(
            status: 503, message: "Failed to send email code", errorCode: "AUTH_EMAIL_CODE_SEND_FAILED"
        )
        api.requestError = sendFailed
        _ = await model.requestEmailVerification(email: "new@example.test")
        api.verifyError = refusal(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED")
        _ = await model.verifyEmailCode(email: "new@example.test", code: "123456")
        api.registerError = refusal(400, "AUTH_EMAIL_CODE_EXPIRED")
        await model.registerWithEmail(
            email: "new@example.test", password: "abcd1234", name: "새 사용자", verificationCode: "123456"
        )
        api.resetRequestError = sendFailed
        await model.requestPasswordReset(email: "old@example.test")
        api.resetConfirmError = refusal(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED")
        _ = await model.confirmPasswordReset(email: "old@example.test", code: "123456", newPassword: "abcd1234")

        XCTAssertEqual(reported.messages, [
            "Email verification request failed",
            "Email verification confirm failed",
            "Email registration failed",
            "Password reset request failed",
            "Password reset confirm failed",
        ])
        // 받은 오류를 **그대로** 올린다 — 감싸거나 바꾸면 보고 함수가 상태·코드를 읽지 못해 묶음 키가 사라진다.
        XCTAssertEqual(reported.entries.map { ($0.error as? APIError)?.serverErrorCode }, [
            "AUTH_EMAIL_CODE_SEND_FAILED", "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED", "AUTH_EMAIL_CODE_EXPIRED",
            "AUTH_EMAIL_CODE_SEND_FAILED", "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED",
        ])
        // 값 토큰(` key=value`)이 없는 글자라 `log.key` 는 메시지 그대로다 — 안드로이드 `logKeyOf` 와 같은 값이다.
        for message in reported.messages {
            XCTAssertEqual(AlarmTalkLog.logKey(of: message), message)
        }
    }

    /// 호출부는 **거르지 않는다** — 이슈로 올릴지 브레드크럼으로 내릴지는 보고 함수 한 곳이 정한다
    /// (`AlarmTalkLog.handledFailureCategory`, `docs/spec/error-codes.md` §3). 같은 자리에서 올린 다섯 실패가:
    /// - 시도 상한의 거절은 **이슈**이고 묶음 키는 `[api_error, 코드, 호출 자리]` 다(1.2.10 의 막다른 길이 이것으로 보인다).
    /// - 틀린 숫자(`AUTH_EMAIL_CODE_INVALID`)는 사용자가 고칠 예상된 거절이라 브레드크럼(`refusal`)이다.
    /// - 코드 없는 5xx 는 이슈이고, 호출 자리를 빼고 묶는다(게이트웨이 장애를 화면 수만큼 쪼개지 않는다).
    /// - 일시적 네트워크 실패는 브레드크럼(`transient`)이다.
    /// - 401 은 브레드크럼(`auth`)이다. 이 라우트들은 401 을 내지 않지만(인증 미들웨어 밖이다), 오더라도
    ///   안드로이드(상태코드 401 이면 브레드크럼)와 같은 갈래로 간다.
    func test_올린_실패의_갈래와_묶음_키는_보고_함수가_정한다() async {
        let api = StubEmailCodeAPI()
        let reported = ReportedFailures()
        let model = makeModel(api, reported: reported)
        let failures: [Error] = [
            refusal(429, "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"),
            APIError.server(status: 503, message: "Service Unavailable", errorCode: nil),
            URLError(.timedOut),
            APIError.server(status: 401, message: "Unauthorized", errorCode: nil),
            refusal(400, "AUTH_EMAIL_CODE_INVALID"),
        ]
        for failure in failures {
            api.verifyError = failure
            _ = await model.verifyEmailCode(email: "new@example.test", code: "123456")
        }

        XCTAssertEqual(
            reported.messages, Array(repeating: "Email verification confirm failed", count: failures.count),
            "실패마다 한 번씩 올려야 한다 — 거르는 것은 보고 함수다"
        )
        guard reported.entries.count == failures.count else { return }
        let refused = reported.entries[0]
        let gateway = reported.entries[1]
        let offline = reported.entries[2]
        let unauthorized = reported.entries[3]
        let mistyped = reported.entries[4]

        XCTAssertNil(AlarmTalkLog.handledFailureCategory(refused.error), "시도 상한의 거절을 브레드크럼으로 내렸다")
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(for: refused.error, message: refused.message),
            ["api_error", "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED", "Email verification confirm failed"]
        )
        XCTAssertNil(AlarmTalkLog.handledFailureCategory(gateway.error))
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(for: gateway.error, message: gateway.message),
            ["api_error", "HTTP_503"]
        )
        XCTAssertEqual(AlarmTalkLog.handledFailureCategory(offline.error), "transient")
        XCTAssertEqual(AlarmTalkLog.handledFailureCategory(unauthorized.error), "auth")
        // 틀린 숫자는 사용자가 고칠 예상된 거절이다 — 호출부는 그대로 올리고, 브레드크럼으로 내리는 것은 보고 함수다.
        XCTAssertEqual(AlarmTalkLog.handledFailureCategory(mistyped.error), "refusal")
    }

    // MARK: - 준비

    /// `reported` 를 주지 않은 테스트의 보고도 여기서 받는다 — 테스트가 일부러 만든 실패를 진짜
    /// 보고 경로(`AlarmTalkLog.reportError`)로 흘리지 않는다.
    private func makeModel(
        _ emailCodeAPI: StubEmailCodeAPI,
        reported: ReportedFailures = ReportedFailures()
    ) -> AuthViewModel {
        AuthViewModel(
            api: UnusedAuthAPI(),
            emailCodeAPI: emailCodeAPI,
            appleCredentialProvider: UnusedAppleCredentialProvider(),
            reportFailure: { reported.record($0, $1) }
        )
    }
}

/// `AuthViewModel` 의 `reportFailure` 자리에 꽂아, 무엇이 Sentry 로 **올라갈 뻔했는지** 순서대로 적는다.
/// 유닛 테스트는 Sentry 를 켜지 않으므로 SDK 로는 볼 수 없다(`AlarmTalkLog.shouldStartCrashReporting`).
@MainActor
private final class ReportedFailures {
    private(set) var entries: [(message: String, error: Error)] = []

    var messages: [String] { entries.map(\.message) }

    func record(_ message: String, _ error: Error) {
        entries.append((message, error))
    }
}

/// 다섯 요청의 답을 테스트가 정한다. 오류가 nil 이면 성공이다(가입은 실패 갈래만 본다).
private final class StubEmailCodeAPI: EmailCodeAPIProviding, @unchecked Sendable {
    var requestError: Error?
    var verifyError: Error?
    var registerError: Error = APIError.invalidResponse
    var resetRequestError: Error?
    var resetConfirmError: Error?

    func requestEmailVerification(email: String) async throws -> RequestEmailVerificationResponse {
        if let requestError { throw requestError }
        return RequestEmailVerificationResponse(success: true)
    }

    func verifyEmailCode(email: String, code: String) async throws -> VerifyEmailCodeResponse {
        if let verifyError { throw verifyError }
        return VerifyEmailCodeResponse(success: true)
    }

    func register(email: String, password: String, name: String, verificationCode: String) async throws -> AuthSession {
        throw registerError
    }

    func requestPasswordReset(email: String) async throws -> RequestEmailVerificationResponse {
        if let resetRequestError { throw resetRequestError }
        return RequestEmailVerificationResponse(success: true)
    }

    func confirmPasswordReset(email: String, code: String, password: String) async throws -> PasswordResetConfirmResponse {
        if let resetConfirmError { throw resetConfirmError }
        return PasswordResetConfirmResponse(success: true)
    }
}

/// 이 테스트의 갈래는 계정 API 를 부르지 않는다 — 불리면 실패로 드러나게 전부 던진다
/// (기본값 `AlarmTalkAPI.shared` 를 두면 실수 한 번이 dev 서버로 나간다).
private final class UnusedAuthAPI: AuthAPIProviding, @unchecked Sendable {
    func me(token: String) async throws -> (token: String?, user: AuthUser) { throw APIError.invalidResponse }
    func updateProfile(_ requestBody: UpdateProfileRequest, token: String) async throws -> UpdateProfileResponse {
        throw APIError.invalidResponse
    }
    func requestAccountDeletion(token: String) async throws -> AccountDeletionResponse { throw APIError.invalidResponse }
    func consentStatus(token: String) async throws -> ConsentStatusResponse { throw APIError.invalidResponse }
    func recordConsents(_ requestBody: RecordConsentsRequest, token: String) async throws -> RecordConsentsResponse {
        throw APIError.invalidResponse
    }
    func listConsents(token: String) async throws -> ConsentListResponse { throw APIError.invalidResponse }
    func logout(token: String) async throws { throw APIError.invalidResponse }
}

private struct UnusedAppleCredentialProvider: AppleCredentialStateProviding {
    func credentialState(forUserID userID: String) async throws -> ASAuthorizationAppleIDProvider.CredentialState {
        .authorized
    }
}
