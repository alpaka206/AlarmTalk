package com.voicealarm.nativeapp.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.content.getSystemService

object NotificationChannels {
    const val RINGING_CHANNEL_ID = "voice_alarm_ringing_v2"
    const val SOCIAL_CHANNEL_ID = "voice_alarm_social_updates_v1"

    fun ensure(context: Context) {
        val notificationManager = requireNotNull(context.getSystemService<NotificationManager>())
        val ringingChannel = NotificationChannel(
            RINGING_CHANNEL_ID,
            "Voice Alarm ringing",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Full-screen alarm ringing alerts"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setSound(null, null)
            enableVibration(false)
        }

        val socialChannel = NotificationChannel(
            SOCIAL_CHANNEL_ID,
            "Voice Alarm updates",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Messages and alarms sent by connected people"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        }

        notificationManager.createNotificationChannel(ringingChannel)
        notificationManager.createNotificationChannel(socialChannel)
    }
}
