package com.alarmtalk.app.data

import android.content.Context
import android.util.Base64
import android.util.Log
import com.alarmtalk.app.R
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.sync.DynamicVoiceRefreshScheduler
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.HolidayApi
import com.alarmtalk.app.network.toPublicHolidayDates
import com.alarmtalk.app.network.trimmedOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first

class AlarmRepository(
    private val alarmDao: AlarmDao,
    private val holidayCalendarStore: HolidayCalendarStore,
    private val holidayCountryPreferenceStore: HolidayCountryPreferenceStore,
    private val alarmScheduler: AlarmScheduler,
    private val alarmAudioStore: AlarmAudioStore,
    private val context: Context,
    // /holiday 는 인증이 필요 없어 토큰 없이 새 클라이언트를 생성한다(다른 워커와 동일).
    private val holidayApiProvider: () -> HolidayApi = { AlarmTalkApiClient.create() },
) {
    private val alarmSyncService = AlarmSyncService(alarmDao)
    private val remoteAlarmPullSyncService = RemoteAlarmPullSyncService(
        alarmDao = alarmDao,
        alarmScheduler = alarmScheduler,
        alarmAudioStore = alarmAudioStore,
        context = context,
    )

    fun observeAlarms(): Flow<List<AlarmEntity>> = alarmDao.observeAlarms()

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
            label = context.getString(R.string.rd_test_alarm_label),
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
            voiceListenerTitle = null,
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
        val holidayPredicate = holidayCalendarStore.holidayPredicate(
            countryCode = currentHolidayCountry(),
            startDate = currentLocalDate(now),
        )
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
            label = draft.label.trim().ifBlank { context.getString(R.string.rd_default_alarm_label) },
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
            voiceListenerTitle = draft.voiceListenerTitle,
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
            bucketId = draft.bucketId,
            bucketRotationIndex = 0,
            bucketClipKeysJson = draft.bucketClipKeysJson,
            bucketClipTextsJson = draft.bucketClipTextsJson,
            contextVariantIndex = draft.contextVariantIndex,
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
        // 반복 랜덤 문구 알람이면 동적 음성 갱신 워커를 예약한다.
        ensureDynamicVoiceRefreshScheduled(alarm)
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
        val holidayPredicate = holidayCalendarStore.holidayPredicate(
            countryCode = currentHolidayCountry(),
            startDate = currentLocalDate(now),
        )
        val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
            hour = draft.hour,
            minute = draft.minute,
            repeatDaysMask = draft.repeatDaysMask,
            holidayOff = draft.holidayOff,
            nowMillis = now,
            isHoliday = holidayPredicate,
        )
        val resetWeatherVariant = shouldResetWeatherVariant(
            currentBucketId = current.bucketId,
            nextBucketId = draft.bucketId,
            currentVoiceProfileId = current.voiceProfileId,
            nextVoiceProfileId = draft.voiceProfileId,
            currentCountry = current.voiceWeatherCountry,
            nextCountry = draft.voiceWeatherCountry,
            currentCity = current.voiceWeatherCity,
            nextCity = draft.voiceWeatherCity,
            currentFireAtMillis = current.fireAtMillis,
            nextFireAtMillis = nextFireAt,
        )
        val weatherVariantState = nextWeatherVariantState(
            nextBucketId = draft.bucketId,
            resetWeatherVariant = resetWeatherVariant,
            currentIndex = current.contextVariantIndex,
            draftIndex = draft.contextVariantIndex,
            currentResolvedAtMillis = current.contextResolvedAtMillis,
        )
        val updated = current.copy(
            label = draft.label.trim().ifBlank { context.getString(R.string.rd_default_alarm_label) },
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
            voiceListenerTitle = draft.voiceListenerTitle,
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
            bucketId = draft.bucketId,
            // 같은 버킷이면 회전 위치 유지, 버킷이 바뀌었으면(또는 해제) 0 으로 리셋.
            bucketRotationIndex =
                if (draft.bucketId != null && draft.bucketId == current.bucketId) current.bucketRotationIndex else 0,
            bucketClipKeysJson = draft.bucketClipKeysJson,
            bucketClipTextsJson = draft.bucketClipTextsJson,
            contextVariantIndex = weatherVariantState.index,
            contextResolvedAtMillis = weatherVariantState.resolvedAtMillis,
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
        // 전체행 upsert 대신 서버 발급 필드(remoteAlarmId/lastSyncedAtMillis) 보존 커밋을 쓴다.
        // getById 스냅샷(remoteAlarmId=null)을 여러 suspend 지점 뒤에 그대로 되쓰면, 그 사이
        // sync 가 방금 커밋한 remoteAlarmId 를 stale null 로 덮어 → 다음 sync 가 중복 create 로 재진입.
        alarmDao.upsertPreservingServerSyncFields(updated)
        // 갱신본 저장 후 충돌 알람 삭제 — 공유 audioCacheKey 음성 보존.
        conflict?.let { deleteAlarm(it.id) }
        // 수정으로 반복 랜덤 문구 알람이 됐을 수 있으니 동적 음성 갱신 워커를 재예약한다.
        ensureDynamicVoiceRefreshScheduled(updated)
        Log.i(TAG, "Updated local alarm id=$alarmId enabled=${updated.enabled} fireAt=${updated.fireAtMillis}")
        return updated
    }

    suspend fun setEnabled(alarmId: String, enabled: Boolean): AlarmEntity {
        val current = requireNotNull(alarmDao.getById(alarmId)) { "Alarm not found." }
        val now = System.currentTimeMillis()
        alarmScheduler.cancel(alarmId)

        val updated = if (enabled) {
            val holidayPredicate = holidayCalendarStore.holidayPredicate(
                countryCode = currentHolidayCountry(),
                startDate = currentLocalDate(now),
            )
            val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
                hour = current.hour,
                minute = current.minute,
                repeatDaysMask = current.repeatDaysMask,
                holidayOff = current.holidayOff,
                nowMillis = now,
                isHoliday = holidayPredicate,
            )
            // 재활성화로 다음 발사 날짜가 바뀌면 날씨 variant 를 무효화(이전 날짜 조건이 12h 게이트 동안
            // 남아 오재생되는 것 방지). 버킷/보이스/위치는 안 바뀌므로 사실상 날짜 변경만 반영된다.
            val resetWeatherVariant = shouldResetWeatherVariant(
                currentBucketId = current.bucketId,
                nextBucketId = current.bucketId,
                currentVoiceProfileId = current.voiceProfileId,
                nextVoiceProfileId = current.voiceProfileId,
                currentCountry = current.voiceWeatherCountry,
                nextCountry = current.voiceWeatherCountry,
                currentCity = current.voiceWeatherCity,
                nextCity = current.voiceWeatherCity,
                currentFireAtMillis = current.fireAtMillis,
                nextFireAtMillis = nextFireAt,
            )
            current.copy(
                fireAtMillis = nextFireAt,
                enabled = true,
                snoozeCount = 0,
                state = AlarmStates.SCHEDULED,
                syncState = current.nextLocalSyncState(),
                contextVariantIndex = if (resetWeatherVariant) null else current.contextVariantIndex,
                contextResolvedAtMillis = if (resetWeatherVariant) null else current.contextResolvedAtMillis,
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
        // updateAlarm 과 동일: sync 왕복 중 토글이 겹칠 때 remoteAlarmId 를 stale null 로 덮지 않도록
        // 서버 발급 필드 보존 커밋을 쓴다(전체행 upsert 금지).
        alarmDao.upsertPreservingServerSyncFields(updated)
        // 활성화된 반복 랜덤 문구 알람이면 동적 음성 갱신 워커를 예약한다.
        if (enabled) ensureDynamicVoiceRefreshScheduled(updated)
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

    /**
     * 접근권을 잃은 음성 프로필(공유 해제·제공자 취소·본인 삭제)을 참조하는 '내 소유(LOCAL_OWNED)'
     * 음성 알람을 sound-only 로 강등한다. [accessibleVoiceIds] 는 방금 '신선하게' 로드한 내 프로필 +
     * 가족 공유 프로필 id 집합이어야 한다 — 부분/실패 로드로 호출하면 정상 알람을 오강등할 수 있으므로
     * 호출부(refreshSocial 신선 성공)에서 가드한다. 버킷 회전·녹음(LOCAL_AUDIO)·수신 알람은 대상이 아니다.
     * 반환값은 강등된 알람 수.
     */
    suspend fun degradeAlarmsWithInaccessibleVoice(accessibleVoiceIds: Set<String>): Int {
        val candidates = alarmDao.getAllAlarms().filter { alarm ->
            alarm.origin == AlarmOrigins.LOCAL_OWNED &&
                alarm.voiceSource == VoiceSources.TTS_PROFILE &&
                !alarm.voiceProfileId.isNullOrBlank() &&
                // 시스템 스톡 버킷/보이스는 영구라 보존. 클론(비-system) 보이스는 단일클립·버킷 모두
                // 접근권 상실(공유해제·제공자취소·삭제) 시 강등 대상.
                !isSystemVoiceId(alarm.voiceProfileId) &&
                alarm.voiceProfileId !in accessibleVoiceIds
        }
        var degraded = 0
        for (current in candidates) {
            val cacheKey = current.audioCacheKey
            val updated = current.copy(
                playMode = AlarmPlayModes.ALARM_ONLY,
                voiceSource = VoiceSources.LOCAL_AUDIO,
                voiceProfileId = null,
                localAudioUri = null,
                audioCacheKey = null,
                rawAudioUri = null,
                ttsMessageId = null,
                voiceText = null,
                voiceListenerTitle = null,
                voiceCategory = null,
                voiceLanguage = null,
                voiceRandomPrompt = false,
                // 클론 버킷 알람도 여기서 강등되므로 버킷 상태를 함께 비운다(존재하지 않는 클립/캐시 참조 방지).
                bucketId = null,
                bucketClipKeysJson = null,
                bucketRotationIndex = 0,
                contextVariantIndex = null,
                // 서버 알람은 이미 P0-1/P0-2(취소·un-share·목소리 삭제) 경로에서 sound-only 로 강등되므로,
                // 이 로컬 정리는 push 하지 않는다(SYNCED). 기본 Gson 은 null 필드를 PATCH 에서 누락시켜
                // 서버 voice 참조를 못 지우고 오히려 stale 상태를 만들 수 있어(PR #536 P2), 로컬 캐시만 정리.
                syncState = AlarmSyncStates.SYNCED,
                updatedAtMillis = System.currentTimeMillis(),
            )
            if (updated.enabled) alarmScheduler.schedule(updated)
            alarmDao.upsertPreservingServerSyncFields(updated)
            alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, cacheKey)
            degraded++
            Log.i(TAG, "Degraded alarm id=${current.id}: voice ${current.voiceProfileId} no longer accessible")
        }
        return degraded
    }

    /**
     * 보이스 클론 업로드에 성공한 직후, 더 이상 필요 없는 로컬 녹음 샘플(음성 생체정보)을 즉시 지운다.
     * 클론 소스 녹음은 알람 재생 오디오가 아니라 업로드 전용이므로, 어떤 알람도 같은 캐시키를
     * 참조하지 않을 때만(즉 재생용으로 공유되지 않을 때만) 실제 파일을 삭제한다.
     * 평문 .m4a 가 filesDir 에 오래 남지 않게 해 단말 분실/포렌식 시 노출 위험을 줄인다.
     */
    suspend fun deleteVoiceCloneSourceRecording(cacheKey: String?) {
        if (cacheKey.isNullOrBlank()) return
        alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, cacheKey)
    }

    suspend fun deletePaidAlarmTalks(): Int {
        val targets = alarmDao.getAllAlarms().filter { alarm ->
            val usesVoice = alarm.playMode != AlarmPlayModes.ALARM_ONLY ||
                !alarm.localAudioUri.isNullOrBlank() ||
                !alarm.rawAudioUri.isNullOrBlank() ||
                !alarm.voiceProfileId.isNullOrBlank() ||
                !alarm.ttsMessageId.isNullOrBlank()
            usesVoice && !alarm.usesFreeSystemVoiceAlarm()
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
        val holidayPredicate = holidayCalendarStore.holidayPredicate(
            countryCode = currentHolidayCountry(),
            startDate = currentLocalDate(now),
        )
        val copied = current.copy(
            id = UUID.randomUUID().toString(),
            label = current.label.takeIf { it.isNotBlank() }
                ?.let { context.getString(R.string.rd_copied_alarm_label_suffix, it) }
                ?: context.getString(R.string.rd_copied_alarm_label),
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
            val holidayPredicate = holidayCalendarStore.holidayPredicate(
                countryCode = currentHolidayCountry(),
                startDate = currentLocalDate(now),
            )
            val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
                hour = current.hour,
                minute = current.minute,
                repeatDaysMask = current.repeatDaysMask,
                holidayOff = current.holidayOff,
                nowMillis = now,
                isHoliday = holidayPredicate,
            )
            // 반복 날씨 알람은 dismiss 로 다음 발생(=다른 날짜)으로 넘어가면 이전 날짜로 resolve 된
            // contextVariantIndex 가 fresh 타임스탬프째 남아, 준비창 워커가 12h 게이트로 재resolve 를 건너뛴다.
            // 그 사이 오프라인이면 어제 날씨 클립을 재생 → 편집/재활성화와 동일 기준(shouldResetWeatherVariant,
            // 날짜 변경 감지)으로 롤오버 시 무효화해 새 날짜로 재resolve 하게 한다.
            val resetWeatherVariant = shouldResetWeatherVariant(
                currentBucketId = current.bucketId,
                nextBucketId = current.bucketId,
                currentVoiceProfileId = current.voiceProfileId,
                nextVoiceProfileId = current.voiceProfileId,
                currentCountry = current.voiceWeatherCountry,
                nextCountry = current.voiceWeatherCountry,
                currentCity = current.voiceWeatherCity,
                nextCity = current.voiceWeatherCity,
                currentFireAtMillis = current.fireAtMillis,
                nextFireAtMillis = nextFireAt,
            )
            val next = current.copy(
                fireAtMillis = nextFireAt,
                enabled = true,
                snoozeCount = 0,
                // 에피소드 종료(dismiss) 시 다음 회전 클립으로 +1. 스누즈는 회전하지 않으므로
                // 같은 에피소드 내 모든 울림은 동일 클립을 재생한다.
                bucketRotationIndex = advancedBucketRotationIndex(current),
                contextVariantIndex = if (resetWeatherVariant) null else current.contextVariantIndex,
                contextResolvedAtMillis =
                    if (resetWeatherVariant) null else current.contextResolvedAtMillis,
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
        Log.i(TAG, "Alarm snoozed id=$alarmId minutes=${current.snoozeMinutes} nextFireAt=${next.fireAtMillis}")
        return next
    }

    fun resolveBucketClipSelection(alarm: AlarmEntity): BucketClipSelection? {
        val keys = alarm.bucketClipKeys()
        if (alarm.bucketId == null || keys.isEmpty()) return null
        val preferredIndex = alarm.bucketVariantIndex() ?: return null
        alarmAudioStore.getCachedAudio(keys[preferredIndex])?.let { audio ->
            return BucketClipSelection(preferredIndex, audio.localAudioUri)
        }
        for ((index, key) in keys.withIndex()) {
            alarmAudioStore.getCachedAudio(key)?.let { audio ->
                return BucketClipSelection(index, audio.localAudioUri)
            }
        }
        return null
    }

    fun resolveBucketClipLocalUri(alarm: AlarmEntity): String? =
        resolveBucketClipSelection(alarm)?.localAudioUri

    /**
     * dismiss(에피소드 종료) 시 다음 회전 인덱스. 버킷이 아니거나 클립 1개 이하면 그대로.
     * 매칭형(날씨/운세)은 조건/테마 인덱스로 고르므로 회전을 전진시키지 않는다.
     */
    private fun advancedBucketRotationIndex(alarm: AlarmEntity): Int {
        val size = alarm.bucketClipKeys().size
        if (alarm.bucketId == null || size <= 1) return alarm.bucketRotationIndex
        if (alarm.bucketId in MATCHING_BUCKET_IDS) return alarm.bucketRotationIndex
        return (alarm.bucketRotationIndex + 1) % size
    }

    suspend fun reschedulePendingAlarms(recomputeFireTime: Boolean = false): Int {
        val now = System.currentTimeMillis()
        val enabledAlarms = alarmDao.getEnabledAlarms()
        val holidayPredicate = holidayCalendarStore.holidayPredicate(
            countryCode = currentHolidayCountry(),
            startDate = currentLocalDate(now),
        )
        var scheduled = 0

        enabledAlarms.forEach { alarm ->
            runCatching {
                // recomputeFireTime: 시간대/시스템 시각 변경 시, 저장된 fireAtMillis(과거 기준 절대시각)를
                // hour/minute 으로 다시 계산해 새 벽시계 시각에 울리게 한다(여행/DST). 그 외(부팅 등)에는
                // 미래 알람은 그대로 두고 과거(놓친) 알람만 재계산/정리한다.
                // 스누즈 알람은 enabled=true 이고 fireAtMillis 가 "스누즈 마감(절대시각)"이라
                // 재계산에서 제외한다 — 그러지 않으면 tz/시각 변경 시 스누즈가 다음 정규 발생으로 밀린다.
                val isSnoozed = alarm.state == AlarmStates.SNOOZED
                val needsRecompute = !isSnoozed && (recomputeFireTime || alarm.fireAtMillis <= now)
                val alarmToSchedule = when {
                    !needsRecompute -> alarm
                    alarm.repeatDaysMask != 0 || recomputeFireTime -> alarm.copy(
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
                    else -> {
                        alarm.copy(
                            enabled = false,
                            state = AlarmStates.FAILED,
                            updatedAtMillis = now,
                        ).also { alarmDao.upsert(it) }
                        return@forEach
                    }
                }

                alarmScheduler.schedule(alarmToSchedule)
                scheduled += 1
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to restore alarm id=${alarm.id}", error)
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
    ): RemoteAlarmPullResult =
        remoteAlarmPullSyncService.pullReceivedAlarms(api, token)

    /**
     * 사전렌더 '날씨' 버킷 알람의 조건 인덱스를 서버로 resolve 해 contextVariantIndex 를 갱신한다.
     * 저장 위치로 서버가 실시간 날씨(open-meteo)를 판정→CLONE_WEATHER_CONDITIONS 순서 인덱스를 반환.
     * 발사는 그 인덱스로 오프라인 lookup. 준비창 워커가 매일(반복 알람 전날) + 저장 직후(runOnce)
     * 호출한다. 항상 동작(오프라인 날씨 매칭 전용).
     */
    suspend fun resolveDueCloneBucketVariants(api: AlarmTalkApi, token: String): Int {
        val now = System.currentTimeMillis()
        // 준비창 게이트: open-meteo 는 하루 예보라 시간마다 갱신은 무의미하고 쿼터·배터리만 낭비한다.
        // 아직 미해결(null)이거나 마지막 갱신이 ~12h 이전인 알람만 대상으로 삼아 최대 하루 1~2회로 제한.
        val staleBefore = now - 12 * 60 * 60 * 1000L
        // 준비창: 곧(48h 내) 울릴 알람만 대상. open-meteo 는 '오늘' 예보라, 며칠 뒤 울릴 알람을 지금
        // 오늘 날씨로 스냅샷하면 엉뚱한 조건이 굳는다. 반복 알람의 다음 발사(fireAtMillis)는 보통 창 안이고,
        // 먼 일회성/주간 알람은 발사 48h 전에야 해결돼 더 신선한 날씨로 매칭된다.
        val prepareWindow = now + 48 * 60 * 60 * 1000L
        val alarms = alarmDao.getEnabledWeatherBucketAlarms()
            .filter { it.fireAtMillis <= prepareWindow }
            .filter { it.contextVariantIndex == null || (it.contextResolvedAtMillis ?: 0L) < staleBefore }
        if (alarms.isEmpty()) return 0
        // 같은 (국가·도시)는 1회만 호출(open-meteo 중복 요청·배터리·쿼터 절약).
        val zone = java.time.ZoneId.systemDefault()
        val byLocationAndDate = alarms.groupBy {
            Triple(
                it.voiceWeatherCountry?.trim().orEmpty() to it.voiceWeatherCity?.trim().orEmpty(),
                java.time.Instant.ofEpochMilli(it.fireAtMillis).atZone(zone).toLocalDate().toString(),
                zone.id,
            )
        }
        var resolved = 0
        for ((locationAndDate, group) in byLocationAndDate) {
            val (location, targetDate, timezone) = locationAndDate
            val (country, city) = location
            // variant 는 이 타깃 날짜로 resolve 된다. 네트워크 왕복 중 알람의 발사 날짜가 바뀌면(편집)
            // 아래 DAO 가드가 옛 결과를 거른다. 경계는 resolver 와 동일 존 기준 [자정, 다음날 자정).
            val targetLocalDate = java.time.LocalDate.parse(targetDate)
            val fireDateStartMillis = targetLocalDate.atStartOfDay(zone).toInstant().toEpochMilli()
            val fireDateEndMillis = targetLocalDate.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
            val index = runCatching {
                api.getPrerenderVariant(
                    authorization = AlarmTalkApiClient.bearer(token),
                    context = "wake_weather",
                    country = country.takeIf { it.isNotBlank() },
                    city = city.takeIf { it.isNotBlank() },
                    targetDate = targetDate,
                    timezone = timezone,
                ).variantIndex
            }.getOrElse { error ->
                Log.w(TAG, "Failed to resolve weather variant", error)
                null
            }
            // 조회 실패(null)면 '맑음(0)'으로 덮어쓰지 않고 기존 인덱스를 유지한다.
            if (index == null) continue
            for (alarm in group) {
                // 인덱스가 그대로여도 resolvedAt 은 무조건 갱신해 12h 게이트를 전진시킨다. (change 일 때만
                // 갱신하면 안정 날씨는 시계가 안 올라가 매 워커틱마다 open-meteo 재호출 → 배터리·쿼터 낭비.)
                val updatedRows = alarmDao.updateContextVariantIndexIfContextMatches(
                    id = alarm.id,
                    index = index,
                    resolvedAtMillis = System.currentTimeMillis(),
                    voiceProfileId = alarm.voiceProfileId.orEmpty(),
                    country = alarm.voiceWeatherCountry?.trim().orEmpty(),
                    city = alarm.voiceWeatherCity?.trim().orEmpty(),
                    fireDateStartMillis = fireDateStartMillis,
                    fireDateEndMillis = fireDateEndMillis,
                )
                if (updatedRows > 0 && index != alarm.contextVariantIndex) resolved += 1
            }
        }
        if (resolved > 0) Log.i(TAG, "Resolved weather bucket variants count=$resolved")
        return resolved
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
                // 버킷 회전 알람이 미리 캐시해 둔 N개 클립이 sweep 으로 지워지지 않도록 보존한다.
                alarm.bucketClipKeys().forEach { key ->
                    add(AlarmAudioStore.safeCacheKey(key))
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
            context.getString(R.string.rd_duplicate_alarm_time_message)
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

    /** 앱 전역 공휴일 달력 국가(알람별 아님). 모든 holidayPredicate 호출이 이를 사용한다. */
    private suspend fun currentHolidayCountry(): String =
        holidayCountryPreferenceStore.countryCode.first()

    /**
     * 비-KR 국가의 공휴일을 서버(/holiday)에서 받아 로컬 캐시에 채운다. 근접 윈도우에 이미
     * 행이 있으면 네트워크를 건너뛴다. KR 은 온디바이스 엔진이 있어 동기화하지 않는다.
     * Best-effort — 네트워크 오류는 삼키고 조용히 실패한다(공휴일 표시는 부가 기능).
     */
    suspend fun ensureHolidaysSynced(countryCode: String) {
        val normalized = countryCode.trim().uppercase()
        if (normalized.isEmpty() || normalized == HolidayCalendarStore.DEFAULT_COUNTRY_CODE) return
        runCatching {
            val today = currentLocalDate(System.currentTimeMillis())
            val existing = holidayCalendarStore.upcomingHolidays(
                countryCode = normalized,
                from = today,
                count = 1,
            )
            if (existing.isNotEmpty()) return
            val from = today
            val to = today.plusYears(1)
            // iOS 와 동일하게 기기 UI 언어(ISO-639-1)를 보내 비-KR 공휴일 이름을 같은 로케일로 받는다.
            val lang = Locale.getDefault().language.lowercase().ifBlank { null }
            val response = holidayApiProvider().getHolidays(
                country = normalized,
                from = from.toString(),
                to = to.toString(),
                lang = lang,
            )
            val holidays = response.toPublicHolidayDates()
            if (holidays.isNotEmpty()) {
                holidayCalendarStore.syncFromRemote(
                    countryCode = normalized,
                    holidays = holidays,
                )
            }
        }.onFailure { error ->
            Log.w(TAG, "Failed to sync holidays for country=$countryCode", error)
        }
    }

    /** 토글 아래 표시할 다가오는 공휴일 목록(선택 국가 기준, 기본 5개). */
    suspend fun upcomingHolidays(
        countryCode: String,
        from: LocalDate = currentLocalDate(System.currentTimeMillis()),
        count: Int = 5,
    ): List<HolidayDate> =
        holidayCalendarStore.upcomingHolidays(
            countryCode = countryCode,
            from = from,
            count = count,
        )

    /**
     * 반복 랜덤 문구 알람은 매번 새 음성으로 갱신돼야 한다. 알람 생성/수정/활성화 시
     * 이 메서드를 호출해 DynamicVoiceRefreshWorker(WorkManager)를 예약한다.
     * 이 wiring 이 없으면 반복 동적 알람이 과거에 캐시된 동일 음성만 재생한다.
     */
    private fun ensureDynamicVoiceRefreshScheduled(alarm: AlarmEntity) {
        // 사전렌더 '날씨' 버킷 알람이면 준비창 워커를 예약한다. 저장 직후 runOnce 로 조건 인덱스를
        // 즉시 resolve 하고, ensurePeriodic 로 반복 알람의 매일 전날 갱신을 건다.
        val needsWorker = alarm.bucketId == "weather"
        if (!needsWorker) return
        runCatching {
            DynamicVoiceRefreshScheduler.ensurePeriodic(context)
            DynamicVoiceRefreshScheduler.runOnce(context)
            Log.i(TAG, "Scheduled voice refresh worker for alarm id=${alarm.id}")
        }.onFailure { error ->
            Log.w(TAG, "Failed to schedule voice refresh worker id=${alarm.id}", error)
        }
    }

    private fun AlarmEntity.nextLocalSyncState(): String =
        when {
            origin == AlarmOrigins.RECEIVED_REMOTE -> AlarmSyncStates.SYNCED
            remoteAlarmId == null -> AlarmSyncStates.LOCAL_ONLY
            else -> AlarmSyncStates.DIRTY
        }

    private companion object {
        // 발사 시 '조건/테마 매칭'으로 variant 를 고르는 버킷(그 외는 순차 회전). bucketId 는
        // 백엔드 category 와 동일 문자열이다(클론 사전렌더 category = 'weather'/'fortune').
        val MATCHING_BUCKET_IDS = setOf("weather", "fortune")
    }
}

data class BucketClipSelection(
    val variantIndex: Int,
    val localAudioUri: String,
)

internal fun shouldResetWeatherVariant(
    currentBucketId: String?,
    nextBucketId: String?,
    currentVoiceProfileId: String?,
    nextVoiceProfileId: String?,
    currentCountry: String?,
    nextCountry: String?,
    currentCity: String?,
    nextCity: String?,
    currentFireAtMillis: Long,
    nextFireAtMillis: Long,
    zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
): Boolean {
    val involvesWeather = currentBucketId == "weather" || nextBucketId == "weather"
    if (!involvesWeather) return false

    // 날씨 variant 는 특정 타깃 날짜(=fireAtMillis 의 로컬 날짜, resolveDueCloneBucketVariants 와 동일 존)로
    // resolve 된다. 보이스·위치가 그대로여도 다음 발사 날짜가 바뀌면(시간·반복 편집, 재활성화 등) 이전 날짜
    // 기준 조건이 12h 게이트 동안 남아 오재생되므로, 날짜가 바뀌면 무효화해 준비창 워커가 재resolve 하게 한다.
    val fireDateChanged =
        java.time.Instant.ofEpochMilli(currentFireAtMillis).atZone(zone).toLocalDate() !=
            java.time.Instant.ofEpochMilli(nextFireAtMillis).atZone(zone).toLocalDate()

    return currentBucketId != nextBucketId ||
        currentVoiceProfileId != nextVoiceProfileId ||
        currentCountry?.trim().orEmpty() != nextCountry?.trim().orEmpty() ||
        currentCity?.trim().orEmpty() != nextCity?.trim().orEmpty() ||
        fireDateChanged
}

internal data class WeatherVariantState(
    val index: Int?,
    val resolvedAtMillis: Long?,
)

internal fun nextWeatherVariantState(
    nextBucketId: String?,
    resetWeatherVariant: Boolean,
    currentIndex: Int?,
    draftIndex: Int?,
    currentResolvedAtMillis: Long?,
): WeatherVariantState = when {
    resetWeatherVariant -> WeatherVariantState(index = null, resolvedAtMillis = null)
    nextBucketId == "weather" -> WeatherVariantState(
        index = currentIndex,
        resolvedAtMillis = currentResolvedAtMillis,
    )
    else -> WeatherVariantState(index = draftIndex, resolvedAtMillis = null)
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
