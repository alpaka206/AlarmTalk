import XCTest
@testable import AlarmTalk

/// 「기록은 전부, 경보는 골라서」 의 앱 쪽 — `docs/spec/error-codes.md` §3.
/// 안드로이드 `TransientFailureClassificationTest` 의 대응물. 취소·일시적 네트워크 실패는
/// 이슈로 올리지 않되, **진짜 결함까지 같이 묻히지 않게** 경계를 고정한다.
final class TransientFailureClassificationTests: XCTestCase {
    // ── 이슈로 올리지 않는 것 ─────────────────────────────────────────────

    func test_taskCancellationIsNotAnError() {
        XCTAssertTrue(AlarmTalkLog.isExpectedTransientFailure(CancellationError()))
    }

    func test_transientNetworkFailuresAreBreadcrumbsNotIssues() {
        for code: URLError.Code in [
            .notConnectedToInternet, .timedOut, .cannotFindHost, .cannotConnectToHost,
            .networkConnectionLost, .dnsLookupFailed, .secureConnectionFailed,
        ] {
            XCTAssertTrue(AlarmTalkLog.isExpectedTransientFailure(URLError(code)), "\(code)")
        }
    }

    func test_networkFailureWrappedAsUnderlyingErrorIsStillTransient() {
        let wrapped = NSError(
            domain: "AlarmTalk.Sync", code: 1,
            userInfo: [NSUnderlyingErrorKey: URLError(.cannotFindHost)]
        )
        XCTAssertTrue(AlarmTalkLog.isExpectedTransientFailure(wrapped))
    }

    // ── 그대로 이슈로 올리는 것 — 여기가 무너지면 진짜 결함이 사라진다 ────────

    func test_responseShapeProblemsStillReport() {
        // 서버가 이상한 걸 줬거나 우리가 못 읽은 것은 결함일 수 있다.
        XCTAssertFalse(AlarmTalkLog.isExpectedTransientFailure(URLError(.badServerResponse)))
        XCTAssertFalse(AlarmTalkLog.isExpectedTransientFailure(URLError(.cannotParseResponse)))
        XCTAssertFalse(AlarmTalkLog.isExpectedTransientFailure(APIError.invalidResponse))
    }

    func test_httpFailuresAreNotClassifiedHere() {
        // 4xx 는 호출부가 error_code 를 보고 가른다.
        XCTAssertFalse(AlarmTalkLog.isExpectedTransientFailure(
            APIError.server(status: 403, message: "forbidden", errorCode: "CONSENT_REQUIRED")
        ))
        XCTAssertFalse(AlarmTalkLog.isExpectedTransientFailure(
            APIError.server(status: 500, message: "boom")
        ))
    }

    func test_programmingErrorsStillReport() {
        struct Bug: Error {}
        XCTAssertFalse(AlarmTalkLog.isExpectedTransientFailure(Bug()))
    }
}
