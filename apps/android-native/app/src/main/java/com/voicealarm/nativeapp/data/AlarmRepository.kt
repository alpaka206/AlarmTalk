package com.voicealarm.nativeapp.data

import android.util.Log
import com.voicealarm.nativeapp.alarm.AlarmScheduler
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.network.RemoteAlarmMapper
import com.voicealarm.nativeapp.network.VoiceAlarmApi
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient
import com.voicealarm.nativeapp.network.CharacterXpRequest
import java.util.UUID
import kotlinx.coroutines.flow.Flow

data class AlarmSyncResult(
    val total: Int,
    val created: Int,
    val updated: Int,
    val failed: Int,
)

data class CharacterEventSyncResult(
    val total: Int,
    val synced: Int,
    val failed: Int,
)

class AlarmRepository(
    private val alarmDao: AlarmDao,
    private val characterEventDao: CharacterEventDao,
    private val alarmScheduler: AlarmScheduler,
) {
    fun observeAlarms(): Flow<List<AlarmEntity>> = alarmDao.observeAlarms()

    fun observeCharacterEvents(): Flow<List<CharacterEventEntity>> = characterEventDao.observeEvents()

    suspend fun getAlarm(alarmId: String): AlarmEntity? = alarmDao.getById(alarmId)

    suspend fun createTestAlarm(delayMinutes: Int): AlarmEntity {
        require(delayMinutes in 1..5) { "Test alarm delay must be between 1 and 5 minutes." }

        val now = System.currentTimeMillis()
        val fireAtMillis = now + delayMinutes * 60_000L
        val localTime = java.time.Instant.ofEpochMilli(fireAtMillis)
            .atZone(java.time.ZoneId.systemDefault())
            .toLocalTime()
        requireExactAlarmPermission()
        val alarm = AlarmEntity(
            id = UUID.randomUUID().toString(),
            label = "Test alarm",
            hour = localTime.hour,
            minute = localTime.minute,
            fireAtMillis = fireAtMillis,
            repeatDaysMask = 0,
            holidayOff = false,
            snoozeEnabled = true,
            snoozeMinutes = 5,
            vibrationPattern = VibrationPatterns.DEFAULT,
            playMode = AlarmPlayModes.ALARM_ONLY,
            defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
            localAudioUri = null,
            audioCacheKey = null,
            rawAudioUri = null,
            voiceSource = VoiceSources.LOCAL_AUDIO,
            voiceProfileId = null,
            voiceText = null,
            voiceCategory = null,
            voiceLanguage = null,
            ttsMessageId = null,
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = now,
            updatedAtMillis = now,
        )

        alarmScheduler.schedule(alarm)
        alarmDao.upsert(alarm)
        Log.i(TAG, "Created test alarm id=${alarm.id} delayMinutes=$delayMinutes fireAt=${alarm.fireAtMillis}")
        return alarm
    }

    suspend fun createAlarm(draft: AlarmDraft): AlarmEntity {
        validateDraft(draft)

        val now = System.currentTimeMillis()
        val alarm = AlarmEntity(
            id = UUID.randomUUID().toString(),
            label = draft.label.trim().ifBlank { "알람" },
            hour = draft.hour,
            minute = draft.minute,
            fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                hour = draft.hour,
                minute = draft.minute,
                repeatDaysMask = draft.repeatDaysMask,
                holidayOff = draft.holidayOff,
                nowMillis = now,
            ),
            repeatDaysMask = draft.repeatDaysMask,
            holidayOff = draft.holidayOff,
            snoozeEnabled = draft.snoozeEnabled,
            snoozeMinutes = draft.snoozeMinutes,
            vibrationPattern = draft.vibrationPattern,
            playMode = draft.playMode,
            defaultAlarmSoundId = draft.defaultAlarmSoundId,
            localAudioUri = draft.localAudioUri,
            audioCacheKey = draft.audioCacheKey,
            rawAudioUri = draft.rawAudioUri,
            voiceSource = draft.voiceSource,
            voiceProfileId = draft.voiceProfileId,
            voiceText = draft.voiceText,
            voiceCategory = draft.voiceCategory,
            voiceLanguage = draft.voiceLanguage,
            ttsMessageId = draft.ttsMessageId,
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = now,
            updatedAtMillis = now,
        )

        requireExactAlarmPermission()
        alarmScheduler.schedule(alarm)
        alarmDao.upsert(alarm)
        Log.i(TAG, "Created local alarm id=${alarm.id} fireAt=${alarm.fireAtMillis}")
        return alarm
    }

    suspend fun updateAlarm(alarmId: String, draft: AlarmDraft): AlarmEntity {
        validateDraft(draft)
        val current = requireNotNull(alarmDao.getById(alarmId)) { "Alarm not found." }
        val now = System.currentTimeMillis()
        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = draft.hour,
            minute = draft.minute,
            repeatDaysMask = draft.repeatDaysMask,
            holidayOff = draft.holidayOff,
            nowMillis = now,
        )
        val updated = current.copy(
            label = draft.label.trim().ifBlank { "알람" },
            hour = draft.hour,
            minute = draft.minute,
            fireAtMillis = nextFireAt,
            repeatDaysMask = draft.repeatDaysMask,
            holidayOff = draft.holidayOff,
            snoozeEnabled = draft.snoozeEnabled,
            snoozeMinutes = draft.snoozeMinutes,
            vibrationPattern = draft.vibrationPattern,
            playMode = draft.playMode,
            defaultAlarmSoundId = draft.defaultAlarmSoundId,
            localAudioUri = draft.localAudioUri,
            audioCacheKey = draft.audioCacheKey,
            rawAudioUri = draft.rawAudioUri,
            voiceSource = draft.voiceSource,
            voiceProfileId = draft.voiceProfileId,
            voiceText = draft.voiceText,
            voiceCategory = draft.voiceCategory,
            voiceLanguage = draft.voiceLanguage,
            ttsMessageId = draft.ttsMessageId,
            syncState = current.nextLocalSyncState(),
            state = if (current.enabled) AlarmStates.SCHEDULED else AlarmStates.DISABLED,
            updatedAtMillis = now,
        )

        if (updated.enabled) requireExactAlarmPermission()
        alarmScheduler.cancel(alarmId)
        if (updated.enabled) alarmScheduler.schedule(updated)
        alarmDao.upsert(updated)
        Log.i(TAG, "Updated local alarm id=$alarmId enabled=${updated.enabled} fireAt=${updated.fireAtMillis}")
        return updated
    }

    suspend fun setEnabled(alarmId: String, enabled: Boolean): AlarmEntity {
        val current = requireNotNull(alarmDao.getById(alarmId)) { "Alarm not found." }
        val now = System.currentTimeMillis()
        if (enabled) requireExactAlarmPermission()
        alarmScheduler.cancel(alarmId)

        val updated = if (enabled) {
            current.copy(
                fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                    hour = current.hour,
                    minute = current.minute,
                    repeatDaysMask = current.repeatDaysMask,
                    holidayOff = current.holidayOff,
                    nowMillis = now,
                ),
                enabled = true,
                state = AlarmStates.SCHEDULED,
                syncState = current.nextLocalSyncState(),
                updatedAtMillis = now,
            )
        } else {
            current.copy(
                enabled = false,
                state = AlarmStates.DISABLED,
                syncState = current.nextLocalSyncState(),
                updatedAtMillis = now,
            )
        }

        if (enabled) alarmScheduler.schedule(updated)
        alarmDao.upsert(updated)
        Log.i(TAG, "Alarm enabled changed id=$alarmId enabled=$enabled fireAt=${updated.fireAtMillis}")
        return updated
    }

    suspend fun deleteAlarm(alarmId: String) {
        val current = alarmDao.getById(alarmId)
        if (current == null) {
            Log.w(TAG, "Delete requested for missing alarm id=$alarmId")
            return
        }
        alarmScheduler.cancel(alarmId)
        alarmDao.delete(current)
        Log.i(TAG, "Deleted alarm id=$alarmId")
    }

    suspend fun copyAlarm(alarmId: String): AlarmEntity {
        val current = requireNotNull(alarmDao.getById(alarmId)) { "Alarm not found." }
        val now = System.currentTimeMillis()
        val copied = current.copy(
            id = UUID.randomUUID().toString(),
            label = current.label.takeIf { it.isNotBlank() }?.let { "$it 복사본" } ?: "복사한 알람",
            fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                hour = current.hour,
                minute = current.minute,
                repeatDaysMask = current.repeatDaysMask,
                holidayOff = current.holidayOff,
                nowMillis = now,
            ),
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = now,
            updatedAtMillis = now,
        )
        requireExactAlarmPermission()
        alarmScheduler.schedule(copied)
        alarmDao.upsert(copied)
        Log.i(TAG, "Copied alarm source=$alarmId id=${copied.id} cacheKey=${copied.audioCacheKey}")
        return copied
    }

    suspend fun markRinging(alarmId: String) {
        alarmDao.setState(
            id = alarmId,
            state = AlarmStates.RINGING,
            enabled = true,
            updatedAtMillis = System.currentTimeMillis(),
        )
        Log.i(TAG, "Alarm marked ringing id=$alarmId")
    }

    suspend fun dismiss(alarmId: String) {
        val current = alarmDao.getById(alarmId)
        if (current == null) {
            alarmScheduler.cancel(alarmId)
            Log.w(TAG, "Dismiss requested for missing alarm id=$alarmId")
            return
        }

        val now = System.currentTimeMillis()
        if (current.repeatDaysMask != 0) {
            val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
                hour = current.hour,
                minute = current.minute,
                repeatDaysMask = current.repeatDaysMask,
                holidayOff = current.holidayOff,
                nowMillis = now,
            )
            val next = current.copy(
                fireAtMillis = nextFireAt,
                enabled = true,
                state = AlarmStates.SCHEDULED,
                updatedAtMillis = now,
            )
            alarmDao.upsert(next)
            alarmScheduler.schedule(next)
        } else {
            alarmScheduler.cancel(alarmId)
            alarmDao.setState(
                id = alarmId,
                state = AlarmStates.DISMISSED,
                enabled = false,
                updatedAtMillis = now,
            )
        }
        queueCharacterEvent(
            event = CharacterEventTypes.ALARM_COMPLETED,
            sourceAlarmId = alarmId,
            nowMillis = now,
        )
        Log.i(TAG, "Alarm dismissed id=$alarmId")
    }

    suspend fun snooze(alarmId: String): AlarmEntity? {
        val current = alarmDao.getById(alarmId)
        if (current == null) {
            Log.w(TAG, "Snooze requested for missing alarm id=$alarmId")
            return null
        }
        if (!current.snoozeEnabled) {
            Log.i(TAG, "Snooze ignored because it is disabled id=$alarmId")
            return null
        }

        val now = System.currentTimeMillis()
        val next = current.copy(
            fireAtMillis = now + current.snoozeMinutes * 60_000L,
            enabled = true,
            state = AlarmStates.SNOOZED,
            updatedAtMillis = now,
        )
        alarmDao.upsert(next)
        alarmScheduler.schedule(next)
        queueCharacterEvent(
            event = CharacterEventTypes.ALARM_SNOOZED,
            sourceAlarmId = alarmId,
            nowMillis = now,
        )
        Log.i(TAG, "Alarm snoozed id=$alarmId minutes=${current.snoozeMinutes} nextFireAt=${next.fireAtMillis}")
        return next
    }

    suspend fun reschedulePendingAlarms(): Int {
        val now = System.currentTimeMillis()
        val enabledAlarms = alarmDao.getEnabledAlarms()
        var scheduled = 0

        enabledAlarms.forEach { alarm ->
            runCatching {
                val alarmToSchedule = if (alarm.fireAtMillis > now) {
                    alarm
                } else if (alarm.repeatDaysMask != 0) {
                    alarm.copy(
                        fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                            hour = alarm.hour,
                            minute = alarm.minute,
                            repeatDaysMask = alarm.repeatDaysMask,
                            holidayOff = alarm.holidayOff,
                            nowMillis = now,
                        ),
                        state = AlarmStates.SCHEDULED,
                        updatedAtMillis = now,
                    ).also { alarmDao.upsert(it) }
                } else {
                    alarm.copy(
                        enabled = false,
                        state = AlarmStates.FAILED,
                        updatedAtMillis = now,
                    ).also { alarmDao.upsert(it) }
                    return@forEach
                }

                alarmScheduler.schedule(alarmToSchedule)
                scheduled += 1
            }.onFailure { error ->
                Log.e(TAG, "Failed to restore alarm id=${alarm.id}", error)
                alarmDao.setState(
                    id = alarm.id,
                    state = AlarmStates.FAILED,
                    enabled = true,
                    updatedAtMillis = System.currentTimeMillis(),
                )
            }
        }

        Log.i(TAG, "Boot restore complete pending=${enabledAlarms.size} scheduled=$scheduled")
        return scheduled
    }

    suspend fun syncWithBackend(api: VoiceAlarmApi, token: String): AlarmSyncResult {
        val authorization = VoiceAlarmApiClient.bearer(token)
        val localAlarms = alarmDao.getAllAlarms()
        var created = 0
        var updated = 0
        var failed = 0

        localAlarms.forEach { alarm ->
            val now = System.currentTimeMillis()
            runCatching {
                val request = RemoteAlarmMapper.toWriteRequest(alarm)
                val remoteAlarm = if (alarm.remoteAlarmId == null) {
                    api.createAlarm(authorization, request).alarm.also {
                        created += 1
                    }
                } else {
                    api.updateAlarm(authorization, alarm.remoteAlarmId, request).alarm.also {
                        updated += 1
                    }
                }
                alarmDao.setSyncState(
                    id = alarm.id,
                    remoteAlarmId = remoteAlarm.id,
                    lastSyncedAtMillis = now,
                    syncState = AlarmSyncStates.SYNCED,
                    updatedAtMillis = now,
                )
                if (alarm.localAudioUri != null && alarm.rawAudioUri?.startsWith("http", ignoreCase = true) != true) {
                    Log.i(TAG, "Synced alarm metadata only; local voice audio remains on-device id=${alarm.id}")
                }
            }.onFailure { error ->
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

    suspend fun syncCharacterEvents(api: VoiceAlarmApi, token: String): CharacterEventSyncResult {
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

    private fun validateDraft(draft: AlarmDraft) {
        require(draft.hour in 0..23) { "Hour must be between 0 and 23." }
        require(draft.minute in 0..59) { "Minute must be between 0 and 59." }
        require(draft.repeatDaysMask in 0..0x7f) { "Repeat days mask must only use Sunday through Saturday bits." }
        require(draft.snoozeMinutes in 1..30) { "Snooze must be between 1 and 30 minutes." }
        require(draft.vibrationPattern in VibrationPatterns.all) { "Unknown vibration pattern." }
        require(draft.playMode in AlarmPlayModes.all) { "Unknown play mode." }
        require(draft.voiceSource in VoiceSources.all) { "Unknown voice source." }
        if (draft.playMode != AlarmPlayModes.ALARM_ONLY) {
            require(!draft.localAudioUri.isNullOrBlank()) { "Voice audio must be cached before saving this alarm." }
        }
    }

    private fun requireExactAlarmPermission() {
        require(alarmScheduler.canScheduleExactAlarms()) {
            "정확한 알람 권한을 허용한 뒤 다시 시도해 주세요."
        }
    }

    private fun AlarmEntity.nextLocalSyncState(): String =
        if (remoteAlarmId == null) AlarmSyncStates.LOCAL_ONLY else AlarmSyncStates.DIRTY

    private suspend fun queueCharacterEvent(
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
