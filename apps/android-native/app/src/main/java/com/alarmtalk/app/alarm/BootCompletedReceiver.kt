package com.alarmtalk.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DEBUG_RESTORE_ALARMS
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.sync.AlarmScheduleIntegrityScheduler
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val isDebuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        // 부팅/업데이트뿐 아니라 시간대(여행)·시스템 시각/DST 변경 시에도 알람을 재예약한다.
        // 그렇지 않으면 시간대 변경 후 알람이 잘못된 벽시계 시각에 울린다.
        val isRestoreAction = action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == Intent.ACTION_TIMEZONE_CHANGED ||
            action == Intent.ACTION_TIME_CHANGED ||
            (isDebuggable && action == ACTION_DEBUG_RESTORE_ALARMS)
        if (!isRestoreAction) return

        Log.i(TAG, "Restore receiver invoked action=$action")
        RemoteAlarmSyncScheduler.ensurePeriodic(context)
        RemoteAlarmSyncScheduler.runOnce(context)
        // 재예약 안전망을 **먼저** 건다. 아래 goAsync() 창은 약 10초뿐이라 알람이 많거나 디스크가
        // 느리면 재예약이 중간에 잘리는데, 잘려도 아무도 모른다 — 사용자에겐 "업데이트하고 나니
        // 알람이 안 울린다" 로만 보인다. 워커가 같은 일을 멱등으로 다시 하므로 잘린 자리를 잇는다.
        // 주기 등록도 여기서 해 둔다(브로드캐스트가 아예 안 오는 기기에서는 앱 시작이 유일한 기회).
        AlarmScheduleIntegrityScheduler.ensurePeriodic(context)
        AlarmScheduleIntegrityScheduler.runOnce(context)
        val pendingResult = goAsync()
        // 시간대/시스템 시각 변경이면 저장된 절대 발화시각을 벽시계(hour/minute) 기준으로 재계산한다.
        val recomputeFireTime = action == Intent.ACTION_TIMEZONE_CHANGED ||
            action == Intent.ACTION_TIME_CHANGED
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching {
                AlarmAppContainer.repository(context).reschedulePendingAlarms(
                    recomputeFireTime = recomputeFireTime,
                )
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to restore alarms after $action", error)
            }
            pendingResult.finish()
        }
    }
}
