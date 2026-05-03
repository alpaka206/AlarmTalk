package com.voicealarm.nativeapp.alarm

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.voicealarm.nativeapp.R
import com.voicealarm.nativeapp.alarm.AlarmContract.ACTION_DISMISS
import com.voicealarm.nativeapp.alarm.AlarmContract.ACTION_SNOOZE
import com.voicealarm.nativeapp.alarm.AlarmContract.EXTRA_ALARM_ID
import com.voicealarm.nativeapp.ringing.RingingActivity

internal class RingingNotificationFactory(
    private val context: Context,
) {
    fun build(alarmId: String): Notification {
        val activityIntent = Intent(context, RingingActivity::class.java).apply {
            putExtra(EXTRA_ALARM_ID, alarmId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TASK or
                Intent.FLAG_ACTIVITY_NO_ANIMATION
        }
        val fullScreenIntent = PendingIntent.getActivity(
            context,
            RINGING_ACTIVITY_REQUEST_CODE,
            activityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(context, NotificationChannels.RINGING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_alarm_24)
            .setColor(0xFFE8B341.toInt())
            .setContentTitle(context.getString(R.string.ringing_notification_title))
            .setContentText(context.getString(R.string.ringing_notification_text))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSound(null)
            .setVibrate(null)
            .setContentIntent(fullScreenIntent)
            .setFullScreenIntent(fullScreenIntent, true)
            .addAction(
                R.drawable.ic_alarm_24,
                "Snooze",
                servicePendingIntent(ACTION_SNOOZE, alarmId, SNOOZE_REQUEST_CODE),
            )
            .addAction(
                R.drawable.ic_alarm_24,
                "Dismiss",
                servicePendingIntent(ACTION_DISMISS, alarmId, DISMISS_REQUEST_CODE),
            )
            .build()
    }

    private fun servicePendingIntent(action: String, alarmId: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, RingingService::class.java).apply {
            this.action = action
            putExtra(EXTRA_ALARM_ID, alarmId)
        }
        return PendingIntent.getService(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private companion object {
        const val RINGING_ACTIVITY_REQUEST_CODE = 2001
        const val DISMISS_REQUEST_CODE = 2002
        const val SNOOZE_REQUEST_CODE = 2003
    }
}
