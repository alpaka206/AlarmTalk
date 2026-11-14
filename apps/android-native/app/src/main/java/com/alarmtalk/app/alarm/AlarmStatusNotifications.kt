package com.alarmtalk.app.alarm

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.alarmtalk.app.MainActivity
import com.alarmtalk.app.R
import com.alarmtalk.app.data.AlarmEntity
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * 예약하지 못해 **꺼 둔** 알람을 알린다(2026-11-09 오너 — "off 되도록 하고 알림을 띄우는 게 맞지 않아?").
 *
 * 부르는 곳은 예약 복원의 한 길목(`AlarmRepository.reschedulePendingAlarmsLocked`)이다 — 예약 호출이 실패했거나, 1회성 알람의
 * 시각이 기기가 꺼진 사이 지나 다시 걸 수 없을 때. 행은 꺼지고 "알람 예약에 실패했어요." 가 붙는다(`alarmRowNotice`).
 * 이 알림은 앱 밖에서도 알게 하려는 것이다. 한 회차에 여럿이면 하나로 묶는다(같은 id 로 덮는다).
 *
 * 알림 권한이 없으면 조용히 건너뛴다 — 행 표시는 그대로 남는다. iOS 짝은 `AlarmStatusNotifier`.
 */
internal object AlarmStatusNotifications {
    const val NOTIFICATION_ID = 4101

    fun notifyTurnedOff(context: Context, alarms: List<AlarmEntity>) {
        if (alarms.isEmpty()) return
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        NotificationChannels.ensure(context)
        val text = if (alarms.size == 1) {
            context.getString(R.string.alarm_status_turned_off_one, timeLabel(context, alarms.first()))
        } else {
            context.getString(R.string.alarm_status_turned_off_many, alarms.size)
        }
        val open = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, NotificationChannels.ALARM_STATUS_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_alarm_24)
            .setContentTitle(context.getString(R.string.alarm_status_failed_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .build()
        try {
            manager.notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // 권한이 막 회수된 창 — 행 표시가 남는다.
        }
    }

    /** "오전 6:30" — 기기의 12/24시간 설정과 언어를 따른다(목록 행과 같은 결). */
    private fun timeLabel(context: Context, alarm: AlarmEntity): String {
        val locale = context.resources.configuration.locales[0]
        val skeleton = if (android.text.format.DateFormat.is24HourFormat(context)) "Hm" else "hma"
        val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, skeleton)
        return DateTimeFormatter.ofPattern(pattern, locale).format(LocalTime.of(alarm.hour, alarm.minute))
    }
}
