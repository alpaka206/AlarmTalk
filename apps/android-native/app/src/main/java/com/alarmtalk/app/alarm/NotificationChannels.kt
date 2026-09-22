package com.alarmtalk.app.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import androidx.core.content.getSystemService

object NotificationChannels {
    /**
     * 울림 알림 채널 — **HIGH + 무음 + 전체화면 인텐트**를 싣는 채널이다.
     *
     * ⚠ **LOW 로 되돌리지 말 것**(2026-09-22 실기기 반증). 2026-09-09 에 "배너를 없애 달라"
     * 며 LOW 로 낮추고 전체화면 인텐트를 뗐는데, 그 설계는 **우리가 `startActivity` 로 울림
     * 화면을 직접 띄울 수 있다**는 전제 위에 있었다. 그 전제가 틀렸다 — Android 14+ 는
     * 앱에 보이는 액티비티가 없으면 서비스의 액티비티 시작을 **조용히 막는다**
     * (S23 Ultra / Android 16 logcat: `Background activity launch blocked! … callingUidProcState:
     * FOREGROUND_SERVICE … result code=102 BAL_BLOCK`). 잠금 화면에서는 소리만 나고 화면이
     * 없었다. 잠긴 기기에서 알람 화면을 띄우는 유일한 공식 경로는 **HIGH 채널의 전체화면
     * 인텐트**이고, 그것은 LOW 채널에서는 구조적으로 발동하지 않는다.
     *
     * 소리는 여전히 `RingingService` 가 낸다 — 채널은 무음이어야 두 겹으로 안 울린다.
     *
     * ⚠ **채널 importance 는 만든 뒤에 못 바꾼다.** 값을 고칠 때는 **id 를 새로** 붙이고
     * 옛 id 를 지워야 한다(v2 → v3 → v4 → v5). 코드만 고치면 이미 깔린 기기에는 옛 설정이
     * 그대로 남아 아무 일도 일어나지 않는다.
     */
    const val RINGING_CHANNEL_ID = "voice_alarm_ringing_v5"

    /**
     * **조용한 울림 채널**(LOW) — 앱이 이미 화면에 보여서 우리가 울림 화면을 직접 띄우는
     * 경우에만 쓴다. 그때 HIGH 채널을 쓰면 배너가 울림 화면 위에 겹친다(2026-09-09 지시
     * "배너 자체를 없애 달라" 는 이 경우의 이야기였다). 갈래 판정은
     * `RingingNotificationFactory.initialVariant` 한 곳이다.
     */
    const val RINGING_QUIET_CHANNEL_ID = "voice_alarm_ringing_quiet_v1"

    /**
     * 지워야 할 옛 울림 채널들(v2 = HIGH 배너, v3 = DEFAULT, v4 = LOW 전체화면 없음,
     * escalation_v1 = 같은 알림 id 를 **갱신**하는 방식이라 전체화면 인텐트가 발동한 적이 없다 —
     * SystemUI 는 새 항목에만 전체화면을 연다).
     */
    private val RETIRED_RINGING_CHANNEL_IDS = listOf(
        "voice_alarm_ringing_v2",
        "voice_alarm_ringing_v3",
        "voice_alarm_ringing_v4",
        "voice_alarm_ringing_escalation_v1",
    )

    // 폴백 전용 채널: FGS(포그라운드 서비스) 시작이 OS 에 막혀 RingingService 의 MediaPlayer 가
    // 소리를 못 낼 때, 알림 자체가 소리·진동을 내도록 하는 채널. 정상 울림(무음) 채널과 분리해
    // 정상 경로의 중복 소리를 유발하지 않는다.
    const val RINGING_FALLBACK_CHANNEL_ID = "voice_alarm_ringing_fallback_v1"

    const val SOCIAL_CHANNEL_ID = "voice_alarm_social_updates_v1"

    /**
     * 목소리 클립을 받는 동안의 **진행률 알림** 채널.
     *
     * ⚠ 소리·진동 없이 조용해야 한다(IMPORTANCE_LOW). 사용자가 요청한 알림이 아니라
     * "지금 몇 %인지 폰에서 바로 보이게" 하는 표시일 뿐이라, 소리를 내면 방해가 된다.
     */
    const val CLIP_PREFETCH_CHANNEL_ID = "voice_alarm_clip_prefetch_v1"

    // 폴백 채널 진동 패턴(대기, 진동, 대기, 진동…). 정상 경로는 RingingService 가 per-alarm 패턴으로 직접 진동한다.
    private val FALLBACK_VIBRATION_PATTERN = longArrayOf(0L, 600L, 400L, 600L, 400L, 600L)

    fun ensure(context: Context) {
        val notificationManager = requireNotNull(context.getSystemService<NotificationManager>())
        val ringingChannel = NotificationChannel(
            RINGING_CHANNEL_ID,
            "음성 알람 울림",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "알람이 울릴 때 잠금 화면 위에 울림 화면을 여는 알림(소리는 앱이 낸다)"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setSound(null, null)
            enableVibration(false)
        }

        val quietRingingChannel = NotificationChannel(
            RINGING_QUIET_CHANNEL_ID,
            "음성 알람 울림(화면 표시 중)",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "울림 화면이 이미 떠 있을 때 배너 없이 알림창에만 두는 알림(소리는 앱이 낸다)"
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

        val clipPrefetchChannel = NotificationChannel(
            CLIP_PREFETCH_CHANNEL_ID,
            "Voice download",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Progress while alarm voices are downloading"
            setShowBadge(false)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }

        // 옛 울림 채널을 지운다 — 남겨 두면 설정 화면에 죽은 채널이 보이고, 무엇보다
        // 이미 깔린 기기가 계속 옛 importance 로 배너를 띄운다.
        RETIRED_RINGING_CHANNEL_IDS.forEach(notificationManager::deleteNotificationChannel)

        notificationManager.createNotificationChannel(clipPrefetchChannel)
        notificationManager.createNotificationChannel(ringingChannel)
        notificationManager.createNotificationChannel(quietRingingChannel)
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
