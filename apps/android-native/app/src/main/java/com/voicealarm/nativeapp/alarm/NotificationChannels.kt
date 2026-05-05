package com.voicealarm.nativeapp.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.content.getSystemService

object NotificationChannels {
    const val RINGING_CHANNEL_ID = "voice_alarm_ringing_v2"

    fun ensure(context: Context) {
        val notificationManager = requireNotNull(context.getSystemService<NotificationManager>())
        val channel = NotificationChannel(
            RINGING_CHANNEL_ID,
            "Voice Alarm ringing",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Full-screen alarm ringing alerts"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setSound(null, null)
            enableVibration(false)
        }

        notificationManager.createNotificationChannel(channel)
    }
}
