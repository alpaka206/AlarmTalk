package com.alarmtalk.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DEBUG_RESTORE_ALARMS
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
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
        val pendingResult = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching {
                AlarmAppContainer.repository(context).reschedulePendingAlarms()
            }.onFailure { error ->
                Log.e(TAG, "Failed to restore alarms after $action", error)
            }
            pendingResult.finish()
        }
    }
}
