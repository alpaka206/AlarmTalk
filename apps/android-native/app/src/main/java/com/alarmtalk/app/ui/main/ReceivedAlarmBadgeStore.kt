package com.alarmtalk.app

import android.content.Context
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins

internal class ReceivedAlarmBadgeStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun hasBaseline(userId: String): Boolean =
        prefs.contains(key(userId))

    fun readSeenAtMillis(userId: String): Long =
        prefs.getLong(key(userId), 0L)

    fun markSeen(userId: String, alarms: List<AlarmEntity>): Long {
        val seenAtMillis = alarms
            .asSequence()
            .filter { it.origin == AlarmOrigins.RECEIVED_REMOTE }
            .map { it.createdAtMillis }
            .maxOrNull()
            ?: 0L
        prefs.edit().putLong(key(userId), seenAtMillis).apply()
        return seenAtMillis
    }

    private fun key(userId: String): String =
        "received_alarm_seen_at_${userId.ifBlank { "unknown" }}"

    private companion object {
        const val PREFS_NAME = "voice_alarm_received_alarm_badges"
    }
}
