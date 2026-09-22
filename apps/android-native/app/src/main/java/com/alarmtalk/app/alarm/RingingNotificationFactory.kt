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
     * 울림 알림의 세 갈래. **어느 채널을 쓰는지와 누가 소리를 내는지가 함께 정해진다** —
     * 그 둘이 어긋나면 두 겹으로 울리거나(둘 다 소리) 못 끈다(삭제 인텐트 없음).
     *
     * 갈래를 고르는 자리는 [initialVariant] 하나다. 호출부에서 조건을 다시 조립하지 말 것.
     */
    internal enum class Variant(
        /** 소리를 `RingingService` 의 MediaPlayer 가 내는가. 그러면 알림은 무음이고
         *  스와이프 제거에 **삭제 인텐트가 필요하다**(안 그러면 무기한 울린다). */
        val serviceOwnsSound: Boolean,
        /**
         * 전체화면 인텐트를 싣는가. 잠긴 기기에서 울림 화면을 여는 **유일한 공식 경로**다 —
         * 서비스의 `startActivity` 는 앱에 보이는 액티비티가 없으면 Android 14+ 가 막는다.
         */
        val launchesScreenViaSystem: Boolean,
    ) {
        /**
         * **기본 갈래.** HIGH·무음 채널 + 전체화면 인텐트. 잠겨 있으면 시스템이 울림 화면을
         * 전체화면으로 열고, 다른 앱을 쓰는 중이면 배너(끄기·다시 울림 액션 포함)로 뜬다.
         * 서비스는 살아서 소리를 낸다.
         */
        ALERTING(serviceOwnsSound = true, launchesScreenViaSystem = true),

        /**
         * 앱이 **이미 화면에 보여서** 우리가 울림 화면을 직접 띄울 수 있는 경우. LOW 채널,
         * 배너 없음, 전체화면 인텐트 없음 — 있으면 배너가 울림 화면 위에 겹친다.
         */
        QUIET(serviceOwnsSound = true, launchesScreenViaSystem = false),

        /** 포그라운드 서비스를 못 띄웠다. HIGH·소리 채널이 직접 울린다 + 전체화면 인텐트. */
        FALLBACK(serviceOwnsSound = false, launchesScreenViaSystem = true),
    }

    companion object {
        /**
         * 울림을 시작할 때 어느 갈래로 알림을 올릴지 — **앱에 보이는 액티비티가 있는가** 하나로
         * 가른다. 그것이 Android 14+ 백그라운드 액티비티 시작(BAL) 허용 조건과 같다:
         * 보이는 액티비티가 있으면 `startActivity` 가 통과하니 조용한 알림으로 충분하고,
         * 없으면(잠금 화면·다른 앱·홈) 시스템만 화면을 열 수 있으니 전체화면 인텐트를 실어야 한다.
         *
         * ⚠ **"일단 직접 띄워 보고 안 뜨면 승격" 으로 되돌리지 말 것**(2026-09-22 실기기).
         *   같은 알림 id 를 갱신하는 승격은 전체화면을 **한 번도 열지 못했다** — SystemUI 는
         *   새로 추가된 알림에만 전체화면 인텐트를 검사한다(`onEntryAdded`, 갱신은 배너 재판정만).
         *   그 사이 잠금 화면에서는 소리만 나고 해제 UI 가 없었다.
         */
        fun initialVariant(appHasVisibleActivity: Boolean): Variant =
            if (appHasVisibleActivity) Variant.QUIET else Variant.ALERTING

        /**
         * 울림 화면을 여는 인텐트 플래그. `singleTask` 액티비티라 이미 떠 있으면 `onNewIntent`
         * 로 들어간다.
         *
         * ⚠ **`FLAG_ACTIVITY_CLEAR_TASK` 를 다시 넣지 말 것.** 시스템(전체화면 인텐트)과 우리
         *   (`startActivity`)가 같은 화면을 연달아 열 때 CLEAR_TASK 는 먼저 뜬 인스턴스를
         *   **파괴**하고, 그 `onStop` 이 '화면을 벗어났다' 로 읽혀 알람이 2초 만에 스스로 꺼졌다
         *   (2026-09-09 SM-A325N). 그때는 전체화면 인텐트를 떼는 것으로 피했지만, 그 대가가
         *   위의 잠금 화면 미표시였다. 근본 원인은 CLEAR_TASK 다.
         */
        const val RINGING_ACTIVITY_FLAGS: Int =
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION

        private const val RINGING_ACTIVITY_REQUEST_CODE = 2001
        private const val DISMISS_REQUEST_CODE = 2002
        private const val SNOOZE_REQUEST_CODE = 2003
        private const val DELETE_REQUEST_CODE = 2004
    }

    /**
     * @param variant 어느 갈래인지 — 채널·전체화면 인텐트·소리 주체가 함께 정해진다([Variant]).
     *   세 갈래 모두 카테고리(CATEGORY_ALARM)·해제/스누즈 액션은 같다.
     */
    fun build(
        alarmId: String,
        variant: Variant,
    ): Notification {
        val activityIntent = Intent(context, RingingActivity::class.java).apply {
            putExtra(EXTRA_ALARM_ID, alarmId)
            flags = RINGING_ACTIVITY_FLAGS
        }
        val activityPendingIntent = PendingIntent.getActivity(
            context,
            RINGING_ACTIVITY_REQUEST_CODE,
            activityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val channelId = when (variant) {
            Variant.ALERTING -> NotificationChannels.RINGING_CHANNEL_ID
            Variant.QUIET -> NotificationChannels.RINGING_QUIET_CHANNEL_ID
            Variant.FALLBACK -> NotificationChannels.RINGING_FALLBACK_CHANNEL_ID
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
            .setContentIntent(activityPendingIntent)
            .addAction(
                R.drawable.ic_alarm_24,
                context.getString(R.string.r3misc_ringing_action_dismiss),
                servicePendingIntent(ACTION_DISMISS, alarmId, DISMISS_REQUEST_CODE),
            )
        // ⚠ **조건 없이 붙인다**(2026-09-09). 다시 울림은 언제나 가능하다 — 편집기에서
        //   그 설정을 없앴고, 저장된 `snoozeEnabled` 도 읽지 않는다. 여기에 조건을 다시
        //   만들면 울림 화면과 어긋나 '눌렀는데 알람이 꺼지는' 상태가 돌아온다.
        builder.addAction(
            R.drawable.ic_alarm_24,
            context.getString(R.string.r3misc_ringing_action_snooze),
            servicePendingIntent(ACTION_SNOOZE, alarmId, SNOOZE_REQUEST_CODE),
        )

        if (variant.launchesScreenViaSystem) {
            // 잠긴 기기에서 울림 화면을 여는 유일한 공식 경로. 잠금 해제 상태(다른 앱 사용 중)
            // 에서는 시스템이 전체화면 대신 배너로 보여 주고, 탭하면 같은 인텐트로 화면이 열린다.
            // ⚠ 같은 화면을 우리가 `startActivity` 로도 열 수 있는데, 그 둘이 겹쳐도 안전한
            //   이유는 [RINGING_ACTIVITY_FLAGS] 에 CLEAR_TASK 가 없어서다 — 두 번째 열기는
            //   `onNewIntent` 로 들어가고 먼저 뜬 인스턴스를 파괴하지 않는다.
            builder.setFullScreenIntent(activityPendingIntent, true)
        }

        if (variant.serviceOwnsSound) {
            // 정상 경로: 소리는 RingingService 의 MediaPlayer 가 담당 → 알림은 무음(중복 소리 방지).
            builder.setSound(null).setVibrate(null)
            // ⚠ ALERTING 은 갱신에서도 다시 알려야 한다. QUIET 로 시작했다가(앱이 보였다)
            //   울림 화면이 끝내 안 떠서 ALERTING 으로 올리는 경우, 이미 있는 알림 id 의
            //   **갱신**이라 ONLY_ALERT_ONCE 가 있으면 배너조차 안 뜬다.
            //   QUIET 는 LOW 라 배너가 없으니 값이 무엇이든 같다 — 재게시 소음만 막는다.
            //   ⚠ **폴백에는 걸지 않는다** — 그 경로는 알림 **채널이 소리를 내는 것**이
            //   존재 이유고(FGS 를 못 띄워 MediaPlayer 가 없다), 같은 id(1001)를 갱신하는
            //   순간이 오면 ONLY_ALERT_ONCE 가 그 소리를 **삼킨다.**
            builder.setOnlyAlertOnce(!variant.launchesScreenViaSystem)
            // 울림 화면을 우리가 직접 못 띄우는 상태(잠금·다른 앱)에서는 이 알림이 남는
            // 유일한 해제 UI 다. 그리고 스와이프 제거를 막을 수 있는지는 **기기 OS 가
            // 정한다** — 13 은 `setOngoing(true)` 로 막히고, 14+ 는 막지 못한다(스펙 §2 표 참조).
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

}
