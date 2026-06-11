package com.alarmtalk.app.data

import android.content.Context
import android.util.Base64
import android.util.Log
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.trimmedOrNull
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.flow.Flow

class AlarmRepository(
    private val alarmDao: AlarmDao,
    private val characterEventDao: CharacterEventDao,
    private val holidayCalendarStore: HolidayCalendarStore,
    private val alarmScheduler: AlarmScheduler,
    private val alarmAudioStore: AlarmAudioStore,
    private val context: Context,
) {
    private val characterEvents = CharacterEventRepository(characterEventDao)
    private val alarmSyncService = AlarmSyncService(alarmDao)
    private val remoteAlarmPullSyncService = RemoteAlarmPullSyncService(
        alarmDao = alarmDao,
        alarmScheduler = alarmScheduler,
        alarmAudioStore = alarmAudioStore,
        context = context,
    )
    private val characterEventSyncService = CharacterEventSyncService(characterEventDao)

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
        requireUniqueTime(localTime.hour, localTime.minute)
        val alarm = AlarmEntity(
            id = UUID.randomUUID().toString(),
            label = "테스트 알람",
            hour = localTime.hour,
            minute = localTime.minute,
            fireAtMillis = fireAtMillis,
            repeatDaysMask = 0,
            holidayOff = false,
            snoozeEnabled = true,
            snoozeMinutes = 5,
            snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
            snoozeCount = 0,
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
            voiceRandomPrompt = false,
            voiceRandomContext = null,
            voiceWeatherCountry = null,
            voiceWeatherCity = null,
            voiceFortuneGender = null,
            voiceFortuneBirthDate = null,
            voiceFortuneBirthTime = null,
            dynamicVoicePreparedForFireAtMillis = null,
            voiceRepeat = true,
            voiceVolumePercent = 100,
            ttsMessageId = null,
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            origin = AlarmOrigins.LOCAL_OWNED,
            alarmVolumePercent = 100,
            alarmSoundUri = null,
            alarmSoundLabel = null,
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

    suspend fun createAlarm(draft: AlarmDraft, replaceExisting: Boolean = false): AlarmEntity {
        validateDraft(draft)
        val conflict = findReplaceableConflict(draft.hour, draft.minute, excludeAlarmId = null, replaceExisting = replaceExisting)

        val now = System.currentTimeMillis()
        val holidayPredicate = holidayCalendarStore.holidayPredicate(startDate = currentLocalDate(now))
        val fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
            hour = draft.hour,
            minute = draft.minute,
            repeatDaysMask = draft.repeatDaysMask,
            holidayOff = draft.holidayOff,
            nowMillis = now,
            isHoliday = holidayPredicate,
        )
        val alarm = AlarmEntity(
            id = UUID.randomUUID().toString(),
            label = draft.label.trim().ifBlank { "알람" },
            hour = draft.hour,
            minute = draft.minute,
            fireAtMillis = fireAtMillis,
            repeatDaysMask = draft.repeatDaysMask,
            holidayOff = draft.holidayOff,
            snoozeEnabled = draft.snoozeEnabled,
            snoozeMinutes = draft.snoozeMinutes,
            snoozeRepeatLimit = draft.snoozeRepeatLimit,
            snoozeCount = 0,
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
            voiceRandomPrompt = draft.voiceRandomPrompt,
            voiceRandomContext = draft.voiceRandomContext,
            voiceWeatherCountry = draft.voiceWeatherCountry,
            voiceWeatherCity = draft.voiceWeatherCity,
            voiceFortuneGender = draft.voiceFortuneGender,
            voiceFortuneBirthDate = draft.voiceFortuneBirthDate,
            voiceFortuneBirthTime = draft.voiceFortuneBirthTime,
            dynamicVoicePreparedForFireAtMillis = draft.dynamicVoicePreparedForFireAtMillis
                ?: fireAtMillis.takeIf { draft.voiceRandomPrompt && !draft.localAudioUri.isNullOrBlank() },
            voiceRepeat = draft.voiceRepeat,
            voiceVolumePercent = draft.voiceVolumePercent,
            ttsMessageId = draft.ttsMessageId,
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            origin = AlarmOrigins.LOCAL_OWNED,
            alarmVolumePercent = draft.alarmVolumePercent,
            alarmSoundUri = draft.alarmSoundUri,
            alarmSoundLabel = draft.alarmSoundLabel,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = now,
            updatedAtMillis = now,
        )

        alarmScheduler.schedule(alarm)
        alarmDao.upsert(alarm)
        // 새 알람을 저장한 뒤에 충돌 알람을 삭제해야, 둘이 같은 audioCacheKey 를
        // 공유할 때 캐시 음성이 보존된다(deleteAlarm 의 참조 카운트가 새 알람을 포함).
        conflict?.let { deleteAlarm(it.id) }
        Log.i(TAG, "Created local alarm id=${alarm.id} fireAt=${alarm.fireAtMillis}")
        return alarm
    }

    suspend fun updateAlarm(
        alarmId: String,
        draft: AlarmDraft,
        replaceExisting: Boolean = false,
    ): AlarmEntity {
        validateDraft(draft)
        val current = requireNotNull(alarmDao.getById(alarmId)) { "Alarm not found." }
        val conflict = findReplaceableConflict(draft.hour, draft.minute, excludeAlarmId = alarmId, replaceExisting = replaceExisting)
        val now = System.currentTimeMillis()
        val holidayPredicate = holidayCalendarStore.holidayPredicate(startDate = currentLocalDate(now))
        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = draft.hour,
            minute = draft.minute,
            repeatDaysMask = draft.repeatDaysMask,
            holidayOff = draft.holidayOff,
            nowMillis = now,
            isHoliday = holidayPredicate,
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
            snoozeRepeatLimit = draft.snoozeRepeatLimit,
            snoozeCount = 0,
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
            voiceRandomPrompt = draft.voiceRandomPrompt,
            voiceRandomContext = draft.voiceRandomContext,
            voiceWeatherCountry = draft.voiceWeatherCountry,
            voiceWeatherCity = draft.voiceWeatherCity,
            voiceFortuneGender = draft.voiceFortuneGender,
            voiceFortuneBirthDate = draft.voiceFortuneBirthDate,
            voiceFortuneBirthTime = draft.voiceFortuneBirthTime,
            dynamicVoicePreparedForFireAtMillis = draft.dynamicVoicePreparedForFireAtMillis
                ?: nextFireAt.takeIf { draft.voiceRandomPrompt && !draft.localAudioUri.isNullOrBlank() },
            voiceRepeat = draft.voiceRepeat,
            voiceVolumePercent = draft.voiceVolumePercent,
            ttsMessageId = draft.ttsMessageId,
            syncState = current.nextLocalSyncState(),
            alarmVolumePercent = draft.alarmVolumePercent,
            alarmSoundUri = draft.alarmSoundUri,
            alarmSoundLabel = draft.alarmSoundLabel,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            updatedAtMillis = now,
        )

        alarmScheduler.cancel(alarmId)
        alarmScheduler.schedule(updated)
        alarmDao.upsert(updated)
        // 갱신본 저장 후 충돌 알람 삭제 — 공유 audioCacheKey 음성 보존.
        conflict?.let { deleteAlarm(it.id) }
        Log.i(TAG, "Updated local alarm id=$alarmId enabled=${updated.enabled} fireAt=${updated.fireAtMillis}")
        return updated
    }

    suspend fun setEnabled(alarmId: String, enabled: Boolean): AlarmEntity {
        val current = requireNotNull(alarmDao.getById(alarmId)) { "Alarm not found." }
        val now = System.currentTimeMillis()
        alarmScheduler.cancel(alarmId)

        val updated = if (enabled) {
            val holidayPredicate = holidayCalendarStore.holidayPredicate(startDate = currentLocalDate(now))
            current.copy(
                fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                    hour = current.hour,
                    minute = current.minute,
                    repeatDaysMask = current.repeatDaysMask,
                    holidayOff = current.holidayOff,
                    nowMillis = now,
                    isHoliday = holidayPredicate,
                ),
                enabled = true,
                snoozeCount = 0,
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
        val cacheKey = current.audioCacheKey
        alarmDao.delete(current)
        alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, cacheKey)
        Log.i(TAG, "Deleted alarm id=$alarmId")
    }

    suspend fun deletePaidAlarmTalks(): Int {
        val targets = alarmDao.getAllAlarms().filter { alarm ->
            val usesVoice = alarm.playMode != AlarmPlayModes.ALARM_ONLY ||
                !alarm.localAudioUri.isNullOrBlank() ||
                !alarm.rawAudioUri.isNullOrBlank() ||
                !alarm.voiceProfileId.isNullOrBlank() ||
                !alarm.ttsMessageId.isNullOrBlank()
            // 시스템 스톡 보이스 TTS 알람은 무료 플랜에서도 유효하므로 보존한다.
            val stockVoiceOnly = alarm.localAudioUri.isNullOrBlank() &&
                alarm.rawAudioUri.isNullOrBlank() &&
                isSystemVoiceId(alarm.voiceProfileId)
            usesVoice && !stockVoiceOnly
        }
        targets.forEach { alarm ->
            alarmScheduler.cancel(alarm.id)
            val cacheKey = alarm.audioCacheKey
            alarmDao.delete(alarm)
            alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, cacheKey)
        }
        if (targets.isNotEmpty()) {
            Log.i(TAG, "Deleted paid voice alarms after free-plan downgrade count=${targets.size}")
        }
        return targets.size
    }

    suspend fun copyAlarm(alarmId: String): AlarmEntity {
        val current = requireNotNull(alarmDao.getById(alarmId)) { "Alarm not found." }
        val now = System.currentTimeMillis()
        val copiedTime = copyTargetTime(current.hour, current.minute)
        requireUniqueTime(copiedTime.hour, copiedTime.minute)
        val holidayPredicate = holidayCalendarStore.holidayPredicate(startDate = currentLocalDate(now))
        val copied = current.copy(
            id = UUID.randomUUID().toString(),
            label = current.label.takeIf { it.isNotBlank() }?.let { "$it 복사본" } ?: "복사한 알람",
            hour = copiedTime.hour,
            minute = copiedTime.minute,
            fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                hour = copiedTime.hour,
                minute = copiedTime.minute,
                repeatDaysMask = current.repeatDaysMask,
                holidayOff = current.holidayOff,
                nowMillis = now,
                isHoliday = holidayPredicate,
            ),
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            origin = AlarmOrigins.LOCAL_OWNED,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = now,
            updatedAtMillis = now,
        )
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
            val holidayPredicate = holidayCalendarStore.holidayPredicate(startDate = currentLocalDate(now))
            val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
                hour = current.hour,
                minute = current.minute,
                repeatDaysMask = current.repeatDaysMask,
                holidayOff = current.holidayOff,
                nowMillis = now,
                isHoliday = holidayPredicate,
            )
            val next = current.copy(
                fireAtMillis = nextFireAt,
                enabled = true,
                snoozeCount = 0,
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
        characterEvents.queue(
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
        if (
            current.snoozeRepeatLimit != SnoozeRepeatLimits.FOREVER &&
            current.snoozeCount >= current.snoozeRepeatLimit
        ) {
            Log.i(TAG, "Snooze ignored because repeat limit reached id=$alarmId")
            return null
        }

        val now = System.currentTimeMillis()
        val next = current.copy(
            fireAtMillis = now + current.snoozeMinutes * 60_000L,
            enabled = true,
            snoozeCount = current.snoozeCount + 1,
            state = AlarmStates.SNOOZED,
            updatedAtMillis = now,
        )
        alarmDao.upsert(next)
        alarmScheduler.schedule(next)
        characterEvents.queue(
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
                    val holidayPredicate = holidayCalendarStore.holidayPredicate(startDate = currentLocalDate(now))
                    alarm.copy(
                        fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                            hour = alarm.hour,
                            minute = alarm.minute,
                            repeatDaysMask = alarm.repeatDaysMask,
                            holidayOff = alarm.holidayOff,
                            nowMillis = now,
                            isHoliday = holidayPredicate,
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

    suspend fun syncWithBackend(api: AlarmTalkApi, token: String): AlarmSyncResult =
        alarmSyncService.syncWithBackend(api, token)

    suspend fun pullReceivedAlarms(
        api: AlarmTalkApi,
        token: String,
        myUserId: String,
    ): RemoteAlarmPullResult =
        remoteAlarmPullSyncService.pullReceivedAlarms(api, token, myUserId)

    suspend fun syncCharacterEvents(api: AlarmTalkApi, token: String): CharacterEventSyncResult =
        characterEventSyncService.sync(api, token)

    suspend fun refreshDueDynamicAlarmTalks(
        api: AlarmTalkApi,
        token: String,
        nowMillis: Long = System.currentTimeMillis(),
    ): Int {
        val alarms = alarmDao.getRepeatingDynamicAlarmTalks()
        var refreshed = 0
        alarms.forEach { alarm ->
            if (!shouldRefreshDynamicVoice(alarm, nowMillis)) return@forEach
            val profileId = alarm.voiceProfileId?.takeIf { it.isNotBlank() } ?: return@forEach
            runCatching {
                val response = api.generateTts(
                    authorization = AlarmTalkApiClient.bearer(token),
                    request = TtsGenerateRequest(
                        voiceProfileId = profileId,
                        text = "",
                        category = alarm.voiceCategory ?: randomTtsCategoryForContext(alarm.voiceRandomContext),
                        language = alarm.voiceLanguage ?: "ko",
                        random = true,
                        randomContext = alarm.voiceRandomContext ?: DefaultDynamicVoiceContext,
                        alarmHour = alarm.hour,
                        alarmMinute = alarm.minute,
                        weatherCountry = alarm.voiceWeatherCountry.trimmedOrNull(),
                        weatherCity = alarm.voiceWeatherCity.trimmedOrNull(),
                        fortuneGender = alarm.voiceFortuneGender.trimmedOrNull(),
                        fortuneBirthDate = alarm.voiceFortuneBirthDate.trimmedOrNull(),
                        fortuneBirthTime = alarm.voiceFortuneBirthTime.trimmedOrNull(),
                    ),
                )
                val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                val rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" }
                val cacheKey = AlarmAudioStore.ttsCacheKey(
                    profileId = profileId,
                    text = response.text,
                    category = alarm.voiceCategory ?: randomTtsCategoryForContext(response.randomContext),
                    language = alarm.voiceLanguage ?: "ko",
                    serverCacheKey = response.cacheKey,
                )
                val cachedAudio = alarmAudioStore.cacheGeneratedAudio(
                    bytes = audioBytes,
                    format = response.audioFormat,
                    rawAudioUri = rawAudioUri,
                    cacheKey = cacheKey,
                    messageId = response.messageId,
                )
                val oldCacheKey = alarm.audioCacheKey
                alarmDao.updateDynamicVoiceAudio(
                    id = alarm.id,
                    localAudioUri = cachedAudio.localAudioUri,
                    audioCacheKey = cachedAudio.cacheKey,
                    rawAudioUri = rawAudioUri,
                    voiceText = response.text,
                    ttsMessageId = response.messageId,
                    preparedForFireAtMillis = alarm.fireAtMillis,
                    updatedAtMillis = System.currentTimeMillis(),
                )
                // 랜덤 문구 알람이 새 음성으로 교체됐으면 이전 캐시는 미참조일 때만 정리.
                if (!oldCacheKey.isNullOrBlank() && oldCacheKey != cachedAudio.cacheKey) {
                    alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, oldCacheKey)
                }
                refreshed += 1
                Log.i(TAG, "Refreshed dynamic voice alarm id=${alarm.id} fireAt=${alarm.fireAtMillis}")
            }.onFailure { error ->
                Log.w(TAG, "Failed to refresh dynamic voice alarm id=${alarm.id}", error)
            }
        }
        return refreshed
    }

    /**
     * 어떤 알람도 참조하지 않고 30일 넘게 손대지 않은 캐시 음성 파일을 정리한다.
     * 앱 시작 시 백그라운드에서 1회 호출되는 것을 전제로 한다.
     */
    suspend fun sweepStaleAudioCache(): Int {
        val inUseFileNames = buildSet {
            alarmDao.getAllAlarms().forEach { alarm ->
                alarm.audioCacheKey?.takeIf { it.isNotBlank() }?.let { cacheKey ->
                    add(AlarmAudioStore.safeCacheKey(cacheKey))
                }
                // audioCacheKey 없이 localAudioUri 만 가진 구버전 알람의 파일도 보존한다.
                alarm.localAudioUri?.takeIf { it.isNotBlank() }?.let { uriString ->
                    val path = runCatching { android.net.Uri.parse(uriString).path }.getOrNull()
                    if (!path.isNullOrBlank()) add(java.io.File(path).nameWithoutExtension)
                }
            }
        }
        return alarmAudioStore.sweepStaleCache(inUseFileNames)
    }

    private fun validateDraft(draft: AlarmDraft) {
        require(draft.hour in 0..23) { "Hour must be between 0 and 23." }
        require(draft.minute in 0..59) { "Minute must be between 0 and 59." }
        require(draft.repeatDaysMask in 0..0x7f) { "Repeat days mask must only use Sunday through Saturday bits." }
        require(draft.snoozeMinutes in 1..30) { "Snooze must be between 1 and 30 minutes." }
        require(draft.snoozeRepeatLimit in SnoozeRepeatLimits.all) { "Unknown snooze repeat limit." }
        require(draft.alarmVolumePercent in 0..100) { "Alarm volume must be between 0 and 100." }
        require(draft.voiceVolumePercent in 0..100) { "Voice volume must be between 0 and 100." }
        require(draft.vibrationPattern in VibrationPatterns.all) { "Unknown vibration pattern." }
        require(draft.playMode in AlarmPlayModes.all) { "Unknown play mode." }
        require(draft.voiceSource in VoiceSources.all) { "Unknown voice source." }
        if (draft.playMode != AlarmPlayModes.ALARM_ONLY) {
            require(!draft.localAudioUri.isNullOrBlank()) { "Voice audio must be cached before saving this alarm." }
        }
    }

    private suspend fun requireUniqueTime(hour: Int, minute: Int, excludeAlarmId: String? = null) {
        require(alarmDao.countAtTime(hour, minute, excludeAlarmId) == 0) {
            "이미 같은 시간에 알람이 있어요. 다른 시간을 선택해 주세요."
        }
    }

    /**
     * "한 시각에는 알람 하나" 정책. 같은 시각의 기존 알람을 찾는다.
     *  - replaceExisting=false → [DuplicateAlarmTimeException] 을 던져 호출부(UI)가
     *    교체 여부를 사용자에게 모달로 묻게 한다.
     *  - replaceExisting=true  → 충돌 알람을 반환한다. 단, 삭제는 호출부가 새 알람을
     *    저장한 '이후'에 [deleteAlarm] 으로 해야 한다. 새 알람보다 먼저 삭제하면,
     *    새 알람이 같은 audioCacheKey(음성)를 재사용할 때 그 캐시의 마지막 참조로
     *    간주돼 음성 파일이 지워지고 → 새 알람이 깨진 경로를 가리키게 된다.
     */
    private suspend fun findReplaceableConflict(
        hour: Int,
        minute: Int,
        excludeAlarmId: String?,
        replaceExisting: Boolean,
    ): AlarmEntity? {
        val existing = alarmDao.findAtTime(hour, minute, excludeAlarmId) ?: return null
        if (!replaceExisting) {
            throw DuplicateAlarmTimeException(
                existingAlarmId = existing.id,
                hour = hour,
                minute = minute,
                existingLabel = existing.label,
            )
        }
        return existing
    }

    private fun copyTargetTime(hour: Int, minute: Int): java.time.LocalTime =
        java.time.LocalTime.of(hour, minute).plusMinutes(10)

    private fun currentLocalDate(nowMillis: Long): java.time.LocalDate =
        Instant.ofEpochMilli(nowMillis)
            .atZone(ZoneId.systemDefault())
            .toLocalDate()

    private fun shouldRefreshDynamicVoice(alarm: AlarmEntity, nowMillis: Long): Boolean {
        if (alarm.dynamicVoicePreparedForFireAtMillis == alarm.fireAtMillis) return false
        val zoneId = ZoneId.systemDefault()
        val fireAt = Instant.ofEpochMilli(alarm.fireAtMillis).atZone(zoneId)
        val prepareAtMillis = fireAt
            .toLocalDate()
            .minusDays(1)
            .atTime(DynamicVoicePrepareTime)
            .atZone(zoneId)
            .toInstant()
            .toEpochMilli()
        val latestPrepareMillis = alarm.fireAtMillis - 60_000L
        return nowMillis >= prepareAtMillis && nowMillis < latestPrepareMillis
    }

    private fun randomTtsCategoryForContext(context: String?): String =
        when (context) {
            "meal" -> "lunch"
            "sleep" -> "night"
            "exercise" -> "health"
            "love" -> "love"
            else -> "morning"
        }

    private fun AlarmEntity.nextLocalSyncState(): String =
        when {
            origin == AlarmOrigins.RECEIVED_REMOTE -> AlarmSyncStates.SYNCED
            remoteAlarmId == null -> AlarmSyncStates.LOCAL_ONLY
            else -> AlarmSyncStates.DIRTY
        }

    private companion object {
        const val DefaultDynamicVoiceContext = "wake_weather"
        val DynamicVoicePrepareTime: LocalTime = LocalTime.of(22, 0)
    }
}

/**
 * 같은 시각에 이미 알람이 있어 생성/수정이 거부될 때 발생. UI는 이를 잡아 사용자에게
 * 교체 여부를 모달로 물은 뒤, 동의 시 replaceExisting=true 로 재시도한다.
 */
class DuplicateAlarmTimeException(
    val existingAlarmId: String,
    val hour: Int,
    val minute: Int,
    val existingLabel: String?,
) : Exception("이미 ${"%02d:%02d".format(hour, minute)} 에 알람이 있어요.")
