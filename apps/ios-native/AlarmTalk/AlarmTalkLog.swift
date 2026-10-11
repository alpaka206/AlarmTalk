import Foundation
import OSLog
import Sentry

/// 개발자 채널 — 잡아서 처리한(비크래시) 오류를 로그와 Sentry 로 보낸다.
///
/// 안드로이드 `core/AlarmTalkLog.kt` 의 대응물이다. **규칙도 같다**:
/// - 사용자에게는 다듬은 문구만 보여주고, 원인 파악용 상세는 이 함수로만 흘려보낸다.
/// - Sentry 로 나가는 **모든 문자열**은 마스킹을 거친다(로컬 로그는 원문을 남긴다).
/// - DSN 이 없으면 `SentrySDK` 는 초기화되지 않고 `capture*` 는 no-op 이라 안전하다.
enum AlarmTalkLog {
    static let logger = Logger(subsystem: "com.alarmtalk.app", category: "AlarmTalk")

    /// 사용자 파일 URL 은 파일명·로컬 식별자가 담겨 PII 소지가 있다.
    ///
    /// ⚠ **안드로이드와 스킴이 다르다.** 그쪽은 `content://`·`file://` 인데 iOS 는
    /// 임시 복사본이 `file://`, 사진 라이브러리가 `ph://`·`assets-library://` 다.
    /// 규칙(= 사용자 경로를 내보내지 않는다)은 같고 목록만 플랫폼에 맞춘다.
    /// `content://` 도 남겨 둔다 — 서버가 준 문자열을 그대로 실어 보내는 경로가 있다.
    private static let userURIPattern = try? NSRegularExpression(
        pattern: "(content|file|ph|assets-library)://\\S+"
    )

    static func redactUserURIs(_ text: String) -> String {
        guard let regex = userURIPattern else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(
            in: text, range: range, withTemplate: "$1://[redacted]"
        )
    }

