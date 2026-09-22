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

    func test_cancelledInFlightRequestIsNotAnErrorEither() {
        // 전송 도중 취소된 URLSession 요청은 `CancellationError` 가 아니라 `URLError(.cancelled)`
        // 로 돌아온다(BG 워치독·시스템 만료). 이게 목록에 없으면 BG 사이클의 모든 reportError
        // 호출부가 시간이 모자란 회차마다 허위 이슈를 만든다(2026-09-22).
        XCTAssertTrue(AlarmTalkLog.isExpectedTransientFailure(URLError(.cancelled)))
        let wrapped = NSError(
            domain: "AlarmTalk.Sync", code: 1,
            userInfo: [NSUnderlyingErrorKey: URLError(.cancelled)]
        )
        XCTAssertTrue(AlarmTalkLog.isExpectedTransientFailure(wrapped))
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

    // ── 이미 처리가 끝난 401 — 형제 판정이 받는다 ────────────────────────

    /// ⚠ **401 은 우리가 할 일이 남지 않은 실패다.** `AlarmTalkAPI.handleUnauthorized` 가
    /// 디바운스해 세션 만료 알림을 쏘고 `AuthViewModel` 이 로그아웃까지 끝내므로, 호출부가
    /// 남기는 보고는 그 처리의 메아리다. 서버의 `ALERTING_ERROR_CODES` 에도
    /// `AUTH_USER_NOT_FOUND` 는 없다 — 2026-09-21 Sentry ALARMTALK-IOS-2 는 이 메아리만
    /// 700건이었다.
    func test_이미_처리된_401은_브레드크럼이다() {
        let destroyed = APIError.server(status: 401, message: "unauthorized", errorCode: "AUTH_USER_NOT_FOUND")
        XCTAssertTrue(AlarmTalkLog.isHandledAuthFailure(destroyed))
        XCTAssertEqual(AlarmTalkLog.handledFailureCategory(destroyed), "auth")
        // 판정은 상태코드 하나다 — error_code 없이 온 401 도 같은 갈래다.
        XCTAssertTrue(AlarmTalkLog.isHandledAuthFailure(APIError.server(status: 401, message: "unauthorized")))
    }

    /// ⚠ **감싸인 401 도 같은 401 이다.** 저장소·뷰모델이 실패를 도메인 오류로 한 번 싸서
    /// 던지는 경로가 있는데, 최상위만 보면 **감쌌느냐 아니냐로 경보 여부가 갈린다** — 계약이
    /// 아니라 우연이 된다. 형제 판정(`isExpectedTransientFailure`)은 처음부터 사슬을 탔고,
    /// 안드로이드 짝도 cause 를 탄다(`unauthorizedWrappedInDomainExceptionIsStillUnauthorized`).
    func test_감싸인_401도_이미_처리된_실패다() {
        let wrapped = NSError(
            domain: "AlarmTalk.Sync", code: 1,
            userInfo: [
                NSUnderlyingErrorKey: APIError.server(
                    status: 401, message: "unauthorized", errorCode: "TOKEN_REVOKED"
                )
            ]
        )
        XCTAssertTrue(AlarmTalkLog.isHandledAuthFailure(wrapped))
        XCTAssertEqual(AlarmTalkLog.handledFailureCategory(wrapped), "auth")

        // 두 겹이어도 같다.
        let twice = NSError(
            domain: "AlarmTalk.Repository", code: 2,
            userInfo: [NSUnderlyingErrorKey: wrapped]
        )
        XCTAssertTrue(AlarmTalkLog.isHandledAuthFailure(twice))
    }

    /// ⚠ **사슬을 탄다고 401 이 아닌 것까지 잡아서는 안 된다.** 감싼 껍데기만 보고 낮추면
    /// 진짜 결함이 브레드크럼으로 사라진다.
    func test_감싸여_있어도_401이_아니면_이슈다() {
        let wrapped403 = NSError(
            domain: "AlarmTalk.Sync", code: 1,
            userInfo: [
                NSUnderlyingErrorKey: APIError.server(
                    status: 403, message: "forbidden", errorCode: "CONSENT_REQUIRED"
                )
            ]
        )
        XCTAssertFalse(AlarmTalkLog.isHandledAuthFailure(wrapped403))
        XCTAssertNil(AlarmTalkLog.handledFailureCategory(wrapped403))

        struct Bug: Error {}
        let wrappedBug = NSError(
            domain: "AlarmTalk.Sync", code: 1, userInfo: [NSUnderlyingErrorKey: Bug()]
        )
        XCTAssertFalse(AlarmTalkLog.isHandledAuthFailure(wrappedBug))
    }

    /// 사슬이 순환하거나 끝없이 길어도 **멈춘다**(두 판정이 같은 깊이 상한을 쓴다).
    /// 여기서 재는 것은 '끝난다' 이고, 값은 두 형제가 같은 규칙을 쓴다는 사실이다.
    func test_사슬이_아무리_길어도_멈춘다() {
        var auth: Error = APIError.server(status: 401, message: "unauthorized")
        var network: Error = URLError(.cannotFindHost)
        for _ in 0..<32 {
            auth = NSError(domain: "AlarmTalk.Deep", code: 1, userInfo: [NSUnderlyingErrorKey: auth])
            network = NSError(domain: "AlarmTalk.Deep", code: 1, userInfo: [NSUnderlyingErrorKey: network])
        }
        XCTAssertFalse(AlarmTalkLog.isHandledAuthFailure(auth))
        XCTAssertFalse(AlarmTalkLog.isExpectedTransientFailure(network))
    }

    /// ⚠ **두 판정을 합치지 않는다.** 뜻이 다르고(기기 네트워크 사정 vs 이미 끝난 세션 만료),
    /// 합치면 브레드크럼 category 까지 하나로 뭉개져 다음 진짜 이벤트를 읽을 때 둘을
    /// 구분할 수 없다.
    func test_두_갈래는_서로_섞이지_않는다() {
        XCTAssertEqual(AlarmTalkLog.handledFailureCategory(URLError(.timedOut)), "transient")
        XCTAssertEqual(AlarmTalkLog.handledFailureCategory(CancellationError()), "transient")
        XCTAssertFalse(AlarmTalkLog.isHandledAuthFailure(URLError(.timedOut)))
        XCTAssertFalse(
            AlarmTalkLog.isExpectedTransientFailure(APIError.server(status: 401, message: "unauthorized")),
            "401 은 기다리면 나아지는 실패가 아니다"
        )
    }

    // ── 그대로 이슈로 올리는 것 — 여기가 무너지면 진짜 결함이 사라진다 ────────

    /// ⚠ **401 만 예외다.** 403·404·409·5xx 는 그대로 이슈로 올라가야 한다 — 권한 박탈,
    /// 파기된 계정, 결제 확정 거절(`TRANSACTION_OWNED_BY_OTHER_USER` 는 서버의
    /// `ALERTING_ERROR_CODES` 에 있다), 서버 사고는 전부 우리가 고칠 것이 있는 갈래다.
    func test_401_외의_상태코드는_그대로_이슈다() {
        let errors: [APIError] = [
            .server(status: 403, message: "forbidden", errorCode: "CONSENT_REQUIRED"),
            .server(status: 404, message: "not found", errorCode: "AUTH_USER_NOT_FOUND"),
            .server(status: 409, message: "conflict", errorCode: "TRANSACTION_OWNED_BY_OTHER_USER"),
            .server(status: 500, message: "boom"),
        ]
        for error in errors {
            XCTAssertFalse(AlarmTalkLog.isHandledAuthFailure(error), "\(error)")
            XCTAssertNil(AlarmTalkLog.handledFailureCategory(error), "\(error)")
        }
    }


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
