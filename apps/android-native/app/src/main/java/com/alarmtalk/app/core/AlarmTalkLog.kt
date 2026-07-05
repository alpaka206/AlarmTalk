package com.alarmtalk.app.core

import android.util.Log
import io.sentry.Sentry
import io.sentry.SentryLevel

object AlarmTalkLog {
    const val TAG = "AlarmTalk"

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
            if (error != null) {
                Sentry.captureException(error) { scope ->
                    scope.setTag("handled", "true")
                    scope.setContexts("log_message", message)
                }
            } else {
                Sentry.captureMessage(message, SentryLevel.ERROR)
            }
        }
    }
}
