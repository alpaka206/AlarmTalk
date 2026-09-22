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
    /// ⚠ HTTP 4xx(`APIError.server`)는 **401 하나만 빼고** 여기서 가르지 않는다. 나머지는
    /// 호출부가 `error_code` 를 보고 결정한다(`RemoteAlarmSyncViewModel` 의 `CONSENT_REQUIRED`).
    /// 401 은 이 함수가 아니라 **형제 판정** [isHandledAuthFailure] 가 맡는다 — 기기 사정으로
    /// 곧 나아질 실패가 아니라 **이미 처리가 끝난** 실패라서, 둘을 한 판정에 합치면 뜻이 섞인다.
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
        var current: Error? = error
        var depth = 0
        while let candidate = current, depth < 8 {
            if predicate(candidate) { return true }
            current = (candidate as NSError).userInfo[NSUnderlyingErrorKey] as? Error
            depth += 1
        }
        return false
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

    /// 이슈로 올리지 않고 브레드크럼으로만 남길 실패인가 — 남긴다면 그 category.
    /// 올려야 할 실패면 nil.
    ///
    /// 두 갈래를 **한 이름으로 뭉치지 않는다.** 다음 진짜 이벤트를 읽을 때 "네트워크가
    /// 끊겨 있었다" 와 "세션이 끊겨 이미 로그아웃했다" 는 전혀 다른 맥락이다.
    static func handledFailureCategory(_ error: Error) -> String? {
        if isHandledAuthFailure(error) { return "auth" }
        if isExpectedTransientFailure(error) { return "transient" }
        return nil
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
        if let error {
            SentrySDK.capture(error: error) { scope in
                scope.setTag(value: "true", key: "handled")
                scope.setContext(value: ["message": safeMessage], key: "log_message")
            }
        } else {
            SentrySDK.capture(message: safeMessage)
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
