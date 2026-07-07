package com.alarmtalk.app.core

import android.util.Log
import io.sentry.Sentry
import io.sentry.SentryLevel

object AlarmTalkLog {
    const val TAG = "AlarmTalk"

    // 사용자 미디어 URI(content://, file://)는 파일명·로컬 식별자가 담겨 PII 소지가 있다.
    // Sentry 로 나가는 모든 문자열은 이 마스킹을 거친다(Logcat 은 로컬 전용이라 원문 유지).
    // AlarmTalkApplication 의 beforeSend 훅도 같은 규칙으로 이벤트를 한 번 더 거른다(안전망).
    private val USER_URI_REGEX = Regex("""(content|file)://\S+""")

    fun redactUserUris(text: String): String =
        USER_URI_REGEX.replace(text) { match -> "${match.groupValues[1]}://[redacted]" }

    // 잡아서 처리한(비크래시) 오류의 개발자 채널: Logcat + Sentry.
    // 사용자에게는 userFacingError() 등으로 다듬은 문구만 보여주고,
    // 원인 파악에 필요한 상세(스택·컨텍스트)는 이 함수로만 흘려보낸다.
    // Sentry가 초기화되지 않은 경우(DSN 미설정) capture* 는 no-op 이라 안전하다.
    fun reportError(message: String, error: Throwable? = null) {
        if (error != null) {
            Log.e(TAG, message, error)
        } else {
            Log.e(TAG, message)
        }
        runCatching {
            // log_message 컨텍스트·메시지 이벤트는 beforeSend 가 건드리지 않으므로
            // 여기서 먼저 마스킹해 URI 가 어떤 경로로도 Sentry 에 실리지 않게 한다.
            val safeMessage = redactUserUris(message)
            if (error != null) {
                Sentry.captureException(error) { scope ->
                    scope.setTag("handled", "true")
                    scope.setContexts("log_message", safeMessage)
                }
            } else {
                Sentry.captureMessage(safeMessage, SentryLevel.ERROR)
            }
        }
    }
}
