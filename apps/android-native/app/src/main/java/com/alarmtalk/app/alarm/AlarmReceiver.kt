package com.alarmtalk.app.alarm

import android.app.ForegroundServiceStartNotAllowedException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.alarmtalk.app.alarm.AlarmContract.ACTION_ALARM_TRIGGER
import com.alarmtalk.app.alarm.AlarmContract.EXTRA_ALARM_ID
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_ALARM_TRIGGER) return

        val alarmId = intent.getStringExtra(EXTRA_ALARM_ID)
        if (alarmId.isNullOrBlank()) {
            Log.w(TAG, "AlarmReceiver invoked without alarm id")
            return
        }

        Log.i(TAG, "Alarm received id=$alarmId")
        // 서비스가 뜨기 전까지의 인계 구간을 표시한다 — 그 사이 예약 정합성 워커가 이 알람을
        // '안 울리는 중' 으로 보고 지난 시각을 다시 등록해 한 번 더 울리는 것을 막는다.
        RingingService.markAlarmHandoff(alarmId)
        startRingingOrFallback(context, alarmId)

        val pendingResult = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching {
                AlarmAppContainer.repository(context).markRinging(alarmId)
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to mark alarm ringing id=$alarmId", error)
            }
            pendingResult.finish()
        }
    }

    /**
     * 비정확 폴백(앱 백그라운드) 등으로 알람이 울릴 때, FGS(포그라운드 서비스) 시작이
     * Android 12(API 31)+ 에서 ForegroundServiceStartNotAllowedException 으로 막힐 수 있다.
     * 이 경우 서비스 대신 전체 화면 인텐트를 가진 울림 알림을 직접 게시해, 잠금 화면 위로
     * 울림 화면이 뜨도록 폴백한다(알림 자체가 setFullScreenIntent 를 들고 있음).
     */
    private fun startRingingOrFallback(context: Context, alarmId: String) {
        try {
            RingingService.start(context, alarmId)
        } catch (error: Exception) {
            val isFgsBlocked = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                error is ForegroundServiceStartNotAllowedException
            if (!isFgsBlocked) throw error
            Log.w(TAG, "FGS start blocked; falling back to full-screen ringing notification id=$alarmId", error)
            postRingingNotificationFallback(context, alarmId)
        }
    }

    private fun postRingingNotificationFallback(context: Context, alarmId: String) {
        runCatching {
            NotificationChannels.ensure(context)
            // 폴백 전용 채널(IMPORTANCE_HIGH, 알람음+진동)로 게시해, 기기가 잠금 해제(사용 중)라
            // 전체화면 인텐트가 헤즈업으로만 떠도 소리·진동이 나도록 한다. 정상 FGS 경로는 무음 채널 유지.
            val notification = RingingNotificationFactory(context).build(alarmId, fallback = true)
            NotificationManagerCompat.from(context).notify(RINGING_FALLBACK_NOTIFICATION_ID, notification)
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to post ringing notification fallback id=$alarmId", error)
        }
    }

    private companion object {
        // RingingService 의 RINGING_NOTIFICATION_ID(1001)와 동일한 슬롯을 재사용해
        // 이후 서비스가 살아나면 같은 알림을 갱신/취소할 수 있게 한다.
        const val RINGING_FALLBACK_NOTIFICATION_ID = 1001
    }
}
