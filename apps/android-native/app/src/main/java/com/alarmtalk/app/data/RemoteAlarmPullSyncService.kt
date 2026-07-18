package com.alarmtalk.app.data

import android.util.Base64
import android.util.Log
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.alarm.SocialNotificationFactory
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.RemoteAlarm
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.AlarmTalkApiClient
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
    // pull 이 동시에 두 번 돌면(FCM 수신 + 주기 sync 등) 둘 다 '기존 행 없음'으로 보고
    // 같은 받은 알람을 서로 다른 로컬 id 로 두 번 임포트한다(같은 시각 중복 울림).
    // 직렬화로 레이스를 제거한다.
    private val pullMutex = kotlinx.coroutines.sync.Mutex()

    suspend fun pullReceivedAlarms(
        api: AlarmTalkApi,
        token: String,
    ): RemoteAlarmPullResult {
        pullMutex.lock()
        try {
            return pullReceivedAlarmsLocked(api, token)
        } finally {
            pullMutex.unlock()
        }
    }

    private suspend fun pullReceivedAlarmsLocked(
        api: AlarmTalkApi,
        token: String,
    ): RemoteAlarmPullResult {
        val authorization = AlarmTalkApiClient.bearer(token)
        // 서버는 user_id IN (...) OR target_user_id IN (...) 로 이미 스코프해서 보내준다.
        // 그중 "내가 만든 게 아니라 누군가가 나를 target 으로 만든" 받은 알람만 가져온다 —
        // 판별은 서버가 뷰어의 두 식별자(PK·로그인 id)를 모두 담은 집합으로 계산한 is_received 를 쓴다.
        // 클라측 session.user.id 로 sender 를 직접 비교하면 계정 연동(PK≠google_id) 사용자의
        // '보낸 알람'을 '받은 알람'으로 오분류해 자기 기기에 예약해버린다(PR #536 P1).
        // 페이지네이션으로 전체 스냅샷을 모은다 — 1페이지만 받으면 알람이 많은 사용자는 받은 알람
        // 처리·prune 이 누락된다. 완전 스냅샷(snapshotComplete)일 때만 아래에서 prune 한다.
        val allRemote = mutableListOf<RemoteAlarm>()
        var offset = 0
        var reportedTotal = 0
        var snapshotComplete = false
        val pageSize = 100
        for (page in 0 until 25) {
            val resp = api.listAlarms(authorization, pageSize, offset)
            allRemote.addAll(resp.alarms)
            reportedTotal = resp.total ?: allRemote.size
            offset += resp.alarms.size
            if (resp.alarms.size < pageSize || allRemote.size >= reportedTotal) {
                snapshotComplete = true
                break
            }
        }
        val remoteAlarms = allRemote.filter { it.isReceived }

        var imported = 0
        var updated = 0
        var skipped = 0
        var failed = 0

        remoteAlarms.forEach { remote ->
            runCatching {
                // 과거 동시 pull 레이스로 같은 서버 알람이 여러 로컬 행으로 임포트됐다면
                // 가장 오래된 행만 남기고 나머지를 정리한다(같은 시각 중복 울림 자가 치유).
                val existingRows = alarmDao.getAllByRemoteAlarmId(remote.id)
                existingRows.drop(1).forEach { duplicate ->
                    alarmScheduler.cancel(duplicate.id)
                    val duplicateCacheKey = duplicate.audioCacheKey
                    alarmDao.delete(duplicate)
                    alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, duplicateCacheKey)
                    Log.i(TAG, "Removed duplicate received alarm row remoteId=${remote.id} localId=${duplicate.id}")
                }
                val existing = existingRows.firstOrNull()
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
                // 받은 알람과 같은 시각에 내가 켜 둔 알람이 있으면 보낸 사람의 알람이 우선한다 —
                // 같은 시각 두 알람이 서로의 울림을 끊는 것을 막고, 내 알람은 삭제 대신 끄기만
                // 해서(리스트에 남음) 언제든 다시 켤 수 있게 한다.
                if (local.enabled) {
                    alarmDao.getEnabledAtTime(local.hour, local.minute, excludeId = local.id)
                        .filter { it.remoteAlarmId != remote.id }
                        .forEach { conflicting ->
                            alarmScheduler.cancel(conflicting.id)
                            alarmDao.upsert(
                                conflicting.copy(
                                    enabled = false,
                                    updatedAtMillis = System.currentTimeMillis(),
                                ),
                            )
                            Log.i(
                                TAG,
                                "Disabled same-time alarm id=${conflicting.id} in favor of received remoteId=${remote.id}",
                            )
                        }
                }
                // 받은 알람의 메시지(음성)가 새 캐시로 교체됐으면 이전 캐시는 미참조일 때만 정리.
                val previousCacheKey = existing?.audioCacheKey
                if (!previousCacheKey.isNullOrBlank() && previousCacheKey != local.audioCacheKey) {
                    alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, previousCacheKey)
                }
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
                        senderName = remote.senderName
                            ?.takeIf { it.isNotBlank() }
                            ?: remote.senderEmail,
                        time = "%02d:%02d".format(local.hour, local.minute),
                    )
                    imported += 1
                } else {
                    updated += 1
                }
            }.onFailure { error ->
                failed += 1
                AlarmTalkLog.reportError("Failed to pull received alarm remoteId=${remote.id}", error)
            }
        }

        // 서버가 더 이상 '받은 알람'으로 내려주지 않는(수신자 그만받기·발신자 삭제) 로컬 받은 알람을 제거한다.
        // decline 게이트가 서버 목록에서 빼므로, 이미 임포트한 기기가 계속 울리지 않도록 prune 한다.
        // 비교 기준은 전체(allRemote)가 아니라 '받은 것'(is_received) 하위집합의 id 다 — 구 네임스페이스
        // 버그로 '보낸 알람'을 RECEIVED_REMOTE 로 잘못 임포트한 기기에서, 그 행의 remoteAlarmId 는 여전히
        // allRemote(내 보낸 알람)에 있어 안 지워진다. 받은 집합 기준으로 비교해야 그 잔재까지 정리된다.
        // 단, 목록이 페이지네이션으로 잘렸으면(size < total) 오삭제 위험이 있어 건너뛴다(완전 스냅샷일 때만).
        var pruned = 0
        if (snapshotComplete) {
            val servedRemoteIds = remoteAlarms.map { it.id }.toSet()
            alarmDao.getAllAlarms()
                .filter {
                    it.origin == AlarmOrigins.RECEIVED_REMOTE &&
                        !it.remoteAlarmId.isNullOrBlank() &&
                        it.remoteAlarmId !in servedRemoteIds
                }
                .forEach { stale ->
                    alarmScheduler.cancel(stale.id)
                    val cacheKey = stale.audioCacheKey
                    alarmDao.delete(stale)
                    alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, cacheKey)
                    pruned += 1
                    Log.i(TAG, "Pruned received alarm no longer served by server remoteId=${stale.remoteAlarmId}")
                }
        }

        Log.i(
            TAG,
            "Remote alarm pull complete total=${remoteAlarms.size} imported=$imported updated=$updated skipped=$skipped failed=$failed pruned=$pruned",
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
        api: AlarmTalkApi,
        authorization: String,
        remote: RemoteAlarm,
        existing: AlarmEntity?,
    ): AlarmEntity? {
        val time = parseTime(remote.time) ?: return null
        val repeatMask = repeatDaysToMask(remote.repeatDays.orEmpty())
        val now = System.currentTimeMillis()
        val enabled = resolveReceivedRemoteEnabled(existing, remote.isActive)

        val cachedAudio = if (shouldDownloadRemoteMessageAudio(remote)) {
            val messageId = remote.messageId?.trim().orEmpty()
            runCatching {
                val audio = api.getTtsMessageAudio(authorization, messageId)
                alarmAudioStore.cacheGeneratedAudio(
                    bytes = Base64.decode(audio.audioBase64, Base64.DEFAULT),
                    format = audio.audioFormat,
                    rawAudioUri = audio.audioUrl,
                    cacheKey = "remote-message-$messageId",
                    messageId = messageId,
                )
            }.onFailure { error ->
                Log.w(TAG, "Failed to cache remote alarm audio remoteId=${remote.id} messageId=$messageId", error)
            }.getOrNull()
        } else {
            null
        }
        val hasVoiceAudio = cachedAudio != null

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
        val label = receivedRemoteAlarmLabel(context, remote.senderName, remote.senderEmail)

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
            rawAudioUri = cachedAudio?.rawAudioUri,
            voiceSource = if (hasVoiceAudio) VoiceSources.SERVER_TTS else VoiceSources.LOCAL_AUDIO,
            voiceProfileId = remote.voiceProfileId.takeIf { hasVoiceAudio },
            voiceListenerTitle = null,
            voiceText = remote.messageText.takeIf { hasVoiceAudio },
            voiceCategory = remote.category.takeIf { hasVoiceAudio },
            voiceLanguage = null,
            voiceRandomPrompt = false,
            voiceRandomContext = null,
            voiceWeatherCountry = null,
            voiceWeatherCity = null,
            voiceFortuneGender = null,
            voiceFortuneBirthDate = null,
            voiceFortuneBirthTime = null,
            dynamicVoicePreparedForFireAtMillis = null,
            voiceRepeat = existing?.voiceRepeat ?: true,
            voiceVolumePercent = existing?.voiceVolumePercent ?: 100,
            ttsMessageId = remote.messageId?.trim()?.takeIf { hasVoiceAudio && it.isNotBlank() },
            // 받은 알람은 버킷 식별자만 보존(회전 클립은 미다운로드 → 대표 클립 단일 재생 폴백).
            bucketId = remote.bucketId?.trim()?.takeIf { hasVoiceAudio && it.isNotBlank() },
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

internal fun shouldDownloadRemoteMessageAudio(remote: RemoteAlarm): Boolean =
    !remote.messageId.isNullOrBlank() &&
        !remote.messageAudioUrl.isNullOrBlank()
