import XCTest
@testable import AlarmTalk

/// 에러 문구가 **사람이 읽으라고 쓴 문장일 때만** 화면에 나가는지.
///
/// ⚠ 이 테스트가 지키는 것: 한국어 기기에서 Foundation 이 만들어 주는 일반 문구
/// (`"작업을 완료할 수 없습니다.(MyModule.Boom 오류 1.)"`)가 사용자에게 새지 않는 것.
/// "한국어면 보여준다" 규칙일 때 실제로 그게 화면에 떴다.
final class UserFacingErrorTests: XCTestCase {

    private struct Bare: Error {}

    private struct Described: LocalizedError {
        let errorDescription: String?
    }

    // MARK: - 맹글링된 내부 이름이 새지 않는다

    func test_bareSwiftError_neverLeaksFoundationGenericMessage() {
        let message = userFacingErrorMessage(Bare(), fallback: "폴백")
        XCTAssertEqual(message, "폴백")
        // 기기 언어가 무엇이든 타입 이름이 새면 안 된다.
        XCTAssertFalse(message.contains("Bare"))
        XCTAssertFalse(message.contains("AlarmTalkTests"))
    }

    // MARK: - 우리가 쓴 문장은 그대로 나간다

    func test_localizedError_withKoreanDescription_isShown() {
        let error = Described(errorDescription: "녹음 파일을 열 수 없어요")
        XCTAssertEqual(userFacingErrorMessage(error, fallback: "폴백"), "녹음 파일을 열 수 없어요")
    }

    func test_localizedError_withEnglishDescription_usesFallback() {
        let error = Described(errorDescription: "Something went wrong")
        XCTAssertEqual(userFacingErrorMessage(error, fallback: "폴백"), "폴백")
    }

    func test_localizedError_withNilDescription_usesFallback() {
        XCTAssertEqual(userFacingErrorMessage(Described(errorDescription: nil), fallback: "폴백"), "폴백")
    }

    // MARK: - APIError 갈래

    func test_serverError_withKoreanMessage_isShown() {
        let error = APIError.server(status: 400, message: "이미 등록한 코드예요", errorCode: nil)
        XCTAssertEqual(userFacingErrorMessage(error, fallback: "폴백"), "이미 등록한 코드예요")
    }

    /// 백엔드는 영어 메시지를 던지는 갈래가 많다 — 그건 사용자에게 보여주지 않는다.
    func test_serverError_withEnglishMessage_usesFallback() {
        let error = APIError.server(status: 409, message: "Code is expired", errorCode: "CODE_EXPIRED")
        XCTAssertEqual(userFacingErrorMessage(error, fallback: "폴백"), "폴백")
    }

    func test_invalidResponse_usesFallback() {
        XCTAssertEqual(userFacingErrorMessage(APIError.invalidResponse, fallback: "폴백"), "폴백")
    }

    // MARK: - NSError 는 **문장이 채워져 있을 때만** 통과한다

    /// URLSession 이 실제로 주는 오류처럼 `NSLocalizedDescription` 이 채워진 것.
    func test_nsError_withFilledDescription_isShown() {
        let error = URLError(
            .notConnectedToInternet,
            userInfo: [NSLocalizedDescriptionKey: "인터넷 연결이 오프라인 상태입니다."]
        )
        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "폴백"),
            "인터넷 연결이 오프라인 상태입니다."
        )
    }

    /// ⚠ 코드로 만든 `URLError` 는 userInfo 가 비어 있어 Foundation 이 일반 문구를
    /// 합성한다. 타입(`is URLError`)으로 걸렀다면 한국어 기기에서 그대로 샜을 자리다.
    func test_nsError_withoutFilledDescription_usesFallback() {
        let message = userFacingErrorMessage(URLError(.notConnectedToInternet), fallback: "폴백")
        XCTAssertEqual(message, "폴백")
        XCTAssertFalse(message.contains("NSURLErrorDomain"))
    }
}
