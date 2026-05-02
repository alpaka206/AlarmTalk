package com.voicealarm.nativeapp.data

import android.util.Log
import com.voicealarm.nativeapp.alarm.AlarmScheduler
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import java.util.UUID
import kotlinx.coroutines.flow.Flow

class AlarmRepository(
    private val alarmDao: AlarmDao,
    private val alarmScheduler: AlarmScheduler,
) {
    fun observeAlarms(): Flow<List<AlarmEntity>> = alarmDao.observeAlarms()

    suspend fun createTestAlarm(delayMinutes: Int): AlarmEntity {
        require(delayMinutes in 1..5) { "Test alarm delay must be between 1 and 5 minutes." }

        val now = System.currentTimeMillis()
        val alarm = AlarmEntity(
            id = UUID.randomUUID().toString(),
            label = "Test alarm",
            fireAtMillis = now + delayMinutes * 60_000L,
            snoozeMinutes = 5,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = now,
            updatedAtMillis = now,
        )

        alarmDao.upsert(alarm)
        alarmScheduler.schedule(alarm)
        Log.i(TAG, "Created test alarm id=${alarm.id} delayMinutes=$delayMinutes fireAt=${alarm.fireAtMillis}")
        return alarm
    }

    suspend fun markRinging(alarmId: String) {
        alarmDao.setState(
            id = alarmId,
            state = AlarmStates.RINGING,
            enabled = true,
            updatedAtMillis = System.currentTimeMillis(),
        )
        Log.i(TAG, "Alarm marked ringing id=$alarmId")
    }

    suspend fun dismiss(alarmId: String) {
        alarmScheduler.cancel(alarmId)
        alarmDao.setState(
            id = alarmId,
            state = AlarmStates.DISMISSED,
            enabled = false,
            updatedAtMillis = System.currentTimeMillis(),
        )
        Log.i(TAG, "Alarm dismissed id=$alarmId")
    }

    suspend fun snooze(alarmId: String): AlarmEntity? {
        val current = alarmDao.getById(alarmId)
        if (current == null) {
            Log.w(TAG, "Snooze requested for missing alarm id=$alarmId")
            return null
        }

        val now = System.currentTimeMillis()
        val next = current.copy(
            fireAtMillis = now + current.snoozeMinutes * 60_000L,
            enabled = true,
            state = AlarmStates.SNOOZED,
            updatedAtMillis = now,
        )
        alarmDao.upsert(next)
        alarmScheduler.schedule(next)
        Log.i(TAG, "Alarm snoozed id=$alarmId minutes=${current.snoozeMinutes} nextFireAt=${next.fireAtMillis}")
        return next
    }

    suspend fun reschedulePendingAlarms(): Int {
        val now = System.currentTimeMillis()
        val pending = alarmDao.getPendingAlarms(now)
        var scheduled = 0

        pending.forEach { alarm ->
            runCatching {
                alarmScheduler.schedule(alarm)
                scheduled += 1
            }.onFailure { error ->
                Log.e(TAG, "Failed to restore alarm id=${alarm.id}", error)
                alarmDao.setState(
                    id = alarm.id,
                    state = AlarmStates.FAILED,
                    enabled = true,
                    updatedAtMillis = System.currentTimeMillis(),
                )
            }
        }

        Log.i(TAG, "Boot restore complete pending=${pending.size} scheduled=$scheduled")
        return scheduled
    }
}
