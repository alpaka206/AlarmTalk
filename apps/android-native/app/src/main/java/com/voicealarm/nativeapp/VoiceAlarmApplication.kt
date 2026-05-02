package com.voicealarm.nativeapp

import android.app.Application
import android.util.Log
import com.voicealarm.nativeapp.alarm.NotificationChannels
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG

class VoiceAlarmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationChannels.ensure(this)
        Log.i(TAG, "Voice Alarm native application started")
    }
}
