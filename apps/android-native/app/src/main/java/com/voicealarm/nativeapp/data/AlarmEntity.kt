package com.voicealarm.nativeapp.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "alarms")
data class AlarmEntity(
    @PrimaryKey val id: String,
    val label: String,
    val fireAtMillis: Long,
    val snoozeMinutes: Int,
    val enabled: Boolean,
    val state: String,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
)

object AlarmStates {
    const val SCHEDULED = "scheduled"
    const val RINGING = "ringing"
    const val SNOOZED = "snoozed"
    const val DISMISSED = "dismissed"
    const val FAILED = "failed"
}
