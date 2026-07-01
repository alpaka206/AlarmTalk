package com.alarmtalk.app.data

import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.RemoteAlarmMapper
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.AlarmTalkApiClient
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

data class AlarmSyncResult(
    val total: Int,
    val created: Int,
    val updated: Int,
    val failed: Int,
)

internal class AlarmSyncService(
    private val alarmDao: AlarmDao,
) {
    suspend fun syncWithBackend(api: AlarmTalkApi, token: String): AlarmSyncResult {
        val authorization = AlarmTalkApiClient.bearer(token)
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
                if (alarm.remoteAlarmId == null) {
                    // 신규 생성: 서버가 발급한 remoteAlarmId 를 반드시 로컬에 커밋해야 다음 sync 에서
                    // 중복 생성되지 않는다. 응답 수신 후 커밋 구간이 코루틴 취소로 유실되면 remoteAlarmId
                    // 가 null 로 남아 재-create 되므로 NonCancellable 로 감싸 원자적으로 저장한다.
                    val remoteAlarm = api.createAlarm(authorization, request).alarm
                    created += 1
                    withContext(NonCancellable) {
                        alarmDao.setSyncState(
                            id = alarm.id,
                            remoteAlarmId = remoteAlarm.id,
                            lastSyncedAtMillis = now,
                            syncState = AlarmSyncStates.SYNCED,
                            updatedAtMillis = now,
                        )
                    }
                } else {
                    val remoteAlarm = api.updateAlarm(authorization, alarm.remoteAlarmId, request).alarm
                    updated += 1
                    // 동시 편집 방어(lost update): 네트워크 구간에 사용자가 같은 알람을 편집하면
                    // updatedAtMillis 가 바뀌고 syncState 가 다시 DIRTY 가 된다. 스냅샷 시점
                    // updatedAtMillis 와 일치할 때만 SYNCED 로 전환하고, 불일치(rowcount==0)면 그 편집을
                    // 덮어쓰지 않고 DIRTY 를 그대로 보존해 다음 sync 에서 재전송되게 한다.
                    val applied = alarmDao.setSyncStateIfUnchanged(
                        id = alarm.id,
                        remoteAlarmId = remoteAlarm.id,
                        lastSyncedAtMillis = now,
                        syncState = AlarmSyncStates.SYNCED,
                        newUpdatedAtMillis = now,
                        expectedUpdatedAtMillis = alarm.updatedAtMillis,
                    )
                    if (applied == 0) {
                        Log.i(TAG, "Concurrent edit during sync; keeping DIRTY id=${alarm.id}")
                    }
                }
                if (alarm.localAudioUri != null && alarm.rawAudioUri?.startsWith("http", ignoreCase = true) != true) {
                    Log.i(TAG, "Synced alarm metadata only; local voice audio remains on-device id=${alarm.id}")
                }
            }.onFailure { error ->
                // 코루틴 취소는 삼키지 말고 다시 던져야 한다. runCatching 이 CancellationException 까지
                // 삼키면 create 응답 유실 시 FAILED(remoteAlarmId=null) 로 오마킹돼 재-create → 중복이 된다.
                if (error is CancellationException) throw error
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
