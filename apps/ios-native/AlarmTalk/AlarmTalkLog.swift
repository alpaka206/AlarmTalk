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

    /// 잡아서 처리한 오류를 알린다. 크래시는 SDK 가 알아서 잡는다.
    static func reportError(_ message: String, error: Error? = nil) {
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

    /// 앱 시작 시 1회. 실패해도 앱은 계속 뜬다 —
    /// 안드로이드도 `runCatching { initializeSentry() }` 로 감싼다(초기화가 던져서
    /// 첫 화면 전에 죽는 일이 없게).
    static func startCrashReporting() {
        let dsn = (Bundle.main.object(forInfoDictionaryKey: "VOICE_ALARM_SENTRY_DSN") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !dsn.isEmpty else {
            logger.info("Sentry disabled; DSN is not configured")
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
