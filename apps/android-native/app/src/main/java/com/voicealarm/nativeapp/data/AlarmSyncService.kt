package com.voicealarm.nativeapp.data

import android.util.Log
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.network.RemoteAlarmMapper
import com.voicealarm.nativeapp.network.VoiceAlarmApi
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient

data class AlarmSyncResult(
    val total: Int,
    val created: Int,
    val updated: Int,
    val failed: Int,
)

internal class AlarmSyncService(
    private val alarmDao: AlarmDao,
) {
    suspend fun syncWithBackend(api: VoiceAlarmApi, token: String): AlarmSyncResult {
        val authorization = VoiceAlarmApiClient.bearer(token)
        val localAlarms = alarmDao.getAllAlarms()
            .filter { alarm ->
                alarm.origin == AlarmOrigins.LOCAL_OWNED &&
                    alarm.syncState in setOf(
                        AlarmSyncStates.LOCAL_ONLY,
                        AlarmSyncStates.DIRTY,
                        AlarmSyncStates.FAILED,
                    )
            }
        var created = 0
        var updated = 0
        var failed = 0

        localAlarms.forEach { alarm ->
            val now = System.currentTimeMillis()
            runCatching {
                val request = RemoteAlarmMapper.toWriteRequest(alarm)
                val remoteAlarm = if (alarm.remoteAlarmId == null) {
                    api.createAlarm(authorization, request).alarm.also {
                        created += 1
                    }
                } else {
                    api.updateAlarm(authorization, alarm.remoteAlarmId, request).alarm.also {
                        updated += 1
                    }
                }
                alarmDao.setSyncState(
                    id = alarm.id,
                    remoteAlarmId = remoteAlarm.id,
                    lastSyncedAtMillis = now,
                    syncState = AlarmSyncStates.SYNCED,
                    updatedAtMillis = now,
                )
                if (alarm.localAudioUri != null && alarm.rawAudioUri?.startsWith("http", ignoreCase = true) != true) {
                    Log.i(TAG, "Synced alarm metadata only; local voice audio remains on-device id=${alarm.id}")
                }
            }.onFailure { error ->
                failed += 1
                Log.e(TAG, "Failed to sync alarm id=${alarm.id}", error)
                alarmDao.setSyncState(
                    id = alarm.id,
                    remoteAlarmId = alarm.remoteAlarmId,
                    lastSyncedAtMillis = alarm.lastSyncedAtMillis,
                    syncState = AlarmSyncStates.FAILED,
                    updatedAtMillis = now,
                )
            }
        }

        Log.i(TAG, "Backend alarm sync complete total=${localAlarms.size} created=$created updated=$updated failed=$failed")
        return AlarmSyncResult(
            total = localAlarms.size,
            created = created,
            updated = updated,
            failed = failed,
        )
    }
}
