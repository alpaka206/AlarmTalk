package com.alarmtalk.app

import android.app.Application
import android.util.Log
import com.alarmtalk.app.alarm.NotificationChannels
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import io.sentry.android.core.SentryAndroid

class VoiceAlarmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        initializeSentry()
        NotificationChannels.ensure(this)
        RemoteAlarmSyncScheduler.ensurePeriodic(this)
        if (AuthSessionStore(this).read() != null) {
            RemoteAlarmSyncScheduler.runOnce(this)
        }
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
