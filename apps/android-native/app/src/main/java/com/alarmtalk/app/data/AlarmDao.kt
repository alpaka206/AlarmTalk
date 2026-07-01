package com.alarmtalk.app.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface AlarmDao {
    @Query("SELECT * FROM alarms ORDER BY hour ASC, minute ASC, createdAtMillis ASC")
    fun observeAlarms(): Flow<List<AlarmEntity>>

    @Query("SELECT * FROM alarms WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): AlarmEntity?

    @Query("SELECT * FROM alarms WHERE remoteAlarmId = :remoteAlarmId LIMIT 1")
    suspend fun getByRemoteAlarmId(remoteAlarmId: String): AlarmEntity?

    @Query(
        """
        SELECT * FROM alarms
        WHERE enabled = 1
        ORDER BY fireAtMillis ASC
        """,
    )
    suspend fun getEnabledAlarms(): List<AlarmEntity>

    @Query("SELECT * FROM alarms ORDER BY hour ASC, minute ASC, createdAtMillis ASC")
    suspend fun getAllAlarms(): List<AlarmEntity>

    @Query(
        """
        SELECT * FROM alarms
        WHERE enabled = 1
          AND repeatDaysMask != 0
          AND voiceRandomPrompt = 1
          AND playMode != 'alarm_only'
          AND voiceProfileId IS NOT NULL
          AND bucketId IS NULL
        ORDER BY fireAtMillis ASC
        """,
    )
    suspend fun getRepeatingDynamicAlarmTalks(): List<AlarmEntity>

    @Query(
        """
        SELECT COUNT(*) FROM alarms
        WHERE hour = :hour
          AND minute = :minute
          AND (:excludeId IS NULL OR id != :excludeId)
        """,
    )
    suspend fun countAtTime(hour: Int, minute: Int, excludeId: String? = null): Int

    /** 같은 시각(HH:mm)의 기존 알람 1건. 중복 시각 교체 흐름에서 충돌 대상을 찾는 데 쓴다. */
    @Query(
        """
        SELECT * FROM alarms
        WHERE hour = :hour
          AND minute = :minute
          AND (:excludeId IS NULL OR id != :excludeId)
        LIMIT 1
        """,
    )
    suspend fun findAtTime(hour: Int, minute: Int, excludeId: String? = null): AlarmEntity?

    @Query("SELECT COUNT(*) FROM alarms WHERE audioCacheKey = :cacheKey")
    suspend fun countByAudioCacheKey(cacheKey: String): Int

    @Upsert
    suspend fun upsert(alarm: AlarmEntity)

    @Delete
    suspend fun delete(alarm: AlarmEntity)

    @Query(
        """
        UPDATE alarms
        SET state = :state, enabled = :enabled, updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun setState(
        id: String,
        state: String,
        enabled: Boolean,
        updatedAtMillis: Long,
    )

    @Query(
        """
        UPDATE alarms
        SET fireAtMillis = :fireAtMillis,
            state = :state,
            enabled = :enabled,
            updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun setScheduleState(
        id: String,
        fireAtMillis: Long,
        state: String,
        enabled: Boolean,
        updatedAtMillis: Long,
    )

    @Query(
        """
        UPDATE alarms
        SET remoteAlarmId = :remoteAlarmId,
            lastSyncedAtMillis = :lastSyncedAtMillis,
            syncState = :syncState,
            updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun setSyncState(
        id: String,
        remoteAlarmId: String?,
        lastSyncedAtMillis: Long?,
        syncState: String,
        updatedAtMillis: Long,
    )

    /**
     * 동시 편집 방어용 조건부 SYNCED 전환. 스냅샷 시점 updatedAtMillis(:expectedUpdatedAtMillis)와
     * 현재 행의 updatedAtMillis 가 일치할 때만 SYNCED 로 덮는다. 네트워크 sync 구간에 사용자가
     * 같은 알람을 편집해 updatedAtMillis 가 바뀌었으면 매칭되지 않아 반환값이 0 이 되고, 이때
     * 호출부가 DIRTY 를 보존해 다음 sync 에서 재전송하도록 한다. 반환값은 갱신된 행 수.
     */
    @Query(
        """
        UPDATE alarms
        SET remoteAlarmId = :remoteAlarmId,
            lastSyncedAtMillis = :lastSyncedAtMillis,
            syncState = :syncState,
            updatedAtMillis = :newUpdatedAtMillis
        WHERE id = :id AND updatedAtMillis = :expectedUpdatedAtMillis
        """,
    )
    suspend fun setSyncStateIfUnchanged(
        id: String,
        remoteAlarmId: String?,
        lastSyncedAtMillis: Long?,
        syncState: String,
        newUpdatedAtMillis: Long,
        expectedUpdatedAtMillis: Long,
    ): Int

    /**
     * 신규 생성 커밋 중 동시 편집이 감지됐을 때(create 응답 커밋과 사용자 편집 경합) 쓰는 폴백.
     * 서버가 발급한 remoteAlarmId 는 반드시 저장해 다음 sync 가 '중복 create' 가 아니라 update 로
     * 재전송하도록 하되, syncState 는 DIRTY 로 두고 updatedAtMillis 는 건드리지 않아 사용자의 편집
     * (updatedAtMillis/페이로드)이 SYNCED 로 덮여 유실되지 않게 보존한다.
     */
    @Query(
        """
        UPDATE alarms
        SET remoteAlarmId = :remoteAlarmId,
            lastSyncedAtMillis = :lastSyncedAtMillis,
            syncState = 'dirty'
        WHERE id = :id
        """,
    )
    suspend fun markRemoteIdKeepDirty(
        id: String,
        remoteAlarmId: String?,
        lastSyncedAtMillis: Long?,
    )

    @Query(
        """
        UPDATE alarms
        SET localAudioUri = :localAudioUri,
            audioCacheKey = :audioCacheKey,
            rawAudioUri = :rawAudioUri,
            voiceText = :voiceText,
            ttsMessageId = :ttsMessageId,
            dynamicVoicePreparedForFireAtMillis = :preparedForFireAtMillis,
            updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun updateDynamicVoiceAudio(
        id: String,
        localAudioUri: String,
        audioCacheKey: String?,
        rawAudioUri: String?,
        voiceText: String,
        ttsMessageId: String?,
        preparedForFireAtMillis: Long,
        updatedAtMillis: Long,
    )

    /** 무료 버킷 회전 인덱스를 다음 값으로 영속화한다(알람이 울린 직후 호출). */
    @Query(
        """
        UPDATE alarms
        SET bucketRotationIndex = :index, updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun updateBucketRotationIndex(id: String, index: Int, updatedAtMillis: Long)
}
