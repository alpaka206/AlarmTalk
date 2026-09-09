package com.alarmtalk.app.alarm

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.alarmtalk.app.R
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DISMISS
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DISMISS_SILENT
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
    /**
     * @param snoozeAvailable 다시 울림을 **지금 누를 수 있는가**(= `AlarmEntity.canSnoozeNow`,
     *   지금은 `snoozeEnabled` 하나다).
     *
     * ⚠ **울림 화면과 같은 기준이어야 한다.** 어긋나면 `AlarmRepository.snooze` 가 null 을
     * 돌려주고 `RingingService` 가 그때 **알람을 끝낸다** — '다시 울리기' 를 눌렀는데 알람이
     * 꺼진다. 조건을 여기 손으로 다시 조립하지 말고 `canSnoozeNow` 를 부를 것.
     * (횟수 한도는 2026-09-09 에 없앴다 — 되살리지 말 것.)
     */
    fun build(
        alarmId: String,
        fallback: Boolean = false,
        snoozeAvailable: Boolean = true,
    ): Notification {
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
                context.getString(R.string.r3misc_ringing_action_dismiss),
                servicePendingIntent(ACTION_DISMISS, alarmId, DISMISS_REQUEST_CODE),
            )
        if (snoozeAvailable) {
            builder.addAction(
                R.drawable.ic_alarm_24,
                context.getString(R.string.r3misc_ringing_action_snooze),
                servicePendingIntent(ACTION_SNOOZE, alarmId, SNOOZE_REQUEST_CODE),
            )
        }

        if (!fallback) {
            // 정상 경로: 소리는 RingingService 의 MediaPlayer 가 담당 → 알림은 무음(중복 소리 방지).
            builder.setSound(null).setVibrate(null)
            // ⚠ 갱신에서 배너를 다시 띄우지 않는다. 이제 울림 화면이 **항상** 뜨므로
            //   (`RingingService.openRingingActivity`) 배너가 그 위에 겹치는데, 다시 울림
            //   가능 여부가 바뀌어 이 알림을 재게시할 때 겹침이 한 번 더 생긴다.
            //   ⚠ **폴백에는 걸지 않는다** — 그 경로는 알림 **채널이 소리를 내는 것**이
            //   존재 이유고(FGS 를 못 띄워 MediaPlayer 가 없다), 같은 id(1001)를 갱신하는
            //   순간이 오면 ONLY_ALERT_ONCE 가 그 소리를 **삼킨다.**
            builder.setOnlyAlertOnce(true)
            // 울림 화면은 이제 **항상** 뜨지만(`RingingService.openRingingActivity`), 그 액티비티
            // 시작이 OS 에 막히면 이 알림이 남는 유일한 해제 UI 다. 그리고 스와이프 제거를
            // 막을 수 있는지는 **기기 OS 가 정한다** — 13 은 `setOngoing(true)` 로 막히고,
            // 14+ 는 막지 못한다(스펙 §2 표 참조).
            // 삭제 인텐트가 없으면 배너만 사라지고 톤·목소리·진동이 무기한 계속된다 →
            // 스와이프도 '해제'로 취급한다.
            builder.setDeleteIntent(
                servicePendingIntent(ACTION_DISMISS_SILENT, alarmId, DELETE_REQUEST_CODE),
            )
            // 폴백 경로에는 걸지 않는다: FGS 를 못 띄운 상황이라 getService 가 실패할 수 있고,
            // 그 경로의 소리는 채널 사운드 1회성이라 '무한히 울림' 증상 대상이 아니다.
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
        const val DELETE_REQUEST_CODE = 2004
    }
}
