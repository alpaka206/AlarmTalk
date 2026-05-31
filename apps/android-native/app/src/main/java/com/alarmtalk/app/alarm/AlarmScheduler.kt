package com.alarmtalk.app.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.getSystemService
import com.alarmtalk.app.MainActivity
import com.alarmtalk.app.alarm.AlarmContract.ACTION_ALARM_TRIGGER
import com.alarmtalk.app.alarm.AlarmContract.EXTRA_ALARM_ID
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.data.AlarmEntity

class AlarmScheduler(
    private val context: Context,
) {
    private val alarmManager: AlarmManager =
        requireNotNull(context.getSystemService<AlarmManager>()) { "AlarmManager is not available." }

    fun canScheduleExactAlarms(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()

    fun schedule(alarm: AlarmEntity) {
        if (!canScheduleExactAlarms()) {
            throw IllegalStateException("Exact alarm permission is not granted.")
        }

        val pendingIntent = requireNotNull(pendingIntentFor(alarm.id, PendingIntent.FLAG_UPDATE_CURRENT)) {
            "Unable to create alarm PendingIntent."
        }
        alarmManager.setAlarmClock(
            AlarmManager.AlarmClockInfo(alarm.fireAtMillis, showAlarmIntentFor(alarm.id)),
            pendingIntent,
        )

        Log.i(TAG, "Scheduled alarm clock id=${alarm.id} fireAt=${alarm.fireAtMillis}")
    }

    fun cancel(alarmId: String) {
        val pendingIntent = pendingIntentFor(alarmId, PendingIntent.FLAG_NO_CREATE) ?: return
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
        Log.i(TAG, "Cancelled alarm clock id=$alarmId")
    }

    private fun pendingIntentFor(alarmId: String, flags: Int): PendingIntent? {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = ACTION_ALARM_TRIGGER
            putExtra(EXTRA_ALARM_ID, alarmId)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCodeFor(alarmId),
            intent,
            flags or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun showAlarmIntentFor(alarmId: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            putExtra(EXTRA_ALARM_ID, alarmId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            context,
            requestCodeFor("show:$alarmId"),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun requestCodeFor(alarmId: String): Int = alarmId.hashCode() and Int.MAX_VALUE
}
