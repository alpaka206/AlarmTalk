package com.alarmtalk.app.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface CharacterEventDao {
    @Query("SELECT * FROM character_events ORDER BY createdAtMillis DESC")
    fun observeEvents(): Flow<List<CharacterEventEntity>>

    @Query(
        """
        SELECT * FROM character_events
        WHERE state IN (:states)
        ORDER BY createdAtMillis ASC
        """,
    )
    suspend fun getEventsByState(states: List<String>): List<CharacterEventEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(event: CharacterEventEntity): Long

    @Query(
        """
        UPDATE character_events
        SET state = :state,
            syncedAtMillis = :syncedAtMillis,
            lastError = :lastError
        WHERE id = :id
        """,
    )
    suspend fun setSyncState(
        id: String,
        state: String,
        syncedAtMillis: Long?,
        lastError: String?,
    )
}
