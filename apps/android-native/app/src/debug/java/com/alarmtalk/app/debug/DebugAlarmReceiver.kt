package com.alarmtalk.app.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DISMISS
import com.alarmtalk.app.alarm.AlarmContract.EXTRA_ALARM_ID
import com.alarmtalk.app.alarm.RingingService
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class DebugAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_DEBUG_DISMISS_LAST_ALARM) {
            dismissLastAlarm(context)
            return
        }

        if (intent.action != ACTION_DEBUG_CREATE_TEST_ALARM) return

        val pendingResult = goAsync()
        val delayMinutes = intent.getIntExtra(EXTRA_DELAY_MINUTES, 1).coerceIn(1, 5)
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching {
                val alarm = AlarmAppContainer.repository(context.applicationContext)
                    .createTestAlarm(delayMinutes)
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_LAST_ALARM_ID, alarm.id)
                    .apply()
                Log.i(TAG, "Debug test alarm created id=${alarm.id} delayMinutes=$delayMinutes")
            }.onFailure { error ->
                Log.e(TAG, "Failed to create debug test alarm", error)
            }
            pendingResult.finish()
        }
    }

    private fun dismissLastAlarm(context: Context) {
        val alarmId = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LAST_ALARM_ID, null)
        if (alarmId.isNullOrBlank()) {
            Log.w(TAG, "Debug dismiss requested without a stored alarm id")
            return
        }

        context.startService(
            Intent(context, RingingService::class.java).apply {
                action = ACTION_DISMISS
                putExtra(EXTRA_ALARM_ID, alarmId)
            },
        )
        Log.i(TAG, "Debug dismiss requested id=$alarmId")
    }

    companion object {
        private const val ACTION_DEBUG_CREATE_TEST_ALARM =
            "com.alarmtalk.app.action.DEBUG_CREATE_TEST_ALARM"
        private const val ACTION_DEBUG_DISMISS_LAST_ALARM =
            "com.alarmtalk.app.action.DEBUG_DISMISS_LAST_ALARM"
        private const val EXTRA_DELAY_MINUTES = "delay_minutes"
        private const val PREFS = "debug_alarm"
        private const val KEY_LAST_ALARM_ID = "last_alarm_id"
    }
}
