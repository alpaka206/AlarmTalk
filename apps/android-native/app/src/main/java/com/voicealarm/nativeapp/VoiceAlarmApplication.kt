package com.voicealarm.nativeapp

import android.app.Application
import android.util.Log
import com.voicealarm.nativeapp.alarm.NotificationChannels
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.network.AuthSessionStore
import com.voicealarm.nativeapp.sync.RemoteAlarmSyncScheduler

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
