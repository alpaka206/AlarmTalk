package com.voicealarm.nativeapp.alarm

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.voicealarm.nativeapp.MainActivity
import com.voicealarm.nativeapp.R

object SocialNotificationFactory {
    private const val MESSAGE_GROUP_ID = "voice_alarm_messages"
    private const val ALARM_GROUP_ID = "voice_alarm_received_alarms"
    private const val BASE_MESSAGE_NOTIFICATION_ID = 2_000
    private const val BASE_ALARM_NOTIFICATION_ID = 3_000

    fun notifyNewMessage(context: Context, noteId: String, senderName: String?, text: String) {
        notify(
            context = context,
            notificationId = BASE_MESSAGE_NOTIFICATION_ID + stableOffset(noteId),
            title = senderName?.takeIf { it.isNotBlank() } ?: "새 메시지",
            body = text.take(80).ifBlank { "새 메시지가 도착했어요" },
            groupId = MESSAGE_GROUP_ID,
        )
    }

    fun notifyReceivedAlarm(context: Context, alarmId: String, senderName: String?, time: String) {
        notify(
            context = context,
            notificationId = BASE_ALARM_NOTIFICATION_ID + stableOffset(alarmId),
            title = "새 알람",
            body = listOfNotNull(
                senderName?.takeIf { it.isNotBlank() },
                time.takeIf { it.isNotBlank() },
            ).joinToString(" · ").ifBlank { "상대방이 알람을 설정했어요" },
            groupId = ALARM_GROUP_ID,
        )
    }

    private fun notify(
        context: Context,
        notificationId: Int,
        title: String,
        body: String,
        groupId: String,
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        NotificationChannels.ensure(context)
        NotificationManagerCompat.from(context).notify(
            notificationId,
            NotificationCompat.Builder(context, NotificationChannels.SOCIAL_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_alarm_24)
                .setColor(0xFFE8B341.toInt())
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setGroup(groupId)
                .setContentIntent(appPendingIntent(context))
                .build(),
        )
    }

    private fun appPendingIntent(context: Context): PendingIntent =
        PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun stableOffset(value: String): Int =
        (value.hashCode() and Int.MAX_VALUE) % 900
}
