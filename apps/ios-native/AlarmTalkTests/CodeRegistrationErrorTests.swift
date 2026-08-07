import XCTest
@testable import AlarmTalk

/// 코드 등록 실패가 **사유별로** 보이는지. 이 매핑이 없으면 만료·중복·정원초과가
/// 전부 같은 폴백 한 줄이 되어, 사용자는 무엇을 고쳐야 할지 알 수 없다.
final class CodeRegistrationErrorTests: XCTestCase {

    private func serverError(_ code: String, message: String = "Code is expired") -> Error {
        APIError.server(status: 409, message: message, errorCode: code)
    }

    /// 백엔드 `voucher-redemption.ts` 가 실제로 던지는 코드들.
    func test_knownErrorCodes_mapToDistinctKoreanMessages() {
        let cases: [(String, String)] = [
            ("CODE_EXPIRED", "만료된 코드예요"),
            ("CODE_ALREADY_USED", "이미 사용된 코드예요"),
            ("CODE_ALREADY_REDEEMED_BY_YOU", "이미 등록한 코드예요"),
            ("GROUP_FULL", "이미 정원이 찬 코드예요"),
            ("INVALID_FORMAT", "코드 형식을 확인해 주세요"),
            ("CODE_NOT_FOUND", "등록할 수 없는 코드예요"),
            ("CODE_REVOKED", "취소된 코드예요"),
            ("ALREADY_MEMBER", "이미 함께 쓰고 있는 그룹이에요"),
            ("CODE_EXHAUSTED", "사용 가능 횟수가 모두 소진된 프로모 코드예요"),
        ]
        for (code, expected) in cases {
            XCTAssertEqual(
                CodeRegistrationError.message(for: serverError(code), fallback: "폴백"),
                expected,
                "\(code) 가 폴백으로 떨어졌다"
            )
        }
    }

    /// 서버가 두 이름을 쓰지만 사용자에게는 같은 뜻이다.
    func test_selfIssuedAndSelfAccept_shareOneMessage() {
        let issued = CodeRegistrationError.message(for: serverError("SELF_ISSUED"), fallback: "폴백")
        let accept = CodeRegistrationError.message(for: serverError("SELF_ACCEPT"), fallback: "폴백")
        XCTAssertEqual(issued, "본인이 발급한 코드는 등록할 수 없어요")
        XCTAssertEqual(accept, issued)
    }

    /// ⚠ 회귀의 핵심: 사유가 서로 **구분되어야** 한다. 표를 지우면 전부 같은 값이 된다.
    func test_messagesAreNotAllTheSame() {
        let codes = ["CODE_EXPIRED", "CODE_ALREADY_USED", "GROUP_FULL", "INVALID_FORMAT"]
        let messages = Set(codes.map { CodeRegistrationError.message(for: serverError($0), fallback: "폴백") })
        XCTAssertEqual(messages.count, codes.count, "사유가 구분되지 않는다")
        XCTAssertFalse(messages.contains("폴백"))
    }

    /// 표에 없는 코드인데 서버가 영어를 주면 → 폴백(영어를 그대로 보여주지 않는다).
    func test_unknownCodeWithEnglishMessage_usesFallback() {
        let error = APIError.server(status: 500, message: "Something broke", errorCode: "WAT")
        XCTAssertEqual(CodeRegistrationError.message(for: error, fallback: "폴백"), "폴백")
    }

    /// 표에 없어도 서버가 한국어를 주면 그게 폴백보다 구체적이다.
    func test_unknownCodeWithKoreanMessage_usesServerMessage() {
        let error = APIError.server(status: 400, message: "이 코드는 쓸 수 없어요", errorCode: "WAT")
        XCTAssertEqual(CodeRegistrationError.message(for: error, fallback: "폴백"), "이 코드는 쓸 수 없어요")
    }

    /// 네트워크 오류 등 `APIError` 가 아닌 것은 기존 경로로 떨어진다.
    func test_nonAPIError_fallsBack() {
        struct Boom: Error {}
        XCTAssertEqual(CodeRegistrationError.message(for: Boom(), fallback: "폴백"), "폴백")
    }
}