    /// URLSession 이 던지는 코드 중 **기기 네트워크 사정**인 것. 안드로이드의
    /// `UnknownHostException`·`SocketTimeoutException`·`ConnectException`·`SSLException` 에
    /// 대응한다. `.badServerResponse`·`.cannotParseResponse` 같은 응답 형식 문제는 결함일
    /// 수 있어 일부러 뺀다.
    private static let transientURLErrorCodes: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .timedOut,
        .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
        .secureConnectionFailed, .serverCertificateUntrusted,
        .internationalRoamingOff, .dataNotAllowed, .callIsActive,
        // ⚠ **취소도 여기 있어야 한다**(2026-09-22). BG 워치독·시스템 만료가 전송 **도중**
        //   `Task.cancel()` 을 부르면 이미 날아간 URLSession 요청은 `CancellationError` 가
        //   아니라 `URLError(.cancelled)` 로 돌아온다(`UserFacingError.swift` 의 `isCancellation`).
        //   이게 빠져 있어 BG 사이클의 모든 `reportError` 호출부(토큰 갱신·목소리 접근권·
        //   push/pull·사용 기록)가 시간이 모자란 회차마다 허위 이슈를 만들 수 있었다.
        .cancelled,
    ]

    /// Sentry 에 **이슈로 올리지 않는** 실패인가. 로그와 브레드크럼에만 남긴다.
    ///
    /// 안드로이드 `AlarmTalkLog.isExpectedTransientFailure` 의 대응물이고 기준도 같다 —
    /// `docs/spec/error-codes.md` §3 「기록은 전부, 경보는 골라서」. 사용자가 고칠 수 없고
    /// 우리도 고칠 코드가 없는 실패를 이슈로 올리면 진짜 결함이 그 사이에 묻힌다
    /// (2026-09-14 안드로이드 1.2.6 출시 직후 미해결 11건 중 8건이 이 종류였다).
    ///
    /// 1. **태스크 취소**(`CancellationError`, 그리고 전송 도중 취소된 요청의
    ///    `URLError(.cancelled)`). 오류가 아니라 흐름 제어다.
    /// 2. **일시적 네트워크 실패**([transientURLErrorCodes]). `NSUnderlyingErrorKey` 사슬
    ///    어디에 있든 본다 — 도메인 오류로 한 번 감싼 것도 같은 실패다.
    ///
    /// ⚠ HTTP 4xx(`APIError.server`)는 여기서 가르지 않는다. 낮추는 4xx 는 둘뿐이고 각자 **형제 판정**이
    /// 맡는다 — 401 은 [isHandledAuthFailure], 사용자가 고칠 예상된 거절 목록은 [isExpectedRefusal]. 둘 다 기기
    /// 사정으로 곧 나아질 실패가 아니라 뜻이 달라서, 한 판정에 합치면 브레드크럼 category 가 섞인다. 그 밖의 4xx 는
    /// 호출부가 `error_code` 를 보고 결정한다(`RemoteAlarmSyncViewModel` 의 `CONSENT_REQUIRED`).
    static func isExpectedTransientFailure(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        return errorChainContains(error) { candidate in
            guard let urlError = candidate as? URLError else { return false }
            return transientURLErrorCodes.contains(urlError.code)
        }
    }

    /// 원인 사슬(`NSUnderlyingErrorKey`)을 타며 [predicate] 에 걸리는 것을 찾는다.
    ///
    /// ⚠ **두 판정이 같은 방식으로 사슬을 타야 한다.** 한쪽만 사슬을 타면 *같은 실패*가
    /// 도메인 오류로 한 번 감싸였는지에 따라 이슈가 되기도 하고 안 되기도 한다 —
    /// 2026-09-21 1차 수정의 [isHandledAuthFailure] 가 실제로 최상위만 보고 있었다
    /// (안드로이드 짝 `core/AlarmTalkLog.kt` 의 `httpStatusCode` 는 처음부터 cause 를 탔다).
    ///
    /// 깊이 8 이 순환 방지다 — 사슬이 자기를 가리켜도 멈춘다.
    private static func errorChainContains(
        _ error: Error,
        where predicate: (Error) -> Bool
    ) -> Bool {
        firstInErrorChain(error) { predicate($0) ? true : nil } ?? false
    }

    /// 원인 사슬에서 [pick] 이 처음 값을 돌려주는 자리를 찾는다. 사슬을 타는 곳은 **여기 하나**다 —
    /// 판정([errorChainContains])과 묶음 키([apiFailure])가 다른 방식으로 타면, 같은 실패가
    /// 감싸였는지에 따라 낮추는 판정과 지문이 서로 어긋난다.
    private static func firstInErrorChain<Found>(_ error: Error, _ pick: (Error) -> Found?) -> Found? {
        var current: Error? = error
        var depth = 0
        while let candidate = current, depth < 8 {
            if let found = pick(candidate) { return found }
            current = (candidate as NSError).userInfo[NSUnderlyingErrorKey] as? Error
            depth += 1
        }
        return nil
    }

    /// **중앙 401 처리기가 이미 끝낸** 인증 실패인가. 로그와 브레드크럼에만 남긴다.
    ///
    /// [isExpectedTransientFailure] 와 형제이되 뜻이 다르다. 저쪽은 "기기 네트워크 사정이라
    /// 우리가 고칠 코드가 없다" 이고, 이쪽은 "세션이 죽었고 그 처리(로그아웃)는 이미 됐다" 다.
    /// 401 은 `AlarmTalkAPI.handleUnauthorized` 가 디바운스해 세션 만료 알림을 쏘고
    /// `AuthViewModel.handleUnauthorized` 가 받아 `signOut` 까지 마치므로, 호출부가 남기는
    /// 보고는 그 처리의 **메아리**다. 서버의 `ALERTING_ERROR_CODES` 에도 `AUTH_USER_NOT_FOUND`
    /// 같은 401 코드는 없다(`packages/shared/src/schemas/error-codes.ts`) — 규약
    /// 「기록은 전부, 경보는 골라서」와 어긋난 노이즈였다(2026-09-21 Sentry ALARMTALK-IOS-2,
    /// 700건).
    ///
    /// ⚠ **401 뿐이다.** 403·409·5xx 는 그대로 이슈로 올라가야 한다 — 권한·상태 충돌·서버
    /// 사고는 우리가 고칠 것이 있는 갈래다.
    ///
    /// ⚠ **원인 사슬을 탄다 — 형제 [isExpectedTransientFailure] 와 같은 방식이다.**
    /// 저장소·뷰모델이 실패를 도메인 오류로 한 번 감싸 던지는 경로가 있어서, 최상위만 보면
    /// 감싼 401 이 그대로 이슈로 올라간다(감싸느냐 아니냐로 경보 여부가 갈리면 계약이 아니다).
    /// 안드로이드 짝 `core/AlarmTalkLog.kt` 의 `isHandledAuthFailure` 도 cause 를 탄다 —
    /// **한쪽만 고치지 말 것.**
    static func isHandledAuthFailure(_ error: Error) -> Bool {
        errorChainContains(error) { candidate in
            if case APIError.server(401, _, _) = candidate { return true }
            return false
        }
    }

    /// **사용자가 고칠 예상된 거절**의 `error_code` — 이 앱에서는 이 목록 한 곳이다. 사용자가 친 값의 문제이고 화면이
    /// 코드로 고른 문장으로 이유를 이미 말해, 우리가 고칠 코드가 없다. 규칙은 `docs/spec/error-codes.md` §3 「앱도 같다」.
    /// 원본은 `packages/shared/src/schemas/error-codes.ts` 의 `CLIENT_EXPECTED_REFUSAL_CODES` 이고 값이 같아야 한다 —
    /// CI lint(`scripts/check-expected-refusal-codes.py`)가 이 이름과 모양(`Set<String>`)으로 찾아 대조한다.
    ///
    /// ⚠ **`AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`·`VOICE_MONTHLY_CHANGE_LIMIT_REACHED` 를 넣지 말 것.** 1.2.10 의 두
    /// 묶음(같은 코드 다섯 번 제출, 낡은 등록 횟수)은 그 둘이 이슈로 올라와 드러났다 — 시도 상한·월 한도에 닿는 것은
    /// 화면이 사람을 막다른 길로 보냈다는 신호일 수 있다.
    static let expectedRefusalCodes: Set<String> = ["AUTH_EMAIL_CODE_INVALID","AUTH_EMAIL_CODE_EXPIRED","AUTH_EMAIL_TAKEN","AUTH_EMAIL_SOCIAL","CODE_NOT_FOUND","CODE_EXPIRED","CODE_ALREADY_USED","CODE_ALREADY_REDEEMED_BY_YOU","CODE_EXHAUSTED","CODE_INACTIVE","CODE_NOT_IN_WINDOW"]

    /// [expectedRefusalCodes] 의 거절인가 — 원인 사슬의 첫 HTTP 응답이 **4xx** 이고 그 코드가 목록에 있을 때만.
    ///
    /// - 응답은 묶음 키와 **같은 방법**으로 읽는다([apiFailure] — 감싸인 응답도 같다). 다르게 읽으면 같은 거절이
    ///   감싸였는지에 따라 낮춰지기도 하고 이슈가 되기도 한다.
    /// - ⚠ 같은 코드라도 5xx 면 거절이 아니라 사고다 — 상태를 함께 본다.
    /// - 코드가 없으면 거절로 보지 않는다 — 무엇을 거절했는지 모르면 고칠 것이 있는지도 모른다.
    static func isExpectedRefusal(_ error: Error) -> Bool {
        guard let failure = apiFailure(in: error),
              (400...499).contains(failure.status),
              let code = failure.code else { return false }
        return expectedRefusalCodes.contains(code)
    }

    /// 이슈로 올리지 않고 브레드크럼으로만 남길 실패인가 — 남긴다면 그 category.
    /// 올려야 할 실패면 nil. 안드로이드 짝은 `core/AlarmTalkLog.kt` 의 `breadcrumbCategoryFor` 다.
    ///
    /// 갈래를 **한 이름으로 뭉치지 않는다.** 다음 진짜 이벤트를 읽을 때 "네트워크가 끊겨 있었다",
    /// "세션이 끊겨 이미 로그아웃했다", "사용자가 틀린 코드를 넣었다" 는 전혀 다른 맥락이다.
    static func handledFailureCategory(_ error: Error) -> String? {
        if isHandledAuthFailure(error) { return "auth" }
        if isExpectedTransientFailure(error) { return "transient" }
        if isExpectedRefusal(error) { return "refusal" }
        return nil
    }

    // MARK: - 묶음 키 — API 실패는 코드와 호출 자리로 묶는다

    /// 로그 메시지에서 ` key=value` 토큰(공백 뒤 `이름=값`)을 뺀 것 — **어디서 부른 실패인가**만
    /// 남긴다. `알람 push 실패(create): status=403 code=X` → `알람 push 실패(create):`.
    ///
    /// ⚠ **메시지를 그대로 지문에 넣지 말 것.** 상태코드·id 처럼 회차마다 바뀌는 값이 섞여
    /// 값마다 이슈가 하나씩 생긴다.
    static func logKey(of message: String) -> String {
        guard let regex = keyValueTokenPattern else { return message }
        let range = NSRange(message.startIndex..., in: message)
        return regex.stringByReplacingMatches(in: message, range: range, withTemplate: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 로그 메시지의 값 토큰 — 공백 뒤 `이름=값`. 안드로이드 `core/AlarmTalkLog.kt` 의 `logKeyOf` 와
    /// 같은 패턴이어야 한다(다르면 같은 메시지 모양이 두 앱에서 다른 키가 된다).
    private static let keyValueTokenPattern = try? NSRegularExpression(pattern: "\\s+[A-Za-z_][A-Za-z0-9_.]*=\\S*")

    /// Sentry 태그 값의 길이 상한.
    private static let sentryTagValueMax = 200

    /// 원인 사슬에서 처음 만나는 HTTP 응답(`APIError.server`)의 상태와 `error_code`.
    private static func apiFailure(in error: Error) -> (status: Int, code: String?)? {
        firstInErrorChain(error) { candidate in
            guard case let APIError.server(status, _, code) = candidate else { return nil }
            return (status, code?.isEmpty == false ? code : nil)
        }
    }

    /// API 실패의 **묶음 키**(Sentry fingerprint). 원인 사슬에 HTTP 응답이 없으면 nil — 그때는
    /// Sentry 의 기본 묶음을 그대로 쓴다. 규칙은 `docs/spec/error-codes.md` §3 「앱의 묶음 키」
    /// 이고, 안드로이드 `core/AlarmTalkLog.kt` 와 **같은 세 모양**이어야 한다(한쪽만 다르면 같은
    /// 실패가 프로젝트마다 다르게 묶인다).
    ///
    /// | 응답 | 지문 |
    /// | --- | --- |
    /// | `error_code` 가 있다 | `["api_error", 코드, logKey]` |
    /// | 코드 없는 4xx | `["api_error", "HTTP_<상태>", logKey]` |
    /// | 코드 없는 5xx | `["api_error", "HTTP_<상태>"]` |
    ///
    /// - **왜 필요한가.** Sentry 는 Swift 오류를 도메인·코드로 묶는다. `APIError.server` 는 상태와
    ///   코드가 달라도 같은 enum case 라, 지문을 주지 않으면 서로 다른 실패가 한 이슈에 쌓이기
    ///   쉽다 — 401 메아리 700건이 ALARMTALK-IOS-2 하나였던 것과 같은 성질이다(401 이 아닌 실패가
    ///   실제로 거기 붙는지는 확인하지 못했다 — 그때 보고 호출부는 알람 push·사용 기록 전송 둘뿐이었다.
    ///   2026-10-11 에 인증 코드 다섯 갈래가 더해졌다 — `AuthViewModel` 의 `reportFailure`).
    /// - **왜 코드 없는 5xx 는 호출 자리를 빼는가.** 우리 워커는 코드 없는 4xx/5xx 를 내지 않는다.
    ///   코드 없는 5xx 는 워커 앞단(게이트웨이·프록시)이 낸 것이라, 어느 화면이 불렀는지는 원인을
    ///   가르지 않는다 — 호출 자리를 넣으면 같은 장애가 호출부 수만큼의 이슈로 갈린다. 코드 없는
    ///   4xx 는 남긴다(주소·라우팅이 틀린 자리를 가리킨다).
    ///
    /// ⚠ **이 키는 무엇도 낮추지 않는다.** 브레드크럼으로 내려가는 범위는 [handledFailureCategory]
    /// 그대로다. 여기서 정하는 것은 올라간 이벤트가 **어느 이슈에 붙는가**뿐이다.
    static func apiFailureFingerprint(for error: Error, message: String) -> [String]? {
        guard let failure = apiFailure(in: error) else { return nil }
        if let code = failure.code {
            return ["api_error", code, logKey(of: message)]
        }
        let status = "HTTP_\(failure.status)"
        return failure.status >= 500 ? ["api_error", status] : ["api_error", status, logKey(of: message)]
    }

    /// 잡아서 처리한 오류를 알린다. 크래시는 SDK 가 알아서 잡는다.
    static func reportError(_ message: String, error: Error? = nil) {
        if let error, let category = handledFailureCategory(error) {
            // 이슈가 아니라 브레드크럼이다 — 다음 진짜 이벤트에 맥락으로 붙고, 그 자체로는
            // 아무것도 만들지 않는다. 로그도 error 가 아니라 warning 으로 낮춘다.
            logger.warning("\(message, privacy: .public): \(String(describing: error), privacy: .public)")
            let crumb = Breadcrumb(level: .warning, category: category)
            crumb.message = redactUserURIs(message)
            crumb.data = [
                "exception": String(describing: type(of: error)),
                "detail": redactUserURIs(String(describing: error)),
            ]
            SentrySDK.addBreadcrumb(crumb)
            return
        }
        if let error {
            logger.error("\(message, privacy: .public): \(String(describing: error), privacy: .public)")
        } else {
            logger.error("\(message, privacy: .public)")
        }

        // ⚠ **여기서 먼저 마스킹한다.** `beforeSend` 는 이벤트 메시지·예외 값만 훑으므로,
        // 우리가 붙이는 컨텍스트는 이 자리에서 거르지 않으면 그대로 나간다.
        let safeMessage = redactUserURIs(message)
        // 지문이 묶고, 태그가 찾는다. 호출 자리(`log.key`)는 HTTP 가 아닌 오류에도 붙인다 —
        // 묶음은 기본 그대로 두고 검색만 되게 한다. 태그 값은 상한(200자)에서 자른다 — 넘으면
        // 서버가 그 태그를 버린다(안드로이드 `core/AlarmTalkLog.kt` 의 `reportTags` 와 같은 값).
        let key = String(logKey(of: safeMessage).prefix(sentryTagValueMax))
        if let error {
            let failure = apiFailure(in: error)
            let fingerprint = apiFailureFingerprint(for: error, message: safeMessage)
            SentrySDK.capture(error: error) { scope in
                scope.setTag(value: "true", key: "handled")
                scope.setTag(value: key, key: "log.key")
                if let failure {
                    scope.setTag(value: String(failure.status), key: "api.status")
                    if let code = failure.code {
                        scope.setTag(value: String(code.prefix(sentryTagValueMax)), key: "api.error_code")
                    }
                }
                if let fingerprint { scope.setFingerprint(fingerprint) }
                scope.setContext(value: ["message": safeMessage], key: "log_message")
            }
        } else {
            SentrySDK.capture(message: safeMessage) { scope in
                scope.setTag(value: key, key: "log.key")
            }
        }
    }

    /// **유닛 테스트 프로세스 안인가.**
    ///
    /// 저장 위치를 가르는 판정(`TestIsolation.isRunningUnitTests`)과 **같은 신호**를 쓴다 —
    /// 테스트냐 아니냐를 두 벌로 정의하면 언젠가 갈라진다. 다만 여기서는 XCTest 프레임워크가
    /// 이 프로세스에 올라와 있는지도 함께 본다: 환경변수가 없는 실행 형태에서 잘못 켜도
    /// 잃는 것은 **사용자 기기가 아닌 프로세스의 텔레메트리뿐**이라, 저장 경로와 달리
    /// 넉넉하게 잡는 쪽이 안전하다. 출시 앱에는 XCTest 가 링크되지 않으므로 실기기에서
    /// 이 값이 참이 될 일은 없다.
    ///
    /// UI 테스트(`AlarmTalkUITests`)는 앱을 **별도 프로세스**로 띄우므로 걸리지 않는다 —
    /// `TestIsolation` 과 같은 이유로 의도한 것이다. 거기서 올라오는 것은 실제 기기에서
    /// 실제 화면을 조작하다 난 실패라 우리가 봐야 한다.
    static var isRunningUnderXCTest: Bool {
        TestIsolation.isRunningUnitTests || NSClassFromString("XCTestCase") != nil
    }

    /// 크래시 리포팅을 **켤 것인가.** 부작용 없는 순수 판정이라 회귀 테스트가 이 줄을
    /// 그대로 본다(안드로이드 `shouldInitializeSentry(dsn:buildFingerprint:)` 와 같은 모양).
    ///
    /// ⚠ **유닛 테스트에서는 켜지 않는다.** 이 맥의 `Local.xcconfig` 에는 진짜 DSN 이 있고,
    /// `AlarmTalkTests` 는 TEST_HOST 를 잡는 `bundle.unit-test` 라 **테스트 실행마다 호스트
    /// 앱이 launch** 하며 그 첫 훅(`PushAppDelegate`)이 이 초기화를 부른다. 그러면 테스트가
    /// 일부러 만든 실패까지 이슈로 올라가 진짜 사고가 그 사이에 묻힌다 — 안드로이드는 같은
    /// 이유로 ALARMTALK-ANDROID-2/-3 에 10,256건이 쌓였다.
    ///
    /// ⚠ **예외 이름·메시지로 거르지 말 것.** 여기서 가르는 것은 "실행 환경이 테스트인가"
    /// 하나이고, **실기기에서 올라오는 것은 무엇이든 그대로 올린다.**
    ///
    /// - Parameters:
    ///   - dsn: `VOICE_ALARM_SENTRY_DSN` 빌드 설정값(공백만 있어도 '없음' 으로 본다).
    ///   - isRunningTests: 유닛 테스트 프로세스인가([isRunningUnderXCTest]).
    static func shouldStartCrashReporting(dsn: String, isRunningTests: Bool) -> Bool {
        let trimmed = dsn.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && !isRunningTests
    }

    /// 앱 시작 시 1회. 실패해도 앱은 계속 뜬다 —
    /// 안드로이드도 `runCatching { initializeSentry() }` 로 감싼다(초기화가 던져서
    /// 첫 화면 전에 죽는 일이 없게).
    static func startCrashReporting() {
        let dsn = (Bundle.main.object(forInfoDictionaryKey: "VOICE_ALARM_SENTRY_DSN") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let underTest = isRunningUnderXCTest
        guard shouldStartCrashReporting(dsn: dsn, isRunningTests: underTest) else {
            // 왜 꺼졌는지 둘을 갈라 남긴다 — "DSN 을 안 넣었나" 와 "테스트라 껐나" 는
            // 다음에 이 줄을 읽을 때 전혀 다른 이야기다.
            let reason = "dsnConfigured=\(!dsn.isEmpty) underTest=\(underTest)"
            logger.info("Sentry disabled; \(reason, privacy: .public)")
            return
        }
        let environment = (Bundle.main.object(forInfoDictionaryKey: "VOICE_ALARM_SENTRY_ENVIRONMENT") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "development"
        let bundleID = Bundle.main.bundleIdentifier ?? "com.alarmtalk.app"
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"

        SentrySDK.start { options in
            options.dsn = dsn
            options.environment = environment
            // 안드로이드와 같은 형식: `<bundleId>@<version>+<build>`.
            options.releaseName = "\(bundleID)@\(version)+\(build)"
            // ⚠ **PII 를 켜지 말 것.** 안드로이드 `isSendDefaultPii = false` 와 같다.
            options.sendDefaultPii = false
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            #if DEBUG
            options.debug = true
            #endif
            // 안드로이드 `beforeSend` 와 같은 안전망 — `sendDefaultPii = false` 로도
            // 못 막는 경로가 있다. 플랫폼 예외(파일 없음·권한 없음 등) 메시지에는 사용자가
            // 고른 파일의 **전체 경로**가 들어가고, 그게 예외 value 로 그대로 전송된다.
            options.beforeSend = { event in
                if let formatted = event.message?.formatted {
                    event.message = SentryMessage(formatted: redactUserURIs(formatted))
                }
                event.exceptions?.forEach { exception in
                    exception.value = redactUserURIs(exception.value)
                }
                return event
            }
        }
    }
}
