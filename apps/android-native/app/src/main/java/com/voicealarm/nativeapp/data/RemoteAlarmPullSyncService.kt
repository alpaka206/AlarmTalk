package com.voicealarm.nativeapp.data

import android.util.Base64
import android.util.Log
import com.voicealarm.nativeapp.alarm.AlarmScheduler
import com.voicealarm.nativeapp.alarm.SocialNotificationFactory
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
    private val context: android.content.Context,
) {
    suspend fun pullReceivedAlarms(
        api: VoiceAlarmApi,
        token: String,
        myUserId: String,
    ): RemoteAlarmPullResult {
        val authorization = VoiceAlarmApiClient.bearer(token)
        // 서버는 user_id IN (...) OR target_user_id IN (...) 로 이미 스코프해서 보내준다.
        // 그중 "내가 만든 게 아니라 누군가가 나를 target 으로 만든" 알람만 가져온다.
        // 기존에는 isReceivedFamilyAlarm(=family/family-voice 카테고리)로 좁혀져 있어서
        // 일반 /api/alarm 경로(target_user_id 포함)로 보낸 알람이 누락됐다.
        val remoteAlarms = api.listAlarms(authorization).alarms
            .filter { remote ->
                val sender = remote.senderUserId
                val target = remote.targetUserId
                !target.isNullOrBlank() &&
                    !sender.isNullOrBlank() &&
                    sender != myUserId
            }

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
                // upsert 를 먼저. schedule 이 권한 부족 등으로 throw 해도 알람은
                // 로컬 DB 에 남아 리스트에 표시되고, 권한 받은 뒤 reschedule 가능.
                alarmDao.upsert(local)
                if (local.enabled) {
                    runCatching { alarmScheduler.schedule(local) }
                        .onFailure { error ->
                            Log.w(TAG, "Saved received alarm but failed to schedule id=${local.id}", error)
                        }
                }
                if (existing == null) {
                    SocialNotificationFactory.notifyReceivedAlarm(
                        context = context,
                        alarmId = local.id,
                        senderName = remote.senderName ?: remote.senderEmail,
                        time = "%02d:%02d".format(local.hour, local.minute),
                    )
                    imported += 1
                } else {
                    updated += 1
                }
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
        val enabled = resolveReceivedRemoteEnabled(existing, remote.isActive)

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
            voiceRandomPrompt = false,
            voiceRepeat = existing?.voiceRepeat ?: true,
            ttsMessageId = remote.messageId,
            remoteAlarmId = remote.id,
            lastSyncedAtMillis = now,
            syncState = AlarmSyncStates.SYNCED,
            origin = AlarmOrigins.RECEIVED_REMOTE,
            alarmVolumePercent = existing?.alarmVolumePercent ?: 100,
            alarmSoundUri = existing?.alarmSoundUri,
            alarmSoundLabel = existing?.alarmSoundLabel,
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

internal fun resolveReceivedRemoteEnabled(existing: AlarmEntity?, remoteIsActive: Boolean?): Boolean {
    val remoteEnabled = remoteIsActive != false
    return if (existing?.origin == AlarmOrigins.RECEIVED_REMOTE) {
        existing.enabled && remoteEnabled
    } else {
        remoteEnabled
    }
}
