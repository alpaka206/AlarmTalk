package com.alarmtalk.app.data

import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.RemoteAlarmMapper
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.AlarmTalkApiClient
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import retrofit2.HttpException

data class AlarmSyncResult(
    val total: Int,
    val created: Int,
    val updated: Int,
    val failed: Int,
)

/** 아직 서버에 반영되지 않은 상태들 — 이 상태의 행만 올릴 거리가 있다. */
private val OUTBOUND_SYNC_STATES = setOf(
    AlarmSyncStates.LOCAL_ONLY,
    AlarmSyncStates.DIRTY,
    AlarmSyncStates.FAILED,
)

/**
 * 이 세션의 토큰으로 올려도 되는 행인가. 판정 규칙만 떼어 내 API 없이 검증한다.
 * 인자 의미는 [AlarmSyncService.syncWithBackend] 참고.
 */
internal fun isOutboundSyncCandidate(
    alarm: AlarmEntity,
    ownerUserId: String?,
    adoptOwnerlessAlarms: Boolean,
): Boolean =
    alarm.origin == AlarmOrigins.LOCAL_OWNED &&
        alarm.syncState in OUTBOUND_SYNC_STATES &&
        when (alarm.ownerUserId) {
            // 소유자 미기록(레거시 null)은 임자 확정에 성공한 회차에만 내 것으로 본다.
            null -> adoptOwnerlessAlarms
            // 비로그인(ownerUserId == null)이면 이 가지에 걸리지 않아 남의 행은 그대로 제외된다.
            ownerUserId -> true
            else -> false
        }

internal class AlarmSyncService(
    private val alarmDao: AlarmDao,
) {
    /**
     * 아직 서버에 못 올린 '내 소유' 알람을 올린다.
     *
     * @param ownerUserId 이 세션의 계정. 로컬 알람은 로그아웃해도 Room 에 남으므로(원본이 기기다),
     *   앞 계정 A 가 오프라인에서 만들거나 고친 행이 LOCAL_ONLY/DIRTY 인 채로 남는다. 소유자를 안
     *   보면 다음 계정 B 가 알람 탭에 들어오는 순간 그 행이 **B 의 JWT** 로 올라가, B 계정에 A 의
     *   알람이 생기거나 404 재생성 폴백이 A 의 remoteAlarmId 를 갈아치운다(Codex #646 P1).
     *   다른 계정 소유 행은 DIRTY 인 채로 남겨 둔다 — 주인이 다시 로그인하면 그때 올라간다.
     * @param adoptOwnerlessAlarms 소유자 미기록(레거시 null) 행을 이 세션 것으로 봐도 되는가.
     *   AlarmRepository.settlePendingAlarmOwnership 이 성공한 회차에만 true 다.
     */
    suspend fun syncWithBackend(
        api: AlarmTalkApi,
        token: String,
        ownerUserId: String?,
        adoptOwnerlessAlarms: Boolean,
    ): AlarmSyncResult {
        val authorization = AlarmTalkApiClient.bearer(token)
        val localAlarms = alarmDao.getAllAlarms()
            .filter { alarm -> isOutboundSyncCandidate(alarm, ownerUserId, adoptOwnerlessAlarms) }
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
                        // 동시 편집 방어(lost update): createAlarm 네트워크 왕복 중 사용자가 같은 알람을
                        // 편집하면 updatedAtMillis 가 바뀌고 syncState 가 DIRTY 로 돌아간다. 스냅샷 시점
                        // updatedAtMillis 와 일치할 때만 SYNCED 로 전환하고, 불일치(rowcount==0)면 편집을
                        // SYNCED 로 덮지 않는다.
                        val applied = alarmDao.setSyncStateIfUnchanged(
                            id = alarm.id,
                            remoteAlarmId = remoteAlarm.id,
                            lastSyncedAtMillis = now,
                            syncState = AlarmSyncStates.SYNCED,
                            newUpdatedAtMillis = now,
                            expectedUpdatedAtMillis = alarm.updatedAtMillis,
                        )
                        if (applied == 0) {
                            // 동시 편집 발생: remoteAlarmId 는 반드시 커밋(다음 sync 가 중복 create 대신
                            // update 로 재전송)하되 syncState 는 DIRTY, updatedAtMillis 는 건드리지 않아
                            // 사용자의 편집(페이로드/updatedAtMillis)을 보존한다.
                            alarmDao.markRemoteIdKeepDirty(
                                id = alarm.id,
                                remoteAlarmId = remoteAlarm.id,
                                lastSyncedAtMillis = now,
                            )
                            Log.i(TAG, "Concurrent edit during create; keeping DIRTY with remoteId id=${alarm.id}")
                        }
                    }
                } else {
                    // 서버에 원본이 없으면(404: dev DB 초기화·다른 경로 삭제) update 를 create 로
                    // 폴백해 이 기기의 알람을 되살린다. 그대로 두면 매 sync 마다 404 → FAILED 가
                    // 반복돼 사용자에게 영구 경고로 남는다.
                    val (remoteAlarm, recreated) = try {
                        api.updateAlarm(authorization, alarm.remoteAlarmId, request).alarm to false
                    } catch (error: HttpException) {
                        if (error.code() != 404) throw error
                        Log.i(TAG, "Remote alarm missing; re-creating id=${alarm.id}")
                        api.createAlarm(authorization, request).alarm to true
                    }
                    if (recreated) created += 1 else updated += 1
                    // 동시 편집 방어(lost update): 네트워크 구간에 사용자가 같은 알람을 편집하면
                    // updatedAtMillis 가 바뀌고 syncState 가 다시 DIRTY 가 된다. 스냅샷 시점
                    // updatedAtMillis 와 일치할 때만 SYNCED 로 전환하고, 불일치(rowcount==0)면 그 편집을
                    // 덮어쓰지 않고 DIRTY 를 그대로 보존해 다음 sync 에서 재전송되게 한다.
                    // 재생성(recreated)이면 새 remoteAlarmId 커밋이 유실되지 않게 NonCancellable 로 감싼다
                    // (유실 시 다음 sync 가 옛 id 로 update → 404 → 또 create 돼 서버에 중복이 쌓인다).
                    withContext(NonCancellable) {
                        val applied = alarmDao.setSyncStateIfUnchanged(
                            id = alarm.id,
                            remoteAlarmId = remoteAlarm.id,
                            lastSyncedAtMillis = now,
                            syncState = AlarmSyncStates.SYNCED,
                            newUpdatedAtMillis = now,
                            expectedUpdatedAtMillis = alarm.updatedAtMillis,
                        )
                        if (applied == 0) {
                            if (recreated) {
                                alarmDao.markRemoteIdKeepDirty(
                                    id = alarm.id,
                                    remoteAlarmId = remoteAlarm.id,
                                    lastSyncedAtMillis = now,
                                )
                            }
                            Log.i(TAG, "Concurrent edit during sync; keeping DIRTY id=${alarm.id}")
                        }
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
                AlarmTalkLog.reportError("Failed to sync alarm id=${alarm.id}", error)
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
