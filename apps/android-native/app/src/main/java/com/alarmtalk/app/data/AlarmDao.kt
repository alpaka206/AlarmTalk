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
}
