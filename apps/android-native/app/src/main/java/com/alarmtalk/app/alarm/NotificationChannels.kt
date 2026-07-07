package com.alarmtalk.app.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import androidx.core.content.getSystemService

object NotificationChannels {
    const val RINGING_CHANNEL_ID = "voice_alarm_ringing_v2"

    // 폴백 전용 채널: FGS(포그라운드 서비스) 시작이 OS 에 막혀 RingingService 의 MediaPlayer 가
    // 소리를 못 낼 때, 알림 자체가 소리·진동을 내도록 하는 채널. 정상 울림(무음) 채널과 분리해
    // 정상 경로의 중복 소리를 유발하지 않는다.
    const val RINGING_FALLBACK_CHANNEL_ID = "voice_alarm_ringing_fallback_v1"
    const val SOCIAL_CHANNEL_ID = "voice_alarm_social_updates_v1"

    // 폴백 채널 진동 패턴(대기, 진동, 대기, 진동…). 정상 경로는 RingingService 가 per-alarm 패턴으로 직접 진동한다.
    private val FALLBACK_VIBRATION_PATTERN = longArrayOf(0L, 600L, 400L, 600L, 400L, 600L)

    fun ensure(context: Context) {
        val notificationManager = requireNotNull(context.getSystemService<NotificationManager>())
        val ringingChannel = NotificationChannel(
            RINGING_CHANNEL_ID,
            "음성 알람 울림",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "포그라운드 서비스가 소리를 내는 정상 울림 알림(중복 소리 방지를 위해 채널은 무음)"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setSound(null, null)
            enableVibration(false)
        }

        val fallbackChannel = NotificationChannel(
            RINGING_FALLBACK_CHANNEL_ID,
            "음성 알람 울림(폴백)",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "포그라운드 서비스 시작이 차단됐을 때 알림 자체가 소리·진동으로 울리는 폴백 채널"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setBypassDnd(true)
            enableLights(true)
            enableVibration(true)
            vibrationPattern = FALLBACK_VIBRATION_PATTERN
            val alarmAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            setSound(resolveAlarmSoundUri(context), alarmAttributes)
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
        notificationManager.createNotificationChannel(fallbackChannel)
        notificationManager.createNotificationChannel(socialChannel)
    }

    // 실제 기본 알람음 → 없으면 시스템 기본 알람 → 최후에 기본 벨소리로 폴백.
    private fun resolveAlarmSoundUri(context: Context): Uri {
        val actualAlarm = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM)
        if (actualAlarm != null) return actualAlarm
        val defaultAlarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        if (defaultAlarm != null) return defaultAlarm
        return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    }
}
