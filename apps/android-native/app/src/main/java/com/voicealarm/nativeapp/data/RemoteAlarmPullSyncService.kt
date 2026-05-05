package com.voicealarm.nativeapp.data

import android.util.Base64
import android.util.Log
import com.voicealarm.nativeapp.alarm.AlarmScheduler
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.network.RemoteAlarm
import com.voicealarm.nativeapp.network.VoiceAlarmApi
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient
import java.util.UUID

data class RemoteAlarmPullResult(
    val total: Int,
    val imported: Int,
    val updated: Int,
    val skipped: Int,
    val failed: Int,
)

internal class RemoteAlarmPullSyncService(
    private val alarmDao: AlarmDao,
    private val alarmScheduler: AlarmScheduler,
    private val alarmAudioStore: AlarmAudioStore,
) {
    suspend fun pullReceivedAlarms(api: VoiceAlarmApi, token: String): RemoteAlarmPullResult {
        val authorization = VoiceAlarmApiClient.bearer(token)
        val remoteAlarms = api.listAlarms(authorization).alarms
            .filter { it.isReceivedFamilyAlarm }

        var imported = 0
        var updated = 0
        var skipped = 0
        var failed = 0

        remoteAlarms.forEach { remote ->
            runCatching {
                val existing = alarmDao.getByRemoteAlarmId(remote.id)
                val local = buildLocalAlarm(
                    api = api,
                    authorization = authorization,
                    remote = remote,
                    existing = existing,
                ) ?: run {
                    skipped += 1
                    return@runCatching
                }

                if (existing != null) {
                    alarmScheduler.cancel(existing.id)
                }
                if (local.enabled) {
                    alarmScheduler.schedule(local)
                }
                alarmDao.upsert(local)
                if (existing == null) imported += 1 else updated += 1
            }.onFailure { error ->
                failed += 1
                Log.e(TAG, "Failed to pull received alarm remoteId=${remote.id}", error)
            }
        }

        Log.i(
            TAG,
            "Remote alarm pull complete total=${remoteAlarms.size} imported=$imported updated=$updated skipped=$skipped failed=$failed",
        )
        return RemoteAlarmPullResult(
            total = remoteAlarms.size,
            imported = imported,
            updated = updated,
            skipped = skipped,
            failed = failed,
        )
    }

    private suspend fun buildLocalAlarm(
        api: VoiceAlarmApi,
        authorization: String,
        remote: RemoteAlarm,
        existing: AlarmEntity?,
    ): AlarmEntity? {
        val time = parseTime(remote.time) ?: return null
        val repeatMask = repeatDaysToMask(remote.repeatDays.orEmpty())
        val now = System.currentTimeMillis()
        val enabled = remote.isActive != false

        val cachedAudio = remote.messageId
            ?.takeIf { it.isNotBlank() }
            ?.let { messageId ->
                val audio = api.getTtsMessageAudio(authorization, messageId)
                alarmAudioStore.cacheGeneratedAudio(
                    bytes = Base64.decode(audio.audioBase64, Base64.DEFAULT),
                    format = audio.audioFormat,
                    rawAudioUri = audio.audioUrl,
                    cacheKey = "remote-message-$messageId",
                    messageId = messageId,
                )
            }

        val fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
            hour = time.first,
            minute = time.second,
            repeatDaysMask = repeatMask,
            holidayOff = false,
            nowMillis = now,
        )
        val playMode = when {
            cachedAudio == null -> AlarmPlayModes.ALARM_ONLY
            remote.wakeMode == "voice_only" -> AlarmPlayModes.VOICE_ONLY
            else -> AlarmPlayModes.ALARM_VOICE
        }
        val label = remote.messageText
            ?.takeIf { it.isNotBlank() }
            ?: remote.senderName?.takeIf { it.isNotBlank() }?.let { "$it 알람" }
            ?: "상대방 알람"

        return AlarmEntity(
            id = existing?.id ?: UUID.randomUUID().toString(),
            label = label,
            hour = time.first,
            minute = time.second,
            fireAtMillis = fireAtMillis,
            repeatDaysMask = repeatMask,
            holidayOff = false,
            snoozeEnabled = true,
            snoozeMinutes = remote.snoozeMinutes ?: 5,
            snoozeRepeatLimit = existing?.snoozeRepeatLimit ?: SnoozeRepeatLimits.THREE,
            snoozeCount = 0,
            vibrationPattern = remote.vibrationPattern ?: VibrationPatterns.DEFAULT,
            playMode = playMode,
            defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
            localAudioUri = cachedAudio?.localAudioUri,
            audioCacheKey = cachedAudio?.cacheKey,
            rawAudioUri = cachedAudio?.rawAudioUri ?: remote.rawAudioUrl ?: remote.messageAudioUrl,
            voiceSource = if (cachedAudio == null) VoiceSources.LOCAL_AUDIO else VoiceSources.SERVER_TTS,
            voiceProfileId = remote.voiceProfileId,
            voiceText = remote.messageText,
            voiceCategory = remote.category,
            voiceLanguage = null,
            ttsMessageId = remote.messageId,
            remoteAlarmId = remote.id,
            lastSyncedAtMillis = now,
            syncState = AlarmSyncStates.SYNCED,
            enabled = enabled,
            state = if (enabled) AlarmStates.SCHEDULED else AlarmStates.DISABLED,
            createdAtMillis = existing?.createdAtMillis ?: now,
            updatedAtMillis = now,
        )
    }

    private fun parseTime(value: String?): Pair<Int, Int>? {
        val parts = value?.split(':') ?: return null
        if (parts.size < 2) return null
        val hour = parts[0].toIntOrNull() ?: return null
        val minute = parts[1].toIntOrNull() ?: return null
        if (hour !in 0..23 || minute !in 0..59) return null
        return hour to minute
    }

    private fun repeatDaysToMask(days: List<Int>): Int =
        days.filter { it in 0..6 }.fold(0) { mask, day -> mask or (1 shl day) }
}
