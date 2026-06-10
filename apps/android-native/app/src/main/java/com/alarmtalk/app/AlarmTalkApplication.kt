package com.alarmtalk.app

import android.app.Application
import android.util.Log
import com.alarmtalk.app.alarm.NotificationChannels
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import io.sentry.android.core.SentryAndroid

class AlarmTalkApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // 각 초기화 단계의 실패가 앱 진입을 막지 않도록 개별 보호한다.
        // (release 빌드에서 Sentry/WorkManager 등 초기화가 던지면 첫 화면 전에
        //  프로세스가 즉시 종료되던 문제를 방지. 실패는 로그로만 남기고 계속 진행.)
        runCatching { initializeSentry() }
            .onFailure { Log.e(TAG, "Sentry init failed", it) }
        runCatching { NotificationChannels.ensure(this) }
            .onFailure { Log.e(TAG, "NotificationChannels init failed", it) }
        runCatching { RemoteAlarmSyncScheduler.ensurePeriodic(this) }
            .onFailure { Log.e(TAG, "RemoteAlarmSyncScheduler.ensurePeriodic failed", it) }
        runCatching {
            if (AuthSessionStore(this).read() != null) {
                RemoteAlarmSyncScheduler.runOnce(this)
            }
        }.onFailure { Log.e(TAG, "RemoteAlarmSyncScheduler.runOnce failed", it) }
        Log.i(TAG, "Voice Alarm native application started")
    }

    private fun initializeSentry() {
        val sentryDsn = BuildConfig.VOICE_ALARM_SENTRY_DSN.trim()
        if (sentryDsn.isEmpty()) {
            Log.i(TAG, "Sentry disabled; DSN is not configured")
            return
        }

        SentryAndroid.init(this) { options ->
            options.dsn = sentryDsn
            options.environment = BuildConfig.VOICE_ALARM_SENTRY_ENVIRONMENT
            options.release =
                "${BuildConfig.APPLICATION_ID}@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
            options.isSendDefaultPii = false
            options.isDebug = BuildConfig.DEBUG
            options.isAttachScreenshot = false
            options.isAttachViewHierarchy = false
        }
    }
}
