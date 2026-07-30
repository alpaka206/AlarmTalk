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
    // 현재 로그인 계정(=받은 알람의 수신자) id. 새로 임포트하는 받은 알람에 소유자로 기록해,
    // 무료 잠금/복원이 그 수신자에게만 스코프되게 한다(같은 기기에 다른 계정이 로그인해도 남의
    // 받은 알람을 복원·스케줄하지 못하게 함). 없으면(null) 레거시처럼 미기록으로 둔다.
    private val currentUserIdProvider: () -> String? = { null },
) {
    // pull 이 동시에 두 번 돌면(FCM 수신 + 주기 sync 등) 둘 다 '기존 행 없음'으로 보고
    // 같은 받은 알람을 서로 다른 로컬 id 로 두 번 임포트한다(같은 시각 중복 울림).
    // 직렬화로 레이스를 제거한다.
    private val pullMutex = kotlinx.coroutines.sync.Mutex()

    private fun ownedByRecipient(alarm: AlarmEntity): Boolean =
        isOwnedByRecipient(alarm, currentUserIdProvider())

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
                        // 끄는 대상은 '이 수신자의' 알람만이다. 같은 기기에 남은 앞 계정 알람을
                        // 끄면 그 계정은 영영 모른 채 알람이 안 울린다 — 재예약은 enabled=1 만
                        // 훑으므로(getEnabledAlarms) 다시 로그인해도 되살아나지 않는다.
                        .filter { ownedByRecipient(it) }
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
                        // 서버 알람의 수신자는 한 명이라, 앞 계정이 받은 알람은 이 스냅샷에
                        // 없는 게 당연하다. 소유자를 안 보면 B 의 첫 완전 pull 이 A 가 받은
                        // 알람과 그 음성 캐시를 통째로 지운다.
                        ownedByRecipient(it) &&
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
            val cacheKey = "remote-message-$messageId"
            // 이미 받아 둔 음성이면 다시 받지 않는다. 이 pull 은 로그인마다·푸시마다 도는데,
            // 그때마다 같은 파일을 다시 내려받으면 재로그인 한 번에 받은 알람 수만큼 왕복이
            // 생긴다(생성 음성은 messageId 당 불변이라 다시 받을 이유가 없다).
            // 기본 목소리 프리페치(StockClipPrefetchWorker)는 이미 이렇게 하고 있었다.
            alarmAudioStore.getCachedAudio(cacheKey) ?: runCatching {
                val audio = api.getTtsMessageAudio(authorization, messageId)
                alarmAudioStore.cacheGeneratedAudio(
                    bytes = Base64.decode(audio.audioBase64, Base64.DEFAULT),
                    format = audio.audioFormat,
                    rawAudioUri = audio.audioUrl,
                    cacheKey = cacheKey,
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
        val computedPlayMode = when {
            cachedAudio == null -> AlarmPlayModes.ALARM_ONLY
            remote.wakeMode == "voice_only" -> AlarmPlayModes.VOICE_ONLY
            else -> AlarmPlayModes.ALARM_VOICE
        }
        val lockState = resolveReceivedLockState(computedPlayMode, existing)
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
            playMode = lockState.playMode,
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
            alarmSoundEnabled = existing?.alarmSoundEnabled ?: true,
            enabled = enabled,
            state = if (enabled) AlarmStates.SCHEDULED else AlarmStates.DISABLED,
            createdAtMillis = existing?.createdAtMillis ?: now,
            updatedAtMillis = now,
            // 무료 잠금 상태·소유자를 재구성 시에도 보존한다(resolveReceivedLockState 참조).
            // 새 받은 알람은 현재 수신자를 소유자로 기록하고, 기존 행은 그 값을 보존한다.
            preLockPlayMode = lockState.preLockPlayMode,
            ownerUserId = resolveReceivedOwner(existing, currentUserIdProvider()),
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

/**
 * 받은 알람의 소유자(무료 잠금 스코프용). 새 행(existing==null)은 현재 수신자(currentUserId)를 기록하고,
 * 기존 행은 이미 기록된 소유자를 보존한다 — 없으면(레거시 null) 현재 수신자로 자가 치유한다. 이렇게
 * 하면 같은 기기에 다른 계정이 로그인해도 남의 받은 목소리 알람을 복원·스케줄하지 못한다.
 */
internal fun resolveReceivedOwner(existing: AlarmEntity?, currentUserId: String?): String? =
    existing?.ownerUserId ?: currentUserId

/**
 * 이 pull 이 건드려도 되는 행인가 — 지금 수신자 소유이거나 소유자 미기록(레거시)일 때만.
 *
 * pull 은 이 세션이 서버에서 받은 목록만 보고 로컬을 정리한다. 그런데 로컬 알람은 로그아웃해도
 * 남으므로(원본이 기기다), 같은 기기에 앞 계정의 행이 함께 있다. 서버 알람의 수신자는 한 명이라
 * 앞 계정이 받은 알람이 이 스냅샷에 없는 건 당연한데, 소유자를 안 보면 '서버에 없다 → 끄기/지우기'로
 * 오판해 남의 알람을 죽인다. 특히 끄기는 치명적이다 — 재예약은 enabled=1 만 훑으므로(getEnabledAlarms)
 * 주인이 다시 로그인해도 되살아나지 않는다. 판정 규칙은 AlarmRepository.observeAlarms 와 같다.
 */
internal fun isOwnedByRecipient(alarm: AlarmEntity, currentUserId: String?): Boolean {
    val currentUser = currentUserId?.takeIf { it.isNotBlank() }
    return alarm.ownerUserId == null || alarm.ownerUserId == currentUser
}

internal data class ReceivedLockState(val playMode: String, val preLockPlayMode: String?)

/**
 * 받은 알람 재구성 시 무료 잠금 상태를 보존한다. 이전에 무료로 잠긴(existing.preLockPlayMode 설정)
 * 받은 알람은 매 FCM/주기 pull 재구성 후에도 잠금(playMode=ALARM_ONLY)을 유지한다 — 안 그러면
 * 동기화가 원격 목소리 모드로 되돌려 무료 사용자가 유료 목소리를 다시 듣게 된다. 잠금 설정/해제는
 * 유료 여부(구독 응답)를 아는 앱 시작 로직(lock/unlockPaidAlarmTalks)이 관장하고, 동기화는
 * 그 상태를 덮어쓰지 않는다. 잠기지 않았으면 재구성된 원격 모드를 그대로 쓴다.
 *
 * 잠긴 경우 복원용 preLockPlayMode 는: 이번 재구성으로 목소리 모드가 산출되면(computed != ALARM_ONLY)
 * 그 최신 모드를 담아 재유료 시 정확히 복원되게 하고, 이번 pull 에서 오디오를 못 받아 사운드온리가
 * 됐으면(computed == ALARM_ONLY) 기존 preLockPlayMode 를 보존해 잠금 마커 유실을 막는다.
 */
internal fun resolveReceivedLockState(
    computedPlayMode: String,
    existing: AlarmEntity?,
): ReceivedLockState {
    val wasLocked = !existing?.preLockPlayMode.isNullOrBlank()
    if (!wasLocked) return ReceivedLockState(computedPlayMode, null)
    val restoreMode = if (computedPlayMode != AlarmPlayModes.ALARM_ONLY) {
        computedPlayMode
    } else {
        existing?.preLockPlayMode
    }
    return ReceivedLockState(AlarmPlayModes.ALARM_ONLY, restoreMode)
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
