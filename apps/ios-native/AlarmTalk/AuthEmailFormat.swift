import Foundation

/// 이메일 **형식 규칙** — 서버(`@alarmtalk/shared` 의 `EMAIL_PATTERN`)와 **같은 값**.
///
/// 예전에는 `LoginView` 안에 자체 정규식(`^[A-Z0-9._%+-]+@…`)이 박혀 있었다. 서버
/// 규칙과 다른 물건이라 두 가지로 어긋났다:
///  - **아포스트로피를 거부했다.** 서버는 받는다 — 그래서 `o'brien@example.com` 으로
///    가입한 사람은 앱에서 로그인 자체가 불가능했다(계정 잠금). CLAUDE.md 의
///    「남기는 것: 따옴표·세미콜론·하이픈 — "O'Brien" 은 정당한 이름이다」와 정면으로
///    어긋난다.
///  - 반대로 `%` 는 받았는데 서버가 거부한다. 앱이 통과시키고 서버가 400 으로 잘라,
///    사용자는 왜 막히는지 모른 채 같은 주소를 다시 친다.
///
/// ⚠ **여기서만 바꾸지 말 것.** 같은 문자열이 세 곳에 있다 —
/// `packages/shared/src/schemas/auth.ts` 의 `EMAIL_PATTERN`,
/// 안드로이드 `ui/auth/AuthEmail.kt` 의 `AuthEmailPattern`.
/// 케이스 표는 세 곳의 테스트가 같은 목록으로 고정한다(`AuthEmailFormatTests`).
enum AuthEmailFormat {
    /// ⚠ 생 정규식을 화면에 다시 박지 말 것 — 이 상수만 부른다.
    static let pattern =
        #"^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$"#

    /// 형식을 보기 **전에** 거치는 정규화 — 서버 `normalizeEmail` 과 같은 규칙.
    /// 자동완성·복사붙여넣기가 붙이는 앞뒤 공백과 대문자를 걷어낸다.
    static func normalize(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// 정규화한 값이 ``pattern`` 에 맞는가. 서버·안드로이드와 같은 답을 내야 한다.
    ///
    /// ⚠ 찾은 범위가 **문자열 전체**인지 확인한다. `.regularExpression` 은 부분 일치를
    /// 돌려주므로, 앵커만 믿고 넘기면 가운데 줄바꿈이 든 값에서 판정이 흔들린다.
    static func isValid(_ raw: String) -> Bool {
        let value = normalize(raw)
        guard !value.isEmpty,
              let match = value.range(of: pattern, options: .regularExpression) else { return false }
        return match.lowerBound == value.startIndex && match.upperBound == value.endIndex
    }

    /// 로그인 제출 버튼을 **누를 수 있는가.**
    ///
    /// ⚠ **이메일 형식을 여기서 보지 않는다**(CLAUDE.md 「잠그는 것은 '저장 중' 일
    /// 때뿐이다」). 형식으로 버튼을 죽이면 사용자는 왜 안 눌리는지 알 길이 없어
    /// 고장으로 읽는다. 누를 수 있게 두고, 누른 뒤에 ``submitOutcome(email:)``
    /// 이 이유를 말한다. 안드로이드 `canSubmitLogin` 과 같은 규칙이다.
    static func canSubmitLogin(email: String, password: String) -> Bool {
        // 안드로이드의 `isNotBlank()` 와 같은 판정 — 공백만 친 칸은 빈 칸이다.
        !normalize(email).isEmpty
            && !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// 이메일만 보내는 버튼(가입의 '이메일 인증', 재설정의 '인증 코드 받기')을
    /// **누를 수 있는가.**
    ///
    /// ``canSubmitLogin(email:password:)`` 과 같은 규칙이다 — 형식은 보지 않고
    /// **보낼 것이 있는가**만 본다. 빈 칸은 말해 줄 내용조차 없어서 잠그고, 형식은
    /// 누른 뒤에 말한다. 안드로이드 `canRequestEmailCode` 와 같은 짝이다.
    static func canRequestEmailCode(_ email: String) -> Bool {
        !normalize(email).isEmpty
    }

    /// 이메일 형식을 지적하는 서버 에러 코드.
    /// 목록의 출처는 `packages/shared/src/schemas/error-codes.ts`.
    static let emailInvalidErrorCode = "AUTH_EMAIL_INVALID"

    /// 서버가 **이메일 형식**을 지적한 갈래인가.
    ///
    /// ⚠ **번역된 문구로 가르지 말 것.** 예전에는 화면이
    /// `auth.loginError == APIErrorMessages.emailInvalid` 로 비교했다. 문구를 한 글자만
    /// 고치거나 다른 에러 코드가 같은 문장을 쓰게 되는 순간 **아무 경고 없이** 갈래가
    /// 어긋나고, 형식 오류가 비밀번호 칸 아래로 내려간다. 판정은 언제나 **에러 코드**로
    /// 한다 — 안드로이드 `isEmailFormatErrorCode` 와 같은 규칙이다.
    static func isEmailFormatErrorCode(_ code: String?) -> Bool {
        code == emailInvalidErrorCode
    }

    /// 형식이 맞으면 보내고, 아니면 이유를 띄운다. 네트워크를 타기 전에 끊는 갈래이고,
    /// 서버가 같은 판정을 내릴 때 쓰는 코드(``emailInvalidErrorCode``)와 같은 뜻이다 —
    /// 그래서 문구도 한 벌(`APIErrorMessages.emailInvalid`)이다.
    static func submitOutcome(email: String) -> AuthEmailSubmitOutcome {
        isValid(email) ? .submit : .showEmailFormatError
    }
}

/// 이메일을 서버로 보내기 전에 갈라지는 두 갈래.
///
/// 로그인 전용이 아니다 — 가입의 '이메일 인증', 비밀번호 재설정의 '인증 코드 받기'도
/// 같은 판정을 쓴다. 판정이 화면마다 갈라지면 로그인은 되는데 재설정만 막히는 계정이
/// 생긴다(아포스트로피가 든 주소가 실제로 그랬다).
/// 안드로이드 `AuthEmailSubmitOutcome` 과 같은 짝이다.
enum AuthEmailSubmitOutcome: Equatable {
    /// 이메일 칸 아래에 형식 오류를 띄운다 — 서버에 물어볼 것도 없는 실패다.
    case showEmailFormatError
    /// 서버로 보낸다.
    case submit
}
