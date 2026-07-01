package com.alarmtalk.app.alarm

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.alarmtalk.app.R
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DISMISS
import com.alarmtalk.app.alarm.AlarmContract.ACTION_SNOOZE
import com.alarmtalk.app.alarm.AlarmContract.EXTRA_ALARM_ID
import com.alarmtalk.app.ringing.RingingActivity

internal class RingingNotificationFactory(
    private val context: Context,
) {
    /**
     * @param fallback FGS(포그라운드 서비스) 시작이 막혀 알림 자체가 소리·진동을 내야 하는 폴백 경로면 true.
     *   true 면 소리·진동을 내는 폴백 채널을 사용하고, 알림 레벨에서 소리/진동을 무음화하지 않는다.
     *   false(기본, 정상 경로)면 무음 울림 채널을 사용하고 소리는 RingingService 의 MediaPlayer 가 담당한다.
     *   두 경로 모두 카테고리(CATEGORY_ALARM)·전체화면 인텐트·해제/스누즈 액션을 동일하게 유지한다.
     */
    fun build(alarmId: String, fallback: Boolean = false): Notification {
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

        val channelId = if (fallback) {
            NotificationChannels.RINGING_FALLBACK_CHANNEL_ID
        } else {
            NotificationChannels.RINGING_CHANNEL_ID
        }

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_alarm_24)
            .setColor(0xFFE8B341.toInt())
            .setContentTitle(context.getString(R.string.ringing_notification_title))
            .setContentText(context.getString(R.string.ringing_notification_text))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(fullScreenIntent)
            .setFullScreenIntent(fullScreenIntent, true)
            .addAction(
                R.drawable.ic_alarm_24,
                context.getString(R.string.r3misc_ringing_action_snooze),
                servicePendingIntent(ACTION_SNOOZE, alarmId, SNOOZE_REQUEST_CODE),
            )
            .addAction(
                R.drawable.ic_alarm_24,
                context.getString(R.string.r3misc_ringing_action_dismiss),
                servicePendingIntent(ACTION_DISMISS, alarmId, DISMISS_REQUEST_CODE),
            )

        if (!fallback) {
            // 정상 경로: 소리는 RingingService 의 MediaPlayer 가 담당 → 알림은 무음(중복 소리 방지).
            builder.setSound(null).setVibrate(null)
        }
        // 폴백 경로: 소리·진동은 폴백 채널(IMPORTANCE_HIGH, USAGE_ALARM 사운드)이 담당한다.

        return builder.build()
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
