package com.alarmtalk.app

import android.app.Application
import android.util.Log
import com.alarmtalk.app.alarm.NotificationChannels
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler

class VoiceAlarmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationChannels.ensure(this)
        RemoteAlarmSyncScheduler.ensurePeriodic(this)
        if (AuthSessionStore(this).read() != null) {
            RemoteAlarmSyncScheduler.runOnce(this)
        }
        Log.i(TAG, "Voice Alarm native application started")
    }
}
