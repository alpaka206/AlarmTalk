package com.alarmtalk.app.alarm

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.alarmtalk.app.MainActivity
import com.alarmtalk.app.R

object SocialNotificationFactory {
    private const val ALARM_GROUP_ID = "voice_alarm_received_alarms"
    private const val BASE_ALARM_NOTIFICATION_ID = 3_000

    fun notifyReceivedAlarm(context: Context, alarmId: String, senderName: String?, time: String) {
        val body = time
            .takeIf { it.isNotBlank() }
            ?.let { context.getString(R.string.r3misc_notif_received_alarm_time, it) }
            ?: context.getString(R.string.r3misc_notif_received_alarm_default)
        // 알림 제목은 명사형 라벨('~님이 보낸 알람') 대신 문장형 — 리스트 라벨과 용도가 다르다.
        val honoredSender = senderName
            ?.takeIf { it.isNotBlank() }
            ?.let { if (it.endsWith("님")) it else context.getString(R.string.r3data_honorific_name, it) }
        val title = honoredSender
            ?.let { context.getString(R.string.r3misc_notif_received_alarm_sent, it) }
            ?: context.getString(R.string.r3misc_notif_received_alarm_sent_other)
        notify(
            context = context,
            notificationId = BASE_ALARM_NOTIFICATION_ID + stableOffset(alarmId),
            title = title,
            body = body,
            groupId = ALARM_GROUP_ID,
        )
    }

    /**
     * 공유 이용권 결제 실패 안내.
     *
     * ⚠ **포그라운드에서도 보여야 한다.** 서버가 `notification` 블록을 실어 보내므로
     * 앱이 백그라운드일 때는 시스템이 알아서 띄우지만, **포그라운드에서는 `onMessageReceived`
     * 로만 오고 아무것도 안 뜬다.** 그래서 여기서 직접 그린다.
     */
    fun notifyBillingHold(context: Context, title: String, body: String) {
        notify(
            context = context,
            notificationId = BILLING_HOLD_NOTIFICATION_ID,
            title = title,
            body = body,
            groupId = "billing_hold",
        )
    }

    /** 결제 안내는 한 번에 하나만 — 여러 번 와도 덮어쓴다(알림함을 채우지 않는다). */
    private const val BILLING_HOLD_NOTIFICATION_ID = 90_001

    private fun notify(
        context: Context,
        notificationId: Int,
        title: String,
        body: String,
        groupId: String,
    ) {
        val notificationManager = NotificationManagerCompat.from(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        if (!notificationManager.areNotificationsEnabled()) {
            return
        }
        NotificationChannels.ensure(context)
        notificationManager.notify(
            notificationId,
            NotificationCompat.Builder(context, NotificationChannels.SOCIAL_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_alarm_24)
                // 우측 큰 아이콘은 앱 로고 — 상태바 스몰 아이콘은 시스템 제약(단색 실루엣)상
                // 알람 글리프를 유지하고, 펼친 알림에서 브랜드가 보이게 한다.
                .setLargeIcon(
                    android.graphics.BitmapFactory.decodeResource(
                        context.resources,
                        R.drawable.ic_brand_logo,
                    ),
                )
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
