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
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmEntity

class AlarmScheduler(
    private val context: Context,
) {
    private val alarmManager: AlarmManager =
        requireNotNull(context.getSystemService<AlarmManager>()) { "AlarmManager is not available." }

    fun canScheduleExactAlarms(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()

    /**
     * 알람을 등록한다.
     * 정확 알람 권한이 없어도 throw 하지 않고 setAndAllowWhileIdle 폴백으로 항상 등록한다.
     * (권한 안내 UX 는 호출부의 PermissionGate 가 담당하고, 알람 자체는 누락되지 않게 한다.)
     *
     * @return true 면 정확 알람(setAlarmClock)으로, false 면 비정확 폴백으로 등록됨.
     */
    fun schedule(alarm: AlarmEntity): Boolean {
        val pendingIntent = requireNotNull(pendingIntentFor(alarm.id, PendingIntent.FLAG_UPDATE_CURRENT)) {
            "Unable to create alarm PendingIntent."
        }
        return if (canScheduleExactAlarms()) {
            alarmManager.setAlarmClock(
                AlarmManager.AlarmClockInfo(alarm.fireAtMillis, showAlarmIntentFor(alarm.id)),
                pendingIntent,
            )
            Log.i(TAG, "Scheduled alarm clock id=${alarm.id} fireAt=${alarm.fireAtMillis}")
            true
        } else {
            // 정확 알람 권한이 없으면 Doze 에서도 동작하는 비정확 알람으로 폴백.
            // 수 분 늦게 울릴 수 있지만 알람이 아예 등록되지 않는 것보다 낫다.
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                alarm.fireAtMillis,
                pendingIntent,
            )
            Log.w(
                TAG,
                "Scheduled inexact fallback alarm id=${alarm.id} fireAt=${alarm.fireAtMillis} (exact alarm permission not granted)",
            )
            false
        }
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
