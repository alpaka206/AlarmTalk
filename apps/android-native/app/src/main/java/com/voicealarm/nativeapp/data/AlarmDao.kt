package com.voicealarm.nativeapp.data

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface AlarmDao {
    @Query("SELECT * FROM alarms ORDER BY fireAtMillis DESC")
    fun observeAlarms(): Flow<List<AlarmEntity>>

    @Query("SELECT * FROM alarms WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): AlarmEntity?

    @Query(
        """
        SELECT * FROM alarms
        WHERE enabled = 1 AND fireAtMillis > :nowMillis
        ORDER BY fireAtMillis ASC
        """,
    )
    suspend fun getPendingAlarms(nowMillis: Long): List<AlarmEntity>

    @Upsert
    suspend fun upsert(alarm: AlarmEntity)

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
}
