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

    /**
     * 지금 있는 받은 알람까지 **다 봤다**고 기록한다.
     *
     * ⚠ **수위선은 뒤로 가지 않는다**(2026-08-27). 예전에는 지금 목록의 최댓값을 그대로
     * 썼는데, 사용자가 **가장 최근에 받은 알람을 지우면** 그 최댓값이 내려가 이미 본 옛
     * 알람들이 다시 '안 본 것' 으로 살아났다 — 배지가 1 이 아니라 **누적된 값**으로 뜬다.
     * 본 사실은 되돌릴 수 없으므로 저장된 값보다 작아지지 않게 한다.
     */
    fun markSeen(userId: String, alarms: List<AlarmEntity>): Long {
        val latest = alarms
            .asSequence()
            .filter { it.origin == AlarmOrigins.RECEIVED_REMOTE }
            .map { it.createdAtMillis }
            .maxOrNull()
            ?: 0L
        val seenAtMillis = maxOf(latest, readSeenAtMillis(userId))
        prefs.edit().putLong(key(userId), seenAtMillis).apply()
        return seenAtMillis
    }

    private fun key(userId: String): String =
        "received_alarm_seen_at_${userId.ifBlank { "unknown" }}"

    private companion object {
        const val PREFS_NAME = "voice_alarm_received_alarm_badges"
    }
}
