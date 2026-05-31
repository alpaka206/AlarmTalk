package com.alarmtalk.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DEBUG_RESTORE_ALARMS
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
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
        val isRestoreAction = action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
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
