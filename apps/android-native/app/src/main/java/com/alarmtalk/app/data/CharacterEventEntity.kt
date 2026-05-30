package com.alarmtalk.app.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "character_events",
    indices = [Index(value = ["clientNonce"], unique = true)],
)
data class CharacterEventEntity(
    @PrimaryKey val id: String,
    val event: String,
    val clientNonce: String,
    val localDate: String,
    val sourceAlarmId: String?,
    val state: String,
    val createdAtMillis: Long,
    val syncedAtMillis: Long?,
    val lastError: String?,
)

object CharacterEventTypes {
    const val ALARM_COMPLETED = "alarm_completed"
    const val ALARM_SNOOZED = "alarm_snoozed"
}

object CharacterEventStates {
    const val PENDING = "pending"
    const val SYNCED = "synced"
    const val FAILED = "failed"
}
