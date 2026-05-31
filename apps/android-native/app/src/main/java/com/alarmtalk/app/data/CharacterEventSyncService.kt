package com.alarmtalk.app.data

import android.util.Log
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.network.CharacterXpRequest
import com.alarmtalk.app.network.VoiceAlarmApi
import com.alarmtalk.app.network.VoiceAlarmApiClient

data class CharacterEventSyncResult(
    val total: Int,
    val synced: Int,
    val failed: Int,
)

internal class CharacterEventSyncService(
    private val characterEventDao: CharacterEventDao,
) {
    suspend fun sync(api: VoiceAlarmApi, token: String): CharacterEventSyncResult {
        val authorization = VoiceAlarmApiClient.bearer(token)
        val pending = characterEventDao.getEventsByState(
            listOf(CharacterEventStates.PENDING, CharacterEventStates.FAILED),
        )
        var synced = 0
        var failed = 0

        pending.forEach { event ->
            runCatching {
                api.grantCharacterXp(
                    authorization = authorization,
                    request = CharacterXpRequest(
                        event = event.event,
                        clientNonce = event.clientNonce,
                        localDate = event.localDate,
                    ),
                )
                characterEventDao.setSyncState(
                    id = event.id,
                    state = CharacterEventStates.SYNCED,
                    syncedAtMillis = System.currentTimeMillis(),
                    lastError = null,
                )
                synced += 1
            }.onFailure { error ->
                failed += 1
                Log.e(TAG, "Failed to sync character event id=${event.id} event=${event.event}", error)
                characterEventDao.setSyncState(
                    id = event.id,
                    state = CharacterEventStates.FAILED,
                    syncedAtMillis = null,
                    lastError = error.message,
                )
            }
        }

        Log.i(TAG, "Character event sync complete total=${pending.size} synced=$synced failed=$failed")
        return CharacterEventSyncResult(total = pending.size, synced = synced, failed = failed)
    }
}
