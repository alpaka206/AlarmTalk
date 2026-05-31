package com.alarmtalk.app.data

import android.util.Log
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import java.util.UUID

internal class CharacterEventRepository(
    private val characterEventDao: CharacterEventDao,
) {
    suspend fun queue(
        event: String,
        sourceAlarmId: String?,
        nowMillis: Long = System.currentTimeMillis(),
    ) {
        val localDate = java.time.Instant.ofEpochMilli(nowMillis)
            .atZone(java.time.ZoneId.systemDefault())
            .toLocalDate()
            .toString()
        val nonce = listOfNotNull(event, sourceAlarmId, localDate).joinToString(":")
        val inserted = characterEventDao.insertIgnore(
            CharacterEventEntity(
                id = UUID.randomUUID().toString(),
                event = event,
                clientNonce = nonce,
                localDate = localDate,
                sourceAlarmId = sourceAlarmId,
                state = CharacterEventStates.PENDING,
                createdAtMillis = nowMillis,
                syncedAtMillis = null,
                lastError = null,
            ),
        )
        if (inserted == -1L) {
            Log.i(TAG, "Character event already queued nonce=$nonce")
        } else {
            Log.i(TAG, "Queued character event event=$event nonce=$nonce")
        }
    }
}
