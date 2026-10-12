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

    /// ⚠ **401 과 예상된 거절 목록만 예외다**(목록은 아래 「사용자가 고칠 예상된 거절」). 그 밖의
    /// 403·404·409·5xx 는 그대로 이슈로 올라가야 한다 — 권한 박탈, 파기된 계정, 결제 확정 거절
    /// (`TRANSACTION_OWNED_BY_OTHER_USER` 는 서버의 `ALERTING_ERROR_CODES` 에 있다), 서버 사고는 전부
    /// 우리가 고칠 것이 있는 갈래다.
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

    // ── 묶음 키 — 올라간 이벤트가 어느 이슈에 붙는가 ──────────────────────────

    /// API 실패는 **코드와 호출 자리**로 묶는다 — `docs/spec/error-codes.md` §3 「앱의 묶음 키」.
    /// 안드로이드와 같은 세 모양이어야 한다(한쪽만 다르면 같은 실패가 프로젝트마다 다르게 묶인다).
    ///
    /// Sentry 는 Swift 오류를 도메인·코드로 묶는다. `APIError.server` 는 상태·코드가 달라도 같은
    /// enum case 라 지문 없이는 서로 다른 실패가 한 이슈에 쌓이기 쉽다 — 안드로이드 1.2.10 의
    /// ALARMTALK-ANDROID-Q 에는 이메일 인증 거절·목소리 월 한도 429·로봇의 504 가 섞여 있었다.
    /// ⚠ 지문이 실제 이벤트에 실리는지는 유닛 테스트가 못 본다(테스트에서는 Sentry 를 켜지 않는다).
    func test_API_실패의_묶음_키() {
        func server(_ status: Int, _ code: String? = nil) -> APIError {
            .server(status: status, message: "body", errorCode: code)
        }

        // ① 호출 자리(logKey)는 ` key=value` 토큰을 뺀 것이다 — 회차마다 바뀌는 값이 이슈를 쪼개지 않는다.
        XCTAssertEqual(AlarmTalkLog.logKey(of: "알람 push 실패(create): status=403 code=X"), "알람 push 실패(create):")
        XCTAssertEqual(
            AlarmTalkLog.logKey(of: "Failed to promote voice draft id=9264e503-8579-4fc1-827c-8bb0048c7ab4"),
            "Failed to promote voice draft"
        )
        XCTAssertEqual(
            AlarmTalkLog.logKey(of: "Failed to update voice profile sharing id=x shared=true"),
            "Failed to update voice profile sharing"
        )
        // 토큰이 없으면 그대로다.
        XCTAssertEqual(AlarmTalkLog.logKey(of: "사용 기록 전송 실패 — 큐에 남겨 둔다"), "사용 기록 전송 실패 — 큐에 남겨 둔다")
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(for: server(403, "A"), message: "알람 push 실패(update): status=403 code=A"),
            AlarmTalkLog.apiFailureFingerprint(for: server(403, "A"), message: "알람 push 실패(update): status=409 code=B"),
            "status=·code= 만 다른 메시지는 같은 호출 자리다"
        )

        // ② 코드가 있으면 [api_error, 코드, logKey] — 상태코드가 같아도 코드가 다르면 다른 이슈다.
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(
                for: server(429, "VOICE_MONTHLY_CHANGE_LIMIT_REACHED"), message: "목소리 저장 실패 id=abc"
            ),
            ["api_error", "VOICE_MONTHLY_CHANGE_LIMIT_REACHED", "목소리 저장 실패"]
        )
        XCTAssertNotEqual(
            AlarmTalkLog.apiFailureFingerprint(for: server(429, "VOICE_MONTHLY_CHANGE_LIMIT_REACHED"), message: "저장 실패"),
            AlarmTalkLog.apiFailureFingerprint(for: server(429, "RATE_LIMITED"), message: "저장 실패")
        )
        // 같은 코드라도 호출 자리가 다르면 다른 이슈다 — 앱에는 라우트별 스택이 없다.
        XCTAssertNotEqual(
            AlarmTalkLog.apiFailureFingerprint(for: server(500, "INTERNAL_ERROR"), message: "알람 push 실패(create):"),
            AlarmTalkLog.apiFailureFingerprint(for: server(500, "INTERNAL_ERROR"), message: "사용 기록 전송 실패")
        )

        // ③ 코드 없는 4xx 는 호출 자리를 남긴다(주소·라우팅이 틀린 자리를 가리킨다).
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(for: server(404), message: "알람 push 실패(update): status=404 code=-"),
            ["api_error", "HTTP_404", "알람 push 실패(update):"]
        )
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(for: server(404, ""), message: "사용 기록 전송 실패"),
            ["api_error", "HTTP_404", "사용 기록 전송 실패"],
            "빈 코드는 코드 없음이다"
        )

        // ④ 코드 없는 5xx 는 호출 자리를 뺀다 — 워커 앞단(게이트웨이)이 낸 것이라 어느 화면이
        //    불렀는지는 원인을 가르지 않는다. 호출부마다 이슈가 갈리면 장애 하나가 여러 이슈다.
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(for: server(504), message: "알람 push 실패(create): status=504 code=-"),
            ["api_error", "HTTP_504"]
        )
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(for: server(504), message: "알람 push 실패(create): status=504 code=-"),
            AlarmTalkLog.apiFailureFingerprint(for: server(504), message: "사용 기록 전송 실패 — 큐에 남겨 둔다")
        )

        // ⑤ 감싸인 응답도 같은 키다 — 낮추는 판정(`isHandledAuthFailure`)과 같은 방식으로 사슬을 탄다.
        let wrapped = NSError(
            domain: "AlarmTalk.Sync", code: 1,
            userInfo: [NSUnderlyingErrorKey: server(409, "TRANSACTION_OWNED_BY_OTHER_USER")]
        )
        XCTAssertEqual(
            AlarmTalkLog.apiFailureFingerprint(for: wrapped, message: "결제 확정 실패"),
            ["api_error", "TRANSACTION_OWNED_BY_OTHER_USER", "결제 확정 실패"]
        )

        // ⑥ HTTP 응답이 아니면 지문이 없다 — Sentry 의 기본 묶음 그대로다.
        struct Bug: Error {}
        XCTAssertNil(AlarmTalkLog.apiFailureFingerprint(for: Bug(), message: "알람 push 실패(create): Bug"))
        XCTAssertNil(AlarmTalkLog.apiFailureFingerprint(for: APIError.invalidResponse, message: "사용 기록 전송 실패"))
        XCTAssertNil(AlarmTalkLog.apiFailureFingerprint(for: URLError(.badServerResponse), message: "사용 기록 전송 실패"))
    }

    /// ⚠ **묶음 키는 무엇도 낮추지 않는다.** 지문이 생기는 실패는 전처럼 이슈다 — 여기서 바뀌는 것은
    /// 어느 이슈에 붙는가뿐이다. 예상된 거절은 묶음 키가 아니라 목록으로만 낮춘다(아래).
    func test_묶음_키가_있다고_브레드크럼으로_내려가지_않는다() {
        let refusals: [APIError] = [
            .server(status: 429, message: "limit", errorCode: "VOICE_MONTHLY_CHANGE_LIMIT_REACHED"),
            .server(status: 429, message: "attempts", errorCode: "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"),
            .server(status: 409, message: "conflict", errorCode: "TRANSACTION_OWNED_BY_OTHER_USER"),
            .server(status: 504, message: "gateway"),
        ]
        for error in refusals {
            XCTAssertNotNil(AlarmTalkLog.apiFailureFingerprint(for: error, message: "실패"), "\(error)")
            XCTAssertNil(AlarmTalkLog.handledFailureCategory(error), "\(error)")
        }
    }

    // ── 사용자가 고칠 예상된 거절 — 목록으로만 낮춘다(`docs/spec/error-codes.md` §3) ──────────

    /// 목록은 `AlarmTalkLog.expectedRefusalCodes` 한 곳이고 정확히 이 여덟 개다(프로모 코드 갈래 셋은 2026-10-12 에
    /// 프로모 코드와 함께 빠졌다). 넓히면(4xx 전부·`AUTH_` 전부)
    /// 권한·상태 충돌 같은 고칠 것이 이슈 목록에서 조용히 사라지고, 좁히면 사용자가 잘못 친 값이 다시 이슈를 채운다.
    /// 바꿀 때는 스펙의 표와 이 줄을 함께 고친다.
    func test_예상된_거절_목록은_정해진_여덟_개다() {
        XCTAssertEqual(AlarmTalkLog.expectedRefusalCodes, [
            "AUTH_EMAIL_CODE_INVALID", "AUTH_EMAIL_CODE_EXPIRED", "AUTH_EMAIL_TAKEN", "AUTH_EMAIL_SOCIAL",
            "CODE_NOT_FOUND", "CODE_EXPIRED", "CODE_ALREADY_USED", "CODE_ALREADY_REDEEMED_BY_YOU",
        ])
    }

    /// 틀린·만료된 인증 코드, 이미 쓰는 이메일, 이용권 코드의 거절은 사용자가 친 값의 문제이고 화면이 이유를 이미
    /// 말한다 — 이슈가 아니라 브레드크럼(`refusal`)이다. 서버가 실제로 내는 상태(400·404·409)로 보고, 감싸인 응답도
    /// 같다(묶음 키와 같은 방법으로 사슬을 탄다 — 감싸였는지로 경보가 갈리면 계약이 아니다).
    func test_사용자가_고칠_예상된_거절은_브레드크럼이다() {
        let refusals: [APIError] = [
            .server(status: 400, message: "invalid", errorCode: "AUTH_EMAIL_CODE_INVALID"),
            .server(status: 400, message: "expired", errorCode: "AUTH_EMAIL_CODE_EXPIRED"),
            .server(status: 409, message: "taken", errorCode: "AUTH_EMAIL_TAKEN"),
            .server(status: 409, message: "social", errorCode: "AUTH_EMAIL_SOCIAL"),
            .server(status: 404, message: "not found", errorCode: "CODE_NOT_FOUND"),
            .server(status: 409, message: "expired", errorCode: "CODE_EXPIRED"),
            .server(status: 409, message: "used", errorCode: "CODE_ALREADY_USED"),
            .server(status: 409, message: "mine", errorCode: "CODE_ALREADY_REDEEMED_BY_YOU"),
        ]
        XCTAssertEqual(Set(refusals.compactMap(\.serverErrorCode)), AlarmTalkLog.expectedRefusalCodes)
        for refusal in refusals {
            XCTAssertTrue(AlarmTalkLog.isExpectedRefusal(refusal), "\(refusal)")
            XCTAssertEqual(AlarmTalkLog.handledFailureCategory(refusal), "refusal", "\(refusal)")
            // 다른 갈래로 새지 않는다 — 다음 진짜 이벤트에서 "틀린 코드" 와 "네트워크" 는 다른 이야기다.
            XCTAssertFalse(AlarmTalkLog.isExpectedTransientFailure(refusal), "\(refusal)")
            XCTAssertFalse(AlarmTalkLog.isHandledAuthFailure(refusal), "\(refusal)")
            let wrapped = NSError(domain: "AlarmTalk.Auth", code: 1, userInfo: [NSUnderlyingErrorKey: refusal])
            XCTAssertEqual(AlarmTalkLog.handledFailureCategory(wrapped), "refusal", "감싸인 \(refusal)")
        }
    }

    /// ⚠ **시도 상한과 월 한도는 목록에 없다 — 그대로 이슈다.** 1.2.10 의 두 묶음(같은 코드 다섯 번 제출, 낡은 등록
    /// 횟수)은 이 둘이 이슈로 올라와 드러났다. 같은 코드라도 5xx 면 거절이 아니라 사고이고, 코드가 없거나 본문에만
    /// 있으면 무엇을 거절했는지 모른다 — 셋 다 이슈다.
    func test_시도_상한_월_한도_5xx_코드_없는_거절은_그대로_이슈다() {
        let issues: [Error] = [
            APIError.server(status: 429, message: "attempts", errorCode: "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"),
            APIError.server(status: 429, message: "limit", errorCode: "VOICE_MONTHLY_CHANGE_LIMIT_REACHED"),
            APIError.server(status: 500, message: "boom", errorCode: "AUTH_EMAIL_CODE_INVALID"),
            APIError.server(status: 503, message: "gateway", errorCode: "CODE_NOT_FOUND"),
            APIError.server(status: 400, message: "Bad Request", errorCode: nil),
            APIError.server(status: 400, message: "Bad Request", errorCode: ""),
            APIError.server(status: 400, message: "AUTH_EMAIL_CODE_INVALID: wrong digits", errorCode: nil),
            NSError(domain: "AlarmTalk.Auth", code: 1, userInfo: [
                NSUnderlyingErrorKey: APIError.server(status: 429, message: "attempts", errorCode: "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED"),
            ]),
        ]
        for error in issues {
            XCTAssertFalse(AlarmTalkLog.isExpectedRefusal(error), "\(error)")
            XCTAssertNil(AlarmTalkLog.handledFailureCategory(error), "\(error)")
        }
    }
}
