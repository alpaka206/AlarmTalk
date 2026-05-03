package com.voicealarm.nativeapp.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.voicealarm.nativeapp.alarm.AlarmContract.ACTION_ALARM_TRIGGER
import com.voicealarm.nativeapp.alarm.AlarmContract.EXTRA_ALARM_ID
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
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
        RingingService.start(context, alarmId)

        val pendingResult = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching {
                AlarmAppContainer.repository(context).markRinging(alarmId)
            }.onFailure { error ->
                Log.e(TAG, "Failed to mark alarm ringing id=$alarmId", error)
            }
            pendingResult.finish()
        }
    }
}
