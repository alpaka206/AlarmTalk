package com.alarmtalk.app.data

import android.content.Context
import android.util.Base64
import android.util.Log
import com.alarmtalk.app.R
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.alarm.RingingService
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map

class AlarmRepository(
    private val alarmDao: AlarmDao,
    private val holidayCalendarStore: HolidayCalendarStore,
    private val holidayCountryPreferenceStore: HolidayCountryPreferenceStore,
    private val alarmScheduler: AlarmScheduler,
    private val alarmAudioStore: AlarmAudioStore,
    private val context: Context,
    // /holiday 는 인증이 필요 없어 토큰 없이 새 클라이언트를 생성한다(다른 워커와 동일).
    private val holidayApiProvider: () -> HolidayApi = { AlarmTalkApiClient.create() },
    // 현재 로그인 계정 id(없으면 null). 알람 생성 시 소유자 기록·무료 잠금 스코프에 쓴다.
    private val currentUserIdProvider: () -> String? = { null },
    // 같은 값을 '흐름'으로도 받는다 — 목록 필터가 로그인/로그아웃 즉시 다시 계산돼야 한다.
    // 기본값은 1회 방출이라, 이 인자를 주지 않는 호출부(테스트 등)는 예전과 동작이 같다.
    private val currentUserIdFlow: Flow<String?> = flowOf(currentUserIdProvider()),
    // 아직 소유자를 못 새긴 알람의 임자(없으면 null). 세션이 끝날 때 새기기가 실패하면
    // 남고, 예약 직전에 [settlePendingAlarmOwnership] 이 이걸로 마저 새긴다.
    private val pendingOwnerUserIdProvider: () -> String? = { null },
    // 미정 행이 없어졌을 때만 임자 표시를 지운다. 실패하면 부르지 않아 표시가 남고,
    // 다음 기회에 다시 시도한다.
    private val onOwnershipSettled: () -> Unit = {},
    // 자동으로 세션이 끊긴(토큰 만료·폐기) 계정. 비로그인 상태에서 **이 계정 알람만** 되살린다.
    // 명시적 로그아웃은 이 값을 지우므로 그 계정 알람은 되살아나지 않는다.
    // 자세한 이유는 AuthSessionStore.sessionExpiredOwnerUserId 주석 참고.
    private val sessionExpiredOwnerUserIdProvider: () -> String? = { null },
    // 지금 실제로 울리는 중이거나 리시버→서비스 인계 중인 알람 id**들**(없으면 빈 집합).
    // 영속 상태(state=RINGING)가 아니라 이걸로 판정해야, 서비스가 죽어 굳어 버린 RINGING 행이
    // 복구에서 영구 배제되지 않는다. **하나가 아니라 집합인 이유**는
    // [RingingService.ringingOrHandingOffAlarmIds] 주석 참고 — 울리는 알람과 인계 중인 알람이
    // 서로 다를 수 있고, 하나만 보면 뒤엣것이 무방비가 된다.
    private val ringingAlarmIdsProvider: () -> Set<String> = { RingingService.ringingOrHandingOffAlarmIds() },
) {
    /**
     * 예약 복원과 예약 해제를 **서로 겹치지 않게** 한다.
     *
     * [reschedulePendingAlarms] 는 부팅 리시버·패키지 교체 리시버·15분 주기 워커·앱 시작·로그인
     * 뒤처리가 모두 부르고, [detachAlarmsOnSignOut] 은 사용자가 로그아웃할 때 부른다. 락이
     * 없으면 다음이 실제로 일어난다:
     *  - 워커가 목록을 뜨고 복원 대상을 읽은 직후 사용자가 로그아웃 → detach 가 예약을
     *    취소하지만 행은 enabled 로 남긴다 → 워커가 그 뒤에 다시 예약한다. 로그인 화면 뒤에서
     *    끌 수 없는 알람이 울린다(Codex #666 P1). 행이 꺼지지 않으므로 '쓰기 직전 재조회'
     *    로는 못 잡는다.
     *  - 시간대·시각 변경 리시버가 recomputeFireTime=true 로 도는 사이 주기 워커가 false 로
     *    돌면, 워커가 읽어 둔 옛 절대시각을 나중에 등록해 **DB 는 새 시각인데 OS 예약만 옛
     *    시각**이 된다(Codex #666 P2).
     *
     * 둘 다 "읽고 → 쓰는" 구간이 겹쳐서 생기므로, 그 구간 전체를 직렬화한다. 안에서 하는 일은
     * 로컬 DB 접근과 AlarmManager 호출뿐이라 오래 잡고 있지 않는다.
     *
     * **이 락은 '복원 대 로그아웃' 전용이 아니다.** 잡아야 하는 기준은 하나다 —
     * **행을 읽어 고치고 `alarmScheduler` 로 OS 예약까지 바꾸는 구간**이면 잡는다. 그런
     * 구간끼리 겹치면 나중에 쓰는 쪽이 상대의 결과를 통째로 덮는데, 덮인 쪽은 아무 흔적도
     * 남기지 않는다. 현재 대상: [reschedulePendingAlarms]·[detachAlarmsOnSignOut]·
     * [snooze]·[dismiss]·[lockPaidAlarmTalks]·[unlockPaidAlarmTalks]·
     * [degradeMatchingLocalOwnedVoiceAlarms].
     *
     * 특히 [snooze] 가 빠져 있으면 이렇게 샌다: 사용자가 스누즈를 누르면 소리는 즉시 멎고
     * '울리는 중' 표시도 즉시 풀리는데 DB 쓰기는 코루틴으로 뒤에 온다. 그 틈에 15분 주기
     * 정합성 워커가 그 행을 보면 '발화 시각이 지났는데 안 울리는 중' 이라 **다음 정규 발생
     * (내일)으로 재계산해 덮는다.** 5분 뒤 울려야 할 알람이 사라지고, 화면상으로는 내일로
     * 정상 예약돼 있어 사용자는 알 방법이 없다.
     *
     * 이 락은 이 클래스 밖으로도 나간다 — [RemoteAlarmPullSyncService] 가 받아서 자기
     * **로컬 변경 구간만** 잡는다. 서버 pull 은 알람을 끄고 지우고 시각을 옮기므로, 따로 놀면
     * 복원이 방금 취소된 알람의 옛 예약을 되심는다(Codex #666 P1). 그쪽은 네트워크(목록 조회·
     * 음성 다운로드)를 락 밖에 두므로 이 락이 오래 잡히지 않는다.
     *
     * Kotlin [Mutex] 는 재진입이 안 된다 — 위 함수들끼리 서로를 부르지 않는지 확인하고
     * 추가할 것. (지금은 [degradeAlarmsWithInaccessibleVoice]·[degradeAlarmsUsingVoiceProfile]
     * 이 공통 private 인 [degradeMatchingLocalOwnedVoiceAlarms] 한 곳으로만 들어가므로
     * 이중 획득이 없다. [pullReceivedAlarms] 도 이 락을 잡은 채로 불리지 않는다 — 잠금 순서는
     * 항상 pullMutex → restoreMutex 한 방향이라 순환이 없다.)
     */
    private val restoreMutex = Mutex()

    private val alarmSyncService = AlarmSyncService(alarmDao)
    private val remoteAlarmPullSyncService = RemoteAlarmPullSyncService(
        alarmDao = alarmDao,
        alarmScheduler = alarmScheduler,
        alarmAudioStore = alarmAudioStore,
        context = context,
        // 받은 알람에 수신자(현재 로그인 계정)를 소유자로 기록해 무료 잠금/복원을 스코프한다.
        currentUserIdProvider = currentUserIdProvider,
        // pull 의 로컬 변경 구간도 같은 락으로 묶는다 — 서버가 취소한 알람을 정합성 복원이
        // 되심는 것을 막는다([restoreMutex], Codex #666 P1).
        alarmMutationLock = restoreMutex,
    )

    /**
     * 이 계정에 보여줄 알람만 흘린다. 같은 기기에 다른 계정이 로그인하면 앞 계정 알람이
     * 목록에 그대로 남던 문제를 막는다(RemoteAlarmPullSyncService 가 '받은 알람'에 쓰는
     * 소유자 스코프와 같은 규칙). 소유자 미기록(레거시 null)은 현재 계정 것으로 본다 —
     * 세션이 끝날 때 떠나는 계정을 새기므로(명시 로그아웃은 detachAlarmsOnSignOut, 자동
     * 401 은 claimUnownedAlarmsFor) 다른 계정이 물려받을 null 이 새로 생기지 않는다.
     *
     * DAO 흐름만 map 하면 안 된다: Room 은 테이블이 바뀔 때만 방출하는데, 로그아웃은
     * 소유자가 이미 기록된 알람에 대해 아무것도 쓰지 않는다. 그러면 계정을 바꿔도
     * 마지막에 계산된 목록(앞 계정 알람)이 그대로 남는다 — 그래서 계정 흐름과 결합한다.
     */
    fun observeAlarms(): Flow<List<AlarmEntity>> =
        combine(alarmDao.observeAlarms(), currentUserIdFlow) { alarms, currentUser ->
            alarms.filter { it.ownerUserId == null || it.ownerUserId == currentUser }
        }

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
            ownerUserId = currentUserIdProvider(),
            alarmVolumePercent = 100,
            alarmSoundUri = null,
            alarmSoundLabel = null,
            alarmSoundEnabled = true,
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

    /**
     * 복원·정합성 워커, 그리고 **받은 알람 pull** 과 직렬화한다([restoreMutex]).
     * pull 은 '행 다시 읽기 → 재구성 → upsert + OS 재예약' 을 한 덩어리로 도는데, 저장이 그
     * 사이에 끼면 pull 이 방금 저장한 값을 옛 스냅샷으로 덮어쓴다(Codex #675 P1).
     */
    suspend fun createAlarm(draft: AlarmDraft, replaceExisting: Boolean = false): AlarmEntity = restoreMutex.withLock {
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
            ownerUserId = currentUserIdProvider(),
            alarmVolumePercent = draft.alarmVolumePercent,
            alarmSoundUri = draft.alarmSoundUri,
            alarmSoundLabel = draft.alarmSoundLabel,
            alarmSoundEnabled = draft.alarmSoundEnabled,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = now,
            updatedAtMillis = now,
        )

        alarmScheduler.schedule(alarm)
        alarmDao.upsert(alarm)
        // 새 알람을 저장한 뒤에 충돌 알람을 삭제해야, 둘이 같은 audioCacheKey 를
        // 공유할 때 캐시 음성이 보존된다(deleteAlarm 의 참조 카운트가 새 알람을 포함).
        conflict?.let { deleteAlarmLocked(it.id) }
        // 반복 랜덤 문구 알람이면 동적 음성 갱신 워커를 예약한다.
        ensureDynamicVoiceRefreshScheduled(alarm)
        Log.i(TAG, "Created local alarm id=${alarm.id} fireAt=${alarm.fireAtMillis}")
        alarm
    }

    /** 저장 경로를 pull·복원과 직렬화한다 — 이유는 [createAlarm] 주석과 같다(Codex #675 P1). */
    suspend fun updateAlarm(
        alarmId: String,
        draft: AlarmDraft,
        replaceExisting: Boolean = false,
    ): AlarmEntity = restoreMutex.withLock {
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
            draftResolvedNow = draft.contextResolvedNow,
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
            // 명시적 편집은 사용자의 최신 재생모드 의도를 확정하므로 무료 잠금 스냅샷을 비운다.
            // 안 그러면 잠긴 알람을 사운드온리로 편집·저장해도 옛 목소리 모드가 preLockPlayMode 에
            // 남아, 재구독 시 unlockPaidAlarmTalks 가 사용자의 편집을 덮어써 목소리로 되살린다.
            // 무료 상태로 남아 편집 결과가 여전히 유료 목소리면, 다음 앱 시작의 재잠금이 실제
            // playMode 기준으로 올바른 새 스냅샷을 다시 만든다.
            preLockPlayMode = null,
            syncState = current.nextLocalSyncState(),
            alarmVolumePercent = draft.alarmVolumePercent,
            alarmSoundUri = draft.alarmSoundUri,
            alarmSoundLabel = draft.alarmSoundLabel,
            alarmSoundEnabled = draft.alarmSoundEnabled,
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
        conflict?.let { deleteAlarmLocked(it.id) }
        // 수정으로 반복 랜덤 문구 알람이 됐을 수 있으니 동적 음성 갱신 워커를 재예약한다.
        ensureDynamicVoiceRefreshScheduled(updated)
        Log.i(TAG, "Updated local alarm id=$alarmId enabled=${updated.enabled} fireAt=${updated.fireAtMillis}")
        updated
    }

    /**
     * 복원·정합성 워커와 직렬화한다([restoreMutex]). 락이 없으면 워커가 "행 읽기 → 재계산 →
     * OS 재예약" 을 도는 사이에 이 함수가 끼어들어, 워커가 **방금 끈 알람의 옛 스냅샷**을
     * 그대로 다시 등록한다. 그러면 AlarmReceiver 가 Room 검증 전에 RingingService 를 띄우고
     * markRinging 이 행을 도로 켜서, 사용자가 끈 알람이 울린다(Codex #672 P1).
     * 워커 쪽 재조회(`fresh`)는 그 창을 좁힐 뿐 닫지 못한다 — 닫는 건 이 락이다.
     */
    suspend fun setEnabled(alarmId: String, enabled: Boolean): AlarmEntity = restoreMutex.withLock {
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
        updated
    }

    /** 복원·정합성 워커와 직렬화한다 — 이유는 [setEnabled] 주석과 같다(Codex #672 P1). */
    suspend fun deleteAlarm(alarmId: String): Unit = restoreMutex.withLock {
        deleteAlarmLocked(alarmId)
    }

    /**
     * [restoreMutex] 를 **이미 쥔 채** 부르는 삭제. `Mutex` 는 재진입이 안 되므로, 같은 락
     * 안에서 충돌 알람을 지우는 [createAlarm]·[updateAlarm] 은 이 쪽을 쓴다.
     */
    private suspend fun deleteAlarmLocked(alarmId: String) {
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
     * 로그아웃 시 이 기기의 알람을 '떠나는 계정의 것'으로 못 박고 예약을 전부 내린다.
     *
     * 지우지는 않는다 — 알람의 원본은 기기(Room)이고 서버는 백업/가족알람 전달용이라,
     * 내 알람을 서버에서 다시 받아오는 경로가 없다. 지우면 같은 계정으로 다시 로그인해도
     * 되살아나지 않는다.
     *
     * 대신 (1) 소유자 미기록(레거시 null) 행에 떠나는 계정을 새겨 다음 로그인 계정이
     * 자기 것으로 오인하지 않게 하고, (2) OS 예약을 전부 취소해 남의 알람이 울리지
     * 않게 한다. 본인이 다시 로그인하면 [reschedulePendingAlarms] 가 되살린다.
     * 목록 노출은 [observeAlarms] 의 소유자 필터가 막는다.
     *
     * 반환값은 예약을 내린 알람 수.
     */
    /**
     * @param clearSessionInsideLock 세션 저장소를 비우는 동작. **락을 놓기 전에** 실행한다 —
     *   락을 기다리던 복원이 깨어났을 때 prefs 가 아직 '로그인됨' 이면, 방금 취소한 예약을
     *   그 계정 것으로 보고 전부 되살린다. 로그인 화면 뒤에서 끌 수 없는 알람이 울린다
     *   (Codex #666 P1). 취소와 세션 전환은 한 임계구역 안에서 끝나야 한다.
     */
    suspend fun detachAlarmsOnSignOut(
        signedOutUserId: String?,
        clearSessionInsideLock: suspend () -> Unit = {},
    ): Int =
        // 복원과 직렬화한다 — 이유는 [restoreMutex] 주석 참고.
        restoreMutex.withLock {
            val detached = detachAlarmsOnSignOutLocked(signedOutUserId)
            val cleared = runCatching { clearSessionInsideLock() }
                .onFailure { error -> AlarmTalkLog.reportError("Failed to clear session inside restore lock", error) }
                .isSuccess
            // 세션 정리가 실패하면 저장소는 아직 '로그인됨' 이다. 락을 그대로 놓으면 대기하던
            // 정합성 워커가 소유자 일치를 보고 **방금 취소한 예약을 전부 되살린다** — 화면은
            // 로그인 화면인데 알람은 울리는, 끌 수 없는 상태가 된다(Codex #666 P2).
            //
            // 그래서 게이트를 **락 안에서** 세운다. prefs 에 남기지 않고 메모리에 두는 것이
            // 핵심이다: 지금 실패하고 있는 것이 바로 그 prefs 쓰기라 거기에 기대면 같이 실패하고,
            // 무엇보다 프로세스가 죽으면 저장소는 여전히 '로그인됨' 이므로 다음 실행에서는
            // 알람이 되살아나는 게 **맞다**(사용자는 실제로 로그아웃되지 않았다). 이 게이트가
            // 막아야 하는 건 딱 그 프로세스 안에서 락을 기다리던 작업뿐이다.
            signOutWithoutSessionClearOwner = signedOutUserId.takeIf { !cleared }
            detached
        }

    /**
     * 세션 정리가 실패한 채 로그아웃이 끝난 계정(없으면 null). **프로세스 수명**이다 —
     * 이유는 [detachAlarmsOnSignOut] 참고.
     *
     * 다시 로그인하면 [clearSignOutWithoutSessionClearGate] 로 내린다. 안 내리면 그 계정은
     * 다시 로그인해도 알람이 안 울린다 — 굳은 게이트는 되살아나는 것만큼 나쁘다.
     */
    @Volatile
    private var signOutWithoutSessionClearOwner: String? = null

    /** 로그인 확정 시 호출. 그 계정에 걸려 있던 게이트를 내린다. */
    fun clearSignOutWithoutSessionClearGate(signedInUserId: String?) {
        val gated = signOutWithoutSessionClearOwner ?: return
        if (signedInUserId.isNullOrBlank() || signedInUserId == gated) {
            signOutWithoutSessionClearOwner = null
        }
    }

    private suspend fun detachAlarmsOnSignOutLocked(signedOutUserId: String?): Int {
        val all = alarmDao.getAllAlarms()
        if (all.isEmpty()) return 0
        // 예약 취소가 먼저다. 소유자 새기기가 실패해도(디스크 가득참 등) 떠나는 계정의 알람이
        // 예약된 채 남으면 안 된다 — 로그아웃 뒤에는 목록에서 감춰져 사용자가 끌 수도 없는데
        // AlarmReceiver 는 Room 에서 바로 읽어 울린다. 순서를 뒤집으면 쓰기 한 번 실패로
        // 취소 루프 전체가 건너뛰어진다.
        all.forEach { alarm -> alarmScheduler.cancel(alarm.id) }
        // ⚠ **행도 끈다 — 예약만 취소하고 `enabled=1` 로 남기지 말 것**(2026-08-19 지시).
        // 예전에는 "재로그인하면 그대로 돌아오게" 하려고 켜진 채 뒀는데, **로그아웃은 이 앱을
        // 그만 쓰겠다는 뜻**이라는 쪽이 맞다. 목소리는 서버에 있어 로그아웃하면 핵심 기능
        // 자체를 못 쓰고 그동안 알람도 울리지 않는다 — 그렇게 지내다 돌아왔는데 옛 알람이
        // 저절로 울리기 시작하는 편이 오히려 놀랍다.
        //
        // ⚠ **로그아웃 상태에서는 알람 화면에 들어갈 수도 없다**(로그인 게이트).
        // 그래서 예약이 남으면 사용자가 **끌 방법이 없는 알람**이 우는 셈이다 —
        // 위 주석의 "목록에서 감춰져 사용자가 끌 수도 없는데" 와 같은 말이다.
        //
        // 꺼 두는 것이 안전한 이유는 **돌아왔을 때** 화면이 그 사실을 말하기 때문이다 —
        // `hs_status_inactive`("모든 알람이 꺼진 상태입니다.")가 홈 headline 으로 뜬다.
        // iOS 짝은 `AlarmKitViewModel.stopAllScheduledAlarms` — **한쪽만 고치지 말 것.**
        // 앞 계정의 미해결 소유권을 먼저 확정한다. 그러지 않으면 아직 앞 계정(A) 것인 미기록
        // 행을 지금 떠나는 계정(B) 것으로 잘못 새겨 A 가 그 알람을 영영 잃는다. 확정에
        // 실패하면 미기록 행이 누구 것인지 여전히 모르므로 아무에게도 새기지 않고, 임자
        // 표시를 남긴 채 다음 기회로 넘긴다.
        if (settlePendingAlarmOwnership()) {
            // 새기기가 실패해도 예약은 이미 내려갔다. 임자 표시가 남아 다음 기회에 다시 시도한다.
            runCatching { claimUnownedAlarmsFor(signedOutUserId) }
                .onFailure { error -> Log.w(TAG, "Failed to stamp ownerless alarms on sign-out", error) }
        }
        // ⚠ **끄는 것은 떠나는 계정 것만이다 — 위 예약 취소와 범위가 다르다**(Codex #699 P1).
        // 취소는 되돌릴 수 있지만(주인이 다시 로그인하면 reschedulePendingAlarms 가 다시 건다)
        // `enabled = false` 는 되돌릴 수 없다. 남의 계정 행까지 끄면 이렇게 된다:
        // A 가 자동 401 로 세션만 잃고(행은 일부러 켜 둔다) → B 가 로그인했다 로그아웃 →
        // **A 의 알람이 영영 꺼진 채**로 A 가 돌아온다. 자동 401 을 예외로 둔 뜻이 사라진다.
        //
        // 소유권 확정 **뒤에** 판단하고, ⚠ **행을 다시 읽는다.** 위 `settlePendingAlarmOwnership`
        // 은 **앞 계정(A)** 의 미해결 행을 A 로 새긴다 — 확정 전 스냅샷(`all`)으로 판정하면
        // 그 행이 아직 null 로 보여 **지금 떠나는 B 것으로 오인해 A 의 알람을 꺼 버린다.**
        // (이 함수가 막으려는 바로 그 사고를, 스냅샷을 재사용하는 것만으로 다시 낸다.)
        //
        // 다시 읽으면 A 것은 A 로, B 의 옛 행은 방금 `claimUnownedAlarmsFor` 가 B 로 새겼다.
        // 그래도 null 이 남았다면 확정이 실패한 것이라 임자를 알 수 없으므로 끄는 쪽에 넣는다
        // (안 울리는 쪽이 안전하다). `signedOutUserId` 가 비어 누구인지 모를 때도 같다.
        // iOS 짝은 `AlarmKitViewModel.stopAllScheduledAlarms`.
        val now = System.currentTimeMillis()
        val leaving = signedOutUserId?.takeIf { it.isNotBlank() }
        val settled = runCatching { alarmDao.getAllAlarms() }.getOrElse { error ->
            Log.w(TAG, "Failed to re-read alarms after ownership settle", error)
            all
        }
        settled.filter { alarm ->
            alarm.enabled && (leaving == null || alarm.ownerUserId == null || alarm.ownerUserId == leaving)
        }.forEach { alarm ->
            runCatching {
                alarmDao.setState(
                    id = alarm.id,
                    state = AlarmStates.DISABLED,
                    enabled = false,
                    updatedAtMillis = now,
                )
            }.onFailure { error -> Log.w(TAG, "Failed to disable alarm on sign-out", error) }
        }
        Log.i(TAG, "Detached ${all.size} device alarms on sign-out")
        return all.size
    }

    /**
     * 소유자 미기록(레거시 null) 알람에 지금 세션의 계정을 새긴다. 예약은 건드리지 않는다.
     *
     * 자동 401 은 '같은 사람이 다시 로그인'이 대부분이라 예약을 일부러 살려 두는데, 그때
     * 소유자가 null 로 남으면 다음에 들어온 **다른** 계정이 그 알람을 자기 것으로 삼는다 —
     * [reschedulePendingAlarms]·[observeAlarms]·lockPaidAlarmTalks 는 모두 null 을 현재 계정
     * 것으로 보기 때문이다. 로그인 시점의 [cancelAlarmsNotOwnedBy] 는 소유자가 없는 행을
     * 건너뛰므로 그것만으론 못 막는다. 세션을 비우기 전에 떠나는 계정을 새겨 그 창을 닫는다.
     *
     * 본인이 다시 로그인하면 소유자가 일치해 [reschedulePendingAlarms] 가 그대로 되살린다.
     *
     * 반환값은 소유자를 새긴 알람 수.
     */
    suspend fun claimUnownedAlarmsFor(userId: String?): Int {
        if (userId.isNullOrBlank()) return 0
        // 행 전체를 되쓰지 않고 컬럼 하나만 바꾼다 — 이유는 AlarmDao.claimUnownedAlarms 참고.
        val claimed = alarmDao.claimUnownedAlarms(userId)
        if (claimed > 0) Log.i(TAG, "Claimed $claimed ownerless alarms for the leaving session")
        return claimed
    }

    /**
     * 세션이 끝날 때 소유자를 못 새겨 '임자 미정'으로 남은 알람을 여기서 마저 새긴다.
     *
     * 세션 종료 시점의 [claimUnownedAlarmsFor] 가 실패하거나(쓰기 오류), 로그인 뒤처리가 끝나기
     * 전에 프로세스가 죽으면 소유자 미기록 행이 그대로 남는다. 그 상태로 예약하면 다음 계정이
     * 앞 계정 알람을 자기 것으로 삼아 울린다. 그래서 [reschedulePendingAlarms] 가 예약 직전에
     * 이 함수를 부른다 — 로그인 뒤처리뿐 아니라 앱 콜드스타트·부팅 복구도 전부 그 함수를
     * 지나므로, 한 곳만 막으면 나머지 경로가 새는 것을 방지한다. 여러 번 불러도 안전하다.
     *
     * 기준은 '지금 계정'이 아니라 **임자 표시**다. 미정 임자가 지금 계정이면 그 행들은 원래
     * 내 것이므로 새기지 않고 표시만 지운다(레거시 알람 채택 규칙 그대로). 다른 계정이면
     * 그 계정으로 새긴다 — 지금 비로그인이어도 마찬가지다.
     *
     * @return 정리가 끝났는가. false 면 소유자 미기록 행을 이번 회차에 예약하면 안 되고
     *         (누구 것인지 모르는 알람이다), 표시도 그대로 둬 다음 기회에 다시 시도한다.
     */
    suspend fun settlePendingAlarmOwnership(): Boolean {
        // 미정 임자가 없으면 정리할 것도 없다.
        val pendingOwner = pendingOwnerUserIdProvider()?.takeIf { it.isNotBlank() } ?: return true
        val currentUser = currentUserIdProvider()?.takeIf { it.isNotBlank() }
        if (pendingOwner == currentUser) {
            onOwnershipSettled()
            return true
        }
        return runCatching { claimUnownedAlarmsFor(pendingOwner) }
            .onSuccess { claimed ->
                if (claimed > 0) Log.i(TAG, "Settled $claimed ownerless alarms onto their owner")
                onOwnershipSettled()
            }
            .onFailure { error -> Log.w(TAG, "Failed to settle pending alarm ownership", error) }
            .isSuccess
    }

    /**
     * 이 행을 '지금 계정 것'으로 다뤄도 되는가 — 파괴적/외부로 나가는 작업의 공통 게이트.
     *
     * 소유자 미기록(레거시 null)은 [observeAlarms]·[reschedulePendingAlarms]·lockPaidAlarmTalks 와
     * 같은 규칙으로 현재 계정 것으로 본다. 단 [settlePendingAlarmOwnership] 이 실패한 회차에는
     * 그 null 이 앞 계정 것일 수 있으므로 제외한다 — 표시가 남아 다음 기회에 다시 판정된다.
     */
    private fun ownedByCurrentSession(
        alarm: AlarmEntity,
        currentUserId: String,
        ownershipSettled: Boolean,
    ): Boolean = when (alarm.ownerUserId) {
        null -> ownershipSettled
        currentUserId -> true
        else -> false
    }

    /**
     * 지금 로그인한 계정의 것이 아닌 알람의 OS 예약을 내린다.
     *
     * 자동 401(토큰 만료)은 알람을 그대로 두므로, 그 상태에서 다른 계정으로 로그인하면
     * 앞 계정 알람의 예약이 살아 있게 된다. 목록에서는 소유자 필터가 감추므로 끌 수도 없다.
     * 로그인 시점에 이 정리를 한 번 돌려 그 창을 닫는다. 행은 지우지 않는다 — 본인이 다시
     * 로그인하면 reschedulePendingAlarms 가 되살린다.
     *
     * 반환값은 예약을 내린 알람 수.
     */
    suspend fun cancelAlarmsNotOwnedBy(currentUserId: String?): Int {
        if (currentUserId.isNullOrBlank()) return 0
        var cancelled = 0
        alarmDao.getAllAlarms().forEach { alarm ->
            val owner = alarm.ownerUserId ?: return@forEach
            if (owner == currentUserId) return@forEach
            alarmScheduler.cancel(alarm.id)
            cancelled += 1
        }
        if (cancelled > 0) Log.i(TAG, "Cancelled $cancelled alarm reservations owned by another account")
        return cancelled
    }

    /**
     * 접근권을 잃은 음성 프로필(공유 해제·제공자 취소·본인 삭제)을 참조하는 '내 소유(LOCAL_OWNED)'
     * 음성 알람을 sound-only 로 강등한다. [accessibleVoiceIds] 는 방금 '신선하게' 로드한 내 프로필 +
     * 가족 공유 프로필 id 집합이어야 한다 — 부분/실패 로드로 호출하면 정상 알람을 오강등할 수 있으므로
     * 호출부(refreshSocial 신선 성공)에서 가드한다. 버킷 회전·녹음(LOCAL_AUDIO)·수신 알람은 대상이 아니다.
     * 대상은 **지금 계정 소유** 알람으로 한정된다(같은 기기에 남아 있는 앞 계정 알람은 건드리지 않는다).
     * 반환값은 강등된 알람 수.
     */
    /**
     * @param expectedOwnerUserId 이 목록을 **가져온 계정**. 소유자를 고르는 시점에 계정이
     *   그대로인지 확인한다 — 목록은 A 로 받아 놓고 그 사이 B 로 바뀌면, B 의 알람에서 A 기준
     *   접근권으로 목소리를 **영구히** 벗긴다(되돌릴 수 없다, Codex #665 P1). 호출부의 사전
     *   확인만으로는 이 창을 못 닫는다.
     */
    suspend fun degradeAlarmsWithInaccessibleVoice(
        accessibleVoiceIds: Set<String>,
        expectedOwnerUserId: String?,
    ): Int =
        degradeMatchingLocalOwnedVoiceAlarms(expectedOwnerUserId) { alarm ->
            !alarm.voiceProfileId.isNullOrBlank() &&
                // 시스템 스톡 버킷/보이스는 영구라 보존. 클론(비-system) 보이스는 단일클립·버킷 모두
                // 접근권 상실(공유해제·제공자취소·삭제) 시 강등 대상.
                !isSystemVoiceId(alarm.voiceProfileId) &&
                alarm.voiceProfileId !in accessibleVoiceIds
        }

    // 방금 삭제한 특정 목소리를 쓰는 내 알람만 즉시 강등한다 — 소셜 목록 신선도(reconcile 가드)와
    // 무관하게 삭제 확정 정보로 바로 기본 알람으로 변환한다.
    suspend fun degradeAlarmsUsingVoiceProfile(voiceProfileId: String): Int =
        degradeMatchingLocalOwnedVoiceAlarms(expectedOwnerUserId = null) { alarm ->
            alarm.voiceProfileId == voiceProfileId && !isSystemVoiceId(alarm.voiceProfileId)
        }

    // 복원·로그아웃과 직렬화한다 — 행을 고치고 OS 예약까지 다시 거는 구간이다([restoreMutex]).
    // 두 공개 진입점([degradeAlarmsWithInaccessibleVoice]·[degradeAlarmsUsingVoiceProfile])이
    // 모두 여기로만 들어오므로 락은 이 한 곳에서만 잡는다(Mutex 는 재진입 불가).
    private suspend fun degradeMatchingLocalOwnedVoiceAlarms(
        expectedOwnerUserId: String?,
        match: (AlarmEntity) -> Boolean,
    ): Int = restoreMutex.withLock {
        // 강등은 되돌릴 수 없다 — 목소리 참조를 지우고 캐시 오디오까지 정리한다. 그래서 '지금 계정
        // 것'이라고 확신할 수 있는 행만 건드린다.
        //
        // 로컬 알람은 로그아웃해도 남으므로(원본이 기기다), 앞 계정 A 의 알람이 Room 에 그대로
        // 있는 채로 계정 B 가 로그인한다. B 의 접근 가능 목소리 목록에 A 의 프로필이 없는 건
        // 당연한데, 소유자를 안 보면 B 가 도는 refreshSocial·주기 워커가 그걸 '접근권 상실'로
        // 읽어 A 의 알람에서 목소리를 영구히 벗긴다. VoiceAccessSyncWorker 의 토큰 재확인은
        // 요청 중의 계정 전환만 잡지, 이미 앞 계정 것인 행은 못 지킨다(Codex #646 P1).
        val ownershipSettled = settlePendingAlarmOwnership()
        val currentUser = currentUserIdProvider()?.takeIf { it.isNotBlank() }
        // 파괴적 변경이라 되돌릴 수 없다 — 목록을 가져온 계정과 지금 계정이 다르면 그만둔다.
        if (expectedOwnerUserId != null && currentUser != expectedOwnerUserId) {
            Log.i(TAG, "Skipped voice degradation: account changed since the list was fetched")
            return 0
        }
        if (currentUser == null) {
            // 비로그인 상태에서는 [accessibleVoiceIds] 가 누구의 목록인지 알 수 없다. 호출부가
            // 모두 세션 안에서 도므로 정상 경로에서는 오지 않는 가지다.
            Log.i(TAG, "Skipped voice degradation: no signed-in account")
            return 0
        }
        val candidates = alarmDao.getAllAlarms().filter { alarm ->
            alarm.origin == AlarmOrigins.LOCAL_OWNED &&
                alarm.voiceSource == VoiceSources.TTS_PROFILE &&
                ownedByCurrentSession(alarm, currentUser, ownershipSettled) &&
                match(alarm)
        }
        var degraded = 0
        for (current in candidates) {
            val cacheKey = current.audioCacheKey
            val updated = current.copy(
                playMode = AlarmPlayModes.ALARM_ONLY,
                // '기본 알람으로 변환됨' 마커 — 무료 강등과 동일하게 리스트 배지·목소리 숨김에 쓴다.
                // 복원은 하지 않으므로(영구 변환) 순수 표시용 마커다.
                preLockPlayMode = current.preLockPlayMode ?: current.playMode,
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

    /**
     * 무료 전환 시 유료 목소리 알람을 삭제하지 않고 사운드온리로 '잠근다'. 원래 재생모드를
     * preLockPlayMode 에 보관하고 playMode 를 ALARM_ONLY 로 내려, RingingService 가 목소리 대신
     * 기본 알람음을 재생하게 한다. 캐시 오디오·목소리 참조는 그대로 보존해 재유료 시 복원한다.
     * 로컬만 갱신(upsertPreservingServerSyncFields)해 서버의 원본 목소리 알람은 백스톱으로 남긴다.
     */
    /**
     * @param expectedOwnerUserId 이 강등을 **확정한 계정**. 소유자를 고르는 시점에 계정이 그대로인지
     *   확인한다 — 워커가 A 로 '진짜 무료' 를 확정한 뒤 로그아웃·B 로그인이 끼면, 그 판정이 B 의
     *   **유료** 알람에 적용돼 sound-only 로 바뀌고 다시 예약된다. 호출부의 사전 확인만으로는 이
     *   창을 못 닫는다(Codex #665 P1). `degradeAlarmsWithInaccessibleVoice` 와 같은 규약이다.
     *   null 이면 검사하지 않는다 — 방금 읽은 세션으로 곧바로 부르는 전경 경로용이다.
     */
    // 복원·로그아웃과도 직렬화한다([restoreMutex]). 락이 없으면 로그아웃이 예약을 다 취소한 뒤
    // (행은 enabled 로 남는다) 이 함수가 그 행들을 sound-only 로 **다시 예약**한다 — 목록은
    // 소유자 필터에 가려 안 보이는데 리시버는 Room 을 직접 읽어 울리는, 끌 수 없는 알람이 된다.
    // 아래 currentUserIdProvider() 를 락 안에서 읽는 것도 같은 이유다. 락과 기대 계정은 서로
    // 다른 것을 막는다 — 락은 '로그아웃과 겹치는 것', 기대 계정은 '검사 이후 계정이 바뀐 것'.
    suspend fun lockPaidAlarmTalks(expectedOwnerUserId: String? = null): Int = restoreMutex.withLock {
        val currentUser = currentUserIdProvider() ?: return 0
        if (expectedOwnerUserId != null && currentUser != expectedOwnerUserId) {
            Log.i(TAG, "Skipped paid-alarm lock: account changed since the plan was confirmed")
            return 0
        }
        // 미기록 행에 소유자를 '영구히' 새기는 경로다. 새기기 전에 임자를 먼저 확정하지 않으면
        // 앞 계정 A 의 미기록 알람이 B 것으로 박히고, 뒤늦은 확정(claimUnownedAlarms 는 null 만
        // 대상)이 더는 손댈 수 없어 A 는 그 알람을 영영 잃는다. reschedulePendingAlarms 와 같은 규칙.
        val ownershipSettled = settlePendingAlarmOwnership()
        val now = System.currentTimeMillis()
        var lockedCount = 0
        alarmDao.getAllAlarms().forEach { alarm ->
    // ⚠ **재생 방식만으로 '유료 목소리' 라고 하지 말 것**(2026-08-18, 실계정 확인).
    // `playMode != ALARM_ONLY` 를 단독 조건으로 두면 **말할 자원이 하나도 없는 알람**
    // (profileId·ttsMessageId·오디오 전부 없음)이 유료로 잡혀, **한 번도 유료였던 적 없는
    // 계정**의 알람이 잠기고 "무료 이용권으로 바뀌었어요" 가 뜬다. iOS 짝은
    // `LocalAlarmRecord.usesPaidVoiceFeatures` · `PaidVoiceGate.usesPaidVoice` — 같이 고친다.
            val usesVoice = !alarm.localAudioUri.isNullOrBlank() ||
                !alarm.rawAudioUri.isNullOrBlank() ||
                !alarm.voiceProfileId.isNullOrBlank() ||
                !alarm.ttsMessageId.isNullOrBlank()
            if (!usesVoice || alarm.usesFreeSystemVoiceAlarm()) {
                // 옛 규칙(직접 녹음 = 유료)으로 이미 잠긴 행은 여기서 **되돌린다.**
                // 그냥 건너뛰면 잠긴 채 남는데, 이제 잠글 축이 사라졌으니 풀어 줄 다른
                // 경로가 없다. 아래 '옛 버그로 잠긴 받은 알람' 과 같은 모양이다.
                if (alarm.preLockPlayMode != null) {
                    val unlocked = alarm.copy(
                        playMode = alarm.preLockPlayMode,
                        preLockPlayMode = null,
                        updatedAtMillis = now,
                    )
                    if (unlocked.enabled) alarmScheduler.schedule(unlocked)
                    alarmDao.upsertPreservingServerSyncFields(unlocked)
                }
                return@forEach
            }
            // ⚠ **받은 알람은 '받는 사람 플랜' 으로 다스리지 않는다 — 축이 다르다.**
            // 받은 알람의 목소리는 **접근권**(공유가 살아 있는가)이 정한다. 공유가 끊기면
            // 서버가 직접 걷어내고(`paid-voice-cleanup.ts` 가 `is_received` 까지
            // sound-only 로 UPDATE) 그 결과가 pull sync 로 내려온다.
            //
            // 여기서 플랜으로 한 번 더 잠그면 **결제 보류(유예) 중에 오발한다** —
            // `resolvePlanAfterSuspend` 는 그룹·공유를 살려 둔 채 `users.plan` 만 회수하므로,
            // 카드가 잠깐 실패한 사이 파트너가 보낸 알람의 목소리가 잠긴다. 게다가
            // `unlockPaidAlarmTalks` 는 **받는 사람이 유료가 될 때만** 돌아서, 결제가
            // 복구돼도 그룹에서 나간 뒤라면 `preLockPlayMode` 가 영구히 남는다.
            // iOS 는 `LocalAlarmStore.paidAlarmTalks` 의 `.localOwned` 로 처음부터 제외한다.
            if (alarm.origin != AlarmOrigins.LOCAL_OWNED) {
                // 옛 버그로 이미 잠긴 받은 알람은 여기서 **되돌린다.** 그냥 건너뛰면
                // 잠긴 채로 남는데, 플랜 축이 사라졌으니 풀어 줄 다른 경로가 없다.
                if (alarm.preLockPlayMode != null) {
                    val unlocked = alarm.copy(
                        playMode = alarm.preLockPlayMode,
                        preLockPlayMode = null,
                        updatedAtMillis = now,
                    )
                    if (unlocked.enabled) alarmScheduler.schedule(unlocked)
                    alarmDao.upsertPreservingServerSyncFields(unlocked)
                }
                return@forEach
            }
            // 다른 계정이 소유한(ownerUserId 불일치) 알람은 건드리지 않는다. 임자가 확정된 미기록
            // (레거시 null) 음성 알람은 현재 활성 계정으로 소유권을 backfill 한다 — 잠금 시점에 소유자를 확정해,
            // 복원은 엄격히 ownerUserId 일치만 보고도 (1) 본인이 재유료 시 복원 가능(영구잠금 방지),
            // (2) 같은 기기의 다른 계정이 남의 잠긴 알람을 복원·스케줄하지 못하게 한다. 이미 잠긴
            // 레거시 행(구버전에서 소유자 없이 잠김)도 여기서 소유권만 backfill 해 복원 가능하게 만든다.
            if (!ownedByCurrentSession(alarm, currentUser, ownershipSettled)) return@forEach
            val needsLock = alarm.preLockPlayMode == null
            val needsClaim = alarm.ownerUserId == null
            if (!needsLock && !needsClaim) return@forEach
            val updated = alarm.copy(
                preLockPlayMode = if (needsLock) alarm.playMode else alarm.preLockPlayMode,
                playMode = if (needsLock) AlarmPlayModes.ALARM_ONLY else alarm.playMode,
                ownerUserId = currentUser,
                updatedAtMillis = now,
            )
            // 새로 잠근 경우에만 재스케줄(사운드온리로). 소유권만 backfill 한 경우는 재생모드 불변이라 불필요.
            if (updated.enabled && needsLock) alarmScheduler.schedule(updated)
            alarmDao.upsertPreservingServerSyncFields(updated)
            if (needsLock) lockedCount++
        }
        if (lockedCount > 0) {
            Log.i(TAG, "Locked paid voice alarms on free plan count=$lockedCount")
        }
        return lockedCount
    }

    /**
     * 다시 유료가 되면 잠근 알람의 원래 재생모드를 복원한다. 로컬 알람은 로그아웃 후에도 남으므로,
     * 현재 세션이 소유한(ownerUserId 일치) 잠긴 알람만 복원한다 — 다른 계정으로 로그인해 유료가 돼도
     * 남의 잠긴 목소리 알람이 복원돼 울리지 않게 한다. 잠금 시점에 소유자를 backfill 하므로(위
     * lockPaidAlarmTalks), 잠긴 행은 항상 소유자가 있어 여기서 null 을 허용할 필요가 없다 — 엄격히
     * ownerUserId 일치만 본다(null 허용 시 다른 계정이 레거시 잠금을 복원·스케줄하는 크로스계정 창).
     */
    // [lockPaidAlarmTalks] 와 같은 이유로 직렬화한다 — 여기도 행을 고치고 OS 예약을 다시 건다.
    suspend fun unlockPaidAlarmTalks(): Int = restoreMutex.withLock {
        val currentUser = currentUserIdProvider() ?: return 0
        val targets = alarmDao.getAllAlarms().filter {
            !it.preLockPlayMode.isNullOrBlank() && it.ownerUserId == currentUser
        }
        targets.forEach { alarm ->
            val restored = alarm.copy(
                playMode = alarm.preLockPlayMode ?: alarm.playMode,
                preLockPlayMode = null,
                updatedAtMillis = System.currentTimeMillis(),
            )
            if (restored.enabled) alarmScheduler.schedule(restored)
            alarmDao.upsertPreservingServerSyncFields(restored)
        }
        if (targets.isNotEmpty()) {
            Log.i(TAG, "Restored paid voice alarms after re-subscription count=${targets.size}")
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
            ownerUserId = currentUserIdProvider(),
            // 복사는 새 알람 생성이므로 원본의 무료 잠금 스냅샷을 물려받지 않는다(잠기지 않은 상태로
            // 시작). 무료 사용자가 잠긴 알람을 복사하면 playMode 는 이미 ALARM_ONLY 라 사운드온리로
            // 복사되고, 잠금이 필요하면 다음 앱 시작의 재잠금이 새 스냅샷을 만든다.
            preLockPlayMode = null,
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

    // 복원·로그아웃과 직렬화한다([restoreMutex]). 울림을 끝내는 쓰기는 정합성 워커의 재계산과
    // 같은 행을 두고 경쟁하는데, 서비스는 '울리는 중' 표시를 DB 쓰기 **전에** 풀기 때문에
    // 그 틈의 워커에게는 '시각이 지났는데 안 울리는 알람' 으로 보인다. 나중에 쓰는 쪽이 이기므로
    // 락 없이는 dismiss 결과(회전 인덱스 전진·스누즈 카운트 리셋)가 조용히 덮인다.
    suspend fun dismiss(alarmId: String): Unit = restoreMutex.withLock {
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

    /**
     * 복원·로그아웃과 직렬화한다([restoreMutex]) — **이게 없으면 스누즈가 통째로 사라진다.**
     *
     * 사용자가 스누즈를 누르면 소리는 즉시 멎고 '울리는 중' 표시도 즉시 풀리는데, DB 쓰기는
     * 코루틴으로 뒤에 온다. 그 틈에 15분 주기 정합성 워커가 그 행을 보면 '발화 시각이 지났는데
     * 안 울리는 중' 이라 다음 정규 발생(내일)으로 재계산해 덮는다. 5분 뒤 울려야 할 알람이
     * 없어지고, 화면상으로는 내일로 정상 예약돼 있어 사용자는 알 방법이 없다 — 알람 앱에서
     * 가장 나쁜 결과다.
     *
     * 워커가 락을 먼저 잡아도 결과는 맞다: 스누즈가 나중에 최종 승자가 된다.
     */
    suspend fun snooze(alarmId: String): AlarmEntity? = restoreMutex.withLock {
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

    suspend fun reschedulePendingAlarms(recomputeFireTime: Boolean = false): Int =
        // 로그아웃·다른 복원과 직렬화한다 — 이유는 [restoreMutex] 주석 참고.
        restoreMutex.withLock { reschedulePendingAlarmsLocked(recomputeFireTime) }

    private suspend fun reschedulePendingAlarmsLocked(recomputeFireTime: Boolean): Int {
        // 예약 전에 소유자를 확정한다 — 이 함수는 로그인 뒤처리·앱 시작·부팅 복구가 모두
        // 지나는 길목이라, 여기서 한 번 막으면 나머지 경로가 따로 새지 않는다.
        val ownershipSettled = settlePendingAlarmOwnership()
        val now = System.currentTimeMillis()
        val enabledAlarms = alarmDao.getEnabledAlarms()
        val holidayPredicate = holidayCalendarStore.holidayPredicate(
            countryCode = currentHolidayCountry(),
            startDate = currentLocalDate(now),
        )
        var scheduled = 0

        val currentUser = currentUserIdProvider()
        enabledAlarms.forEach { alarm ->
            // 다른 계정이 소유한 알람은 재예약하지 않는다(로그아웃한 앞 계정의 알람이 부팅·
            // 재로그인 때 되살아나 남의 폰에서 울리는 것 방지). 미기록(null)은 lockPaidAlarmTalks
            // 와 같은 규칙으로 현재 계정 것으로 본다.
            //
            // **비로그인(currentUser == null)이면 이 게이트를 적용하지 않는다** — 단 아래
            // '명시적 로그아웃' 예외가 있다. 누가 로그인해 있지 않은 동안에는 '다른 계정 것'
            // 이라고 판정할 기준 자체가 없다. 예전에는 취소만 건너뛰고 `return@forEach` 로
            // 재예약도 함께 건너뛰었는데, 그게 실제 피해를 냈다: **스토어 업데이트는 OS 의
            // AlarmManager 등록을 전부 지운다.** 지워진 뒤라 "취소하지 않는다"는 아무 의미가
            // 없고, 재예약을 건너뛰는 순간 그 알람은 영영 울리지 않는다. 목록 쪽도 같은 소유자
            // 규칙이라 사용자에겐 보이지도 않아 되살릴 수단이 없다.
            // (토큰이 7일마다 죽고 갱신 경로가 없어서 이 조합이 흔했다 — jwt.ts 참고.)
            //
            // 알람 전달이 서버 인증 상태에 묶여선 안 된다(AGENTS.md). 남의 알람 정리는 '다른
            // 계정이 실제로 로그인한' 시점에 onSignedIn 의 cancelAlarmsNotOwnedBy 가 한다.
            //
            // **비로그인일 때 되살릴 수 있는 건 '자동으로 끊긴 그 계정' 의 알람뿐이다.**
            // detachAlarmsOnSignOut 은 예약만 취소하고 행은 enabled=1 로 남기므로(재로그인하면
            // 되살리려고), 비로그인을 전부 '이 기기 것' 으로 다루면 사용자가 끝낸 계정의 알람이
            // 콜드스타트·부팅·업데이트마다 되살아나 **로그인 화면 뒤에서 끌 수도 없이 울린다.**
            // 한 기기에 여러 계정이 오갔다면 그 계정들 알람이 한꺼번에 살아난다(Codex #665 P1).
            //
            // 복원 대상이 없으면(명시적 로그아웃·이 빌드 이전 상태) 소유자 있는 행은 건드리지
            // 않는다 — 못 가릴 때는 로그인 한 번 시키는 쪽이 안전하다.
            // 세션 정리가 실패한 채 끝난 로그아웃의 계정은 되살리지 않는다. 저장소는 아직
            // '로그인됨' 이라 아래 소유자 게이트를 통과해 버리기 때문이다 — 그러면 로그인
            // 화면 뒤에서 끌 수 없는 알람이 울린다([detachAlarmsOnSignOut], Codex #666 P2).
            //
            // **소유자 미기록(null) 행도 함께 막는다.** 로그아웃은 예약 취소 → 소유자 각인
            // 순서인데 그 각인도 같이 실패할 수 있다(쓰기 오류가 원인이면 대개 함께 실패한다).
            // 소유자만 보고 걸러내면 그 행은 null 이라 게이트를 그냥 빠져나가고, 아래 레거시
            // 규칙이 '지금 계정 것' 으로 보아 되살린다 — 막으려던 바로 그 상태다.
            // 실패한 로그아웃 중에 주인 없는 행이 남았다면 그건 떠나는 계정의 것이다.
            val blockedOwner = signOutWithoutSessionClearOwner
            if (blockedOwner != null && (alarm.ownerUserId == null || alarm.ownerUserId == blockedOwner)) {
                alarmScheduler.cancel(alarm.id)
                return@forEach
            }
            val restorableOwner = currentUser ?: sessionExpiredOwnerUserIdProvider()
            if (alarm.ownerUserId != null && alarm.ownerUserId != restorableOwner) {
                // 건너뛰는 데 그치면 앞 세션이 잡아 둔 OS 예약이 살아남아 이 계정 폰에서 울린다.
                // 특히 소유자 확정이 이 함수 안에서야 성공한 경우, 앞서 돈 cancelAlarmsNotOwnedBy
                // 는 아직 미기록이던 그 행을 건너뛴 뒤다 — 여기서 내려야 새는 곳이 없다.
                //
                // **취소는 다른 계정이 실제로 로그인해 있을 때만** 한다. 비로그인일 때 내리면
                // 자동 401 로 세션만 끊긴 사이 본인 알람이 조용히 안 울린다 — 알람 전달이 서버
                // 인증 상태에 묶여선 안 된다(AGENTS.md). 그때는 새로 걸지 않을 뿐, 이미 걸린
                // 예약은 건드리지 않는다.
                if (currentUser != null) alarmScheduler.cancel(alarm.id)
                return@forEach
            }
            // 소유자 정리가 실패한 회차에는 미기록 행을 '현재 계정 것'으로 볼 근거가 없다.
            // 예약을 내려 남의 알람이 울리는 것을 막되 행은 남긴다 — 마커가 보존돼 있어
            // 다음 회차에 소유자를 새기고 나면 주인에게 다시 예약된다.
            //
            // 각인이 실패했어도 **그 미정 임자가 곧 복원 대상이면** 이 행은 우리 것이다 — 자동
            // 401 로 끊긴 계정이 그 임자인 경우가 그렇고, 업데이트 직후 이 가지에 걸려 재예약을
            // 통째로 건너뛰면 알람이 안 울린다(지울 예약도 이미 없다). 반대로 명시적 로그아웃
            // 뒤에는 복원 대상이 없어 임자와 어긋나므로 그대로 떼어 둔다(Codex #666 P1).
            //
            // 취소는 다른 계정이 실제로 로그인해 있을 때만 한다(위 게이트와 같은 이유).
            if (alarm.ownerUserId == null && !ownershipSettled &&
                pendingOwnerUserIdProvider() != restorableOwner
            ) {
                if (currentUser != null) alarmScheduler.cancel(alarm.id)
                return@forEach
            }
            // **지금 울리는 중인 알람은 아예 건드리지 않는다.** RINGING 은 enabled=true 이고
            // fireAtMillis 가 이미 과거다. 재계산에 넣으면 반복 없는 알람이 enabled=false·FAILED 로
            // 꺼지고(듣고 있는 알람을 끄는 셈), 재계산에서 빼면 과거 시각 그대로 다시 예약돼
            // 즉시 재발화한다 — 사용자가 그 사이 껐다면 껐던 알람이 되살아난다(Codex #666 P2).
            // 이미 울리는 중이라 OS 예약이 더 필요하지도 않다. 다음 예약은 dismiss/snooze 가 잡는다.
            //
            // 예전에는 이 함수가 콜드스타트·부팅에서만 돌아 겹칠 일이 드물었지만, 예약 정합성
            // 워커(AlarmScheduleIntegrityWorker)가 주기적으로 부르면서 흔해진다.
            //
            // ⚠️ 판정은 **지금 실제로 울리는 중인가** 로 한다. `state == RINGING` 만 보면 굳어
            // 버린 행이 모든 복구 경로에서 영구 배제된다: RINGING 을 벗어나게 하는 쓰기는
            // dismiss/snooze/토글/편집뿐인데, (a) 알림의 스누즈를 한도 초과 상태에서 누르면
            // AlarmRepository.snooze 가 DB 를 안 쓰고 null 을 돌려주고, (b) 울리는 도중 FGS 가
            // 죽거나(제조사 절전) 재부팅되면 onDestroy 가 상태를 되돌리지 않는다. 그러면
            // enabled=1 · state=RINGING · fireAtMillis=과거 로 남고, 이 함수가 유일한 복구
            // 길목이라 **다시는 안 울린다**(목록에는 켜져 보인다). develop 은 그 행을 다음
            // 발생으로 재계산해 스스로 나았다 — 스킵이 그 자가치유를 없애면 안 된다.
            //
            // **하나가 아니라 집합으로 본다.** A 가 울리는 동안 B 의 스누즈가 마감되면 울리는
            // 알람은 A, 인계 중인 알람은 B 다. 하나만 보면 A 에 가려 B 가 무방비가 되고, 그
            // 순간 이 함수가 B 의 지난 시각을 그대로 다시 등록해 한 번 더 울린다(Codex #666 P2).
            val ringingNow = alarm.id in ringingAlarmIdsProvider()
            if (ringingNow) return@forEach

            // 목록을 읽은 뒤 사용자가 그 알람을 끄거나 지웠을 수 있다. 스냅샷 그대로 진행하면
            // 방금 끈 알람이 되살아난다 — 아래 재계산이 enabled=true 인 옛 값을 그대로 upsert 하고,
            // OS 예약도 다시 걸린다. 그러면 AlarmReceiver 가 Room 검증 전에 RingingService 를 띄우고
            // markRinging 이 행을 다시 켜서, 사용자가 끈 알람이 울린다(Codex #666 P2).
            //
            // 콜드스타트·부팅에서만 돌 때는 사용자 조작과 겹칠 일이 드물었지만, 주기 워커가
            // 부르면서 흔해진다. 쓰기 직전에 한 번 더 읽어 그 창을 좁힌다.
            val fresh = alarmDao.getById(alarm.id)
            if (fresh == null || !fresh.enabled || fresh.id in ringingAlarmIdsProvider()) return@forEach
            val alarm = fresh

            runCatching {
                // recomputeFireTime: 시간대/시스템 시각 변경 시, 저장된 fireAtMillis(과거 기준 절대시각)를
                // hour/minute 으로 다시 계산해 새 벽시계 시각에 울리게 한다(여행/DST). 그 외(부팅 등)에는
                // 미래 알람은 그대로 두고 과거(놓친) 알람만 재계산/정리한다.
                // 스누즈 알람은 enabled=true 이고 fireAtMillis 가 "스누즈 마감(절대시각)"이라
                // 재계산에서 제외한다 — 그러지 않으면 tz/시각 변경 시 스누즈가 다음 정규 발생으로 밀린다.
                //
                // ⚠️ **비정확 알람(setAndAllowWhileIdle)의 지연 전달은 여기서 다루지 않는다 —
                // 해결된 게 아니라 알려진 한계다.**
                //
                // 두 번 막아 보려다 둘 다 더 나쁜 것을 만들어 되돌렸다:
                //  - PendingIntent 존재(FLAG_NO_CREATE) → 그건 AlarmManager 큐가 아니라 토큰만
                //    본다. 전달 후에도 남으므로 굳어 버린 행이 영영 복구되지 않는다.
                //  - 고정 유예 창(15분) → 플랫폼 전달 상한을 알 수 없어 짐작한 값이고, 그보다
                //    늦으면 여전히 덮어쓴다. 늘리면 그만큼 복구가 늦어진다.
                //
                // 되돌릴 때 "USE_EXACT_ALARM 이 있으니 비정확 경로는 안 탄다" 고 적었는데 **틀렸다.**
                // USE_EXACT_ALARM 은 API 33 권한이고 minSdk 는 26 이다. API 31·32 에서는
                // SCHEDULE_EXACT_ALARM 만 적용되고 그건 사용자가 회수할 수 있어,
                // canScheduleExactAlarms() 가 false 가 되며 폴백을 실제로 탄다.
                //
                // 즉 **API 31/32 에서 권한을 회수한 사용자**에게는 15분 워커가 배달 대기 중인
                // 등록을 다음 발생으로 덮을 수 있다. 제대로 고치려면 창을 추측할 게 아니라 전달
                // 여부를 따로 추적해야 한다(별도 과제). 짐작한 창을 다시 넣지 말 것 — 굳은 행의
                // 자가치유를 막는 대가가 더 크다.
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

                // **등록 직전에 한 번 더 본다.** 위 확인 뒤로 재계산 분기가 Room upsert 로
                // suspend 하므로, 그 사이에 알람이 배달돼 인계가 시작될 수 있다. 스누즈 행은
                // 재계산에서 빠져 **지난 시각 그대로** 다시 등록되므로, 놓치면 즉시 한 번 더
                // 울린다(Codex #666 P2).
                //
                // **이걸로 경합이 없어지는 건 아니다.** 확인과 등록 사이는 여전히 원자적이지
                // 않다 — 가장 늦은 지점으로 옮겨 창을 줄일 뿐이다. 남는 찰나는 두 겹이 받는다:
                //  - `RingingService.startRinging` 이 `ringingAlarmId == alarmId` 로 중복 시작을
                //    무시한다(정확 알람은 지난 시각을 즉시 발화하므로 대개 여기서 흡수된다).
                //  - 이 복원은 락을 쥔 채 돌아, 그 사이 dismiss/snooze 가 끼어들지 못한다.
                //  - 남는 것은 배달이 늦는 경우인데, 그건 위에 적은 **비정확 알람의 알려진 한계**다.
                //
                // 리시버가 이 락을 잡게 하는 방법은 **쓰지 않는다.** 브로드캐스트 리시버는 제한
                // 시간이 짧고 알람 배달은 즉시여야 하는데, 알람 N개를 도는 복원 임계구역 뒤에
                // 배달을 세우면 울려야 할 알람을 아예 놓친다 — 중복보다 나쁘다.
                if (alarmToSchedule.id in ringingAlarmIdsProvider()) return@forEach
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

    /**
     * 아직 못 올린 내 알람을 서버에 올린다. **이 세션이 소유한 행만** 올린다 — 이유는
     * [AlarmSyncService.syncWithBackend] 의 ownerUserId 설명 참고.
     */
    suspend fun syncWithBackend(api: AlarmTalkApi, token: String): AlarmSyncResult {
        // 올리기 전에 임자 미정 행을 확정한다. 확정 전의 null 은 앞 계정 것일 수 있는데,
        // 그걸 '내 것'으로 보고 올리면 이 계정 서버에 남의 알람이 생긴다.
        val ownershipSettled = settlePendingAlarmOwnership()
        return alarmSyncService.syncWithBackend(
            api = api,
            token = token,
            ownerUserId = currentUserIdProvider()?.takeIf { it.isNotBlank() },
            adoptOwnerlessAlarms = ownershipSettled,
        )
    }

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
    /**
     * 저장 전에 이 드래프트가 실제로 울릴 날짜의 날씨 variant 를 받아 온다.
     *
     * 예전에는 저장한 뒤 워커로 비동기 해결했는데, 그 사이에 알람이 울리면 조건이 미해결이라
     * '오늘 날씨를 못 받았어요' 안내 클립이 나갔다. 정상(온라인) 상황에서는 고른 그 자리에서
     * 해결해 알람이 처음부터 맞는 오디오를 갖게 한다.
     *
     * 오프라인 등으로 실패하면 null 을 돌려주고 저장은 그대로 진행한다 — 22시 갱신과
     * 알람 전까지의 재시도가 채운다. 알람을 못 만들게 막지는 않는다.
     */
    suspend fun resolveWeatherVariantForDraft(
        api: AlarmTalkApi,
        token: String,
        draft: AlarmDraft,
    ): Int? {
        if (draft.bucketId != "weather") return null
        val now = System.currentTimeMillis()
        val holidayPredicate = holidayCalendarStore.holidayPredicate(
            countryCode = currentHolidayCountry(),
            startDate = currentLocalDate(now),
        )
        // 저장 경로(createAlarm)와 같은 계산으로 발사 시각을 구해야, 해결한 날짜와 실제
        // 울리는 날짜가 어긋나지 않는다.
        val fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
            hour = draft.hour,
            minute = draft.minute,
            repeatDaysMask = draft.repeatDaysMask,
            holidayOff = draft.holidayOff,
            nowMillis = now,
            isHoliday = holidayPredicate,
        )
        val zone = java.time.ZoneId.systemDefault()
        val targetDate = java.time.Instant.ofEpochMilli(fireAtMillis)
            .atZone(zone)
            .toLocalDate()
            .toString()
        return runCatching {
            api.getPrerenderVariant(
                authorization = AlarmTalkApiClient.bearer(token),
                context = "wake_weather",
                country = draft.voiceWeatherCountry?.trim()?.takeIf { it.isNotBlank() },
                city = draft.voiceWeatherCity?.trim()?.takeIf { it.isNotBlank() },
                targetDate = targetDate,
                timezone = zone.id,
            ).variantIndex
        }.getOrElse { error ->
            Log.w(TAG, "Pre-save weather variant resolve failed (will retry in background)", error)
            null
        }
    }

    suspend fun resolveDueCloneBucketVariants(api: AlarmTalkApi, token: String): Int {
        val now = System.currentTimeMillis()
        val alarms = alarmDao.getEnabledWeatherBucketAlarms()
            .filter { weatherVariantNeedsRefresh(it, now) }
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
    /**
     * 아직 조건을 못 받은 날씨 알람이 남아 있는가 — 1시간 뒤 재시도를 걸지 정한다.
     * 받아 낸 알람은 곧바로 대상에서 빠지므로, 성공한 뒤에는 재시도가 이어지지 않는다.
     */
    suspend fun hasFailedWeatherRefresh(nowMillis: Long = System.currentTimeMillis()): Boolean =
        alarmDao.getEnabledWeatherBucketAlarms().any { weatherVariantNeedsRefresh(it, nowMillis) }

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
        require(draft.snoozeMinutes in SnoozeMinutes.range) { "Snooze must be between ${SnoozeMinutes.MIN} and ${SnoozeMinutes.MAX} minutes." }
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
        // 충돌 판정 대상은 '이 계정에 보이는 알람'이어야 한다 — 안 보이는 앞 계정 알람으로
        // 시각을 막으면 사용자가 풀 방법이 없다(AlarmDao.countAtTime 주석 참고).
        val conflicts = alarmDao.countAtTime(
            hour = hour,
            minute = minute,
            callerUserId = currentUserIdProvider(),
            excludeId = excludeAlarmId,
        )
        require(conflicts == 0) {
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
        // 교체 대상도 '이 계정에 보이는 알람'만이다. 앞 계정 알람을 고르면 사용자가 본 적도
        // 없는 알람과 그 음성 캐시를 지우게 되는데, 내 알람은 서버에서 되받는 경로가 없다.
        val existing = alarmDao.findAtTime(
            hour = hour,
            minute = minute,
            callerUserId = currentUserIdProvider(),
            excludeId = excludeAlarmId,
        ) ?: return null
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
            // 기기 UI 언어(ISO-639-1)를 보내 비-KR 공휴일 이름을 같은 로케일로 받는다.
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

/**
 * 이 날씨 알람의 조건을 지금 다시 받아야 하는가.
 *
 *  - 준비창(48h): open-meteo 는 며칠 뒤 예보의 정확도가 떨어지므로 곧 울릴 알람만 대상.
 *  - 임박(24h): 신선도 게이트를 무시하고 무조건 다시 받는다. 갱신이 하루 한 번(22시)이라,
 *    12h 게이트를 그대로 두면 '오늘 낮에 해결됨 → 22시엔 신선하다고 건너뜀 → 내일 아침
 *    알람이 어제 조건으로 울림'이 된다. 임박한 알람은 한 번 더 받는 편이 항상 옳다.
 *  - 그 밖: 미해결이거나 마지막 갱신이 12h 이전이면 대상(먼 알람의 과다 호출 방지).
 */
/**
 * 이 날씨 알람의 조건을 지금 받아야 하는가 — **한 발사분에 한 번만** 받는다.
 *
 *  - 준비창(48h) 밖이면 대상이 아니다. open-meteo 는 며칠 뒤 예보의 정확도가 떨어져,
 *    지금 굳히면 엉뚱한 조건이 박힌다.
 *  - 아직 못 받았으면 받는다.
 *  - 이미 받았고 발사까지 24시간 넘게 남았으면 그대로 둔다.
 *  - 임박(24h)했는데 그 값이 '이 발사분의 것'이 아니면 다시 받는다. 판정 기준은
 *    "발사 24시간 이내에 받았는가" — 반복 알람이 한 번 울리고 다음 날로 넘어가면 옛 값은
 *    자연히 이 조건에서 벗어나므로, 별도 상태 없이 발사분마다 정확히 한 번 갱신된다.
 *
 * 재시도 예약도 이 술어를 그대로 쓴다. 받아 낸 순간 조건을 벗어나므로, 성공한 알람에
 * 시간당 재시도가 이어지지 않는다.
 */
internal fun weatherVariantNeedsRefresh(alarm: AlarmEntity, nowMillis: Long): Boolean {
    if (alarm.fireAtMillis > nowMillis + WEATHER_PREPARE_WINDOW_MILLIS) return false
    // 이미 지난 발사분은 준비할 게 없다. 울리는 중이거나 놓친 알람은 해제 전까지 enabled 로
    // 남는데, 그 사이 조건 해결이 계속 실패하면 미해결 분기에 걸려 hasFailedWeatherRefresh 가
    // 시간당 재시도를 무한정 다시 걸고 서버를 두드린다. 반복 알람은 재예약이 다음 발생으로
    // 밀어 주고, 놓친 일회성은 재예약이 끄므로 여기서 걸러도 잃는 갱신이 없다.
    if (alarm.fireAtMillis <= nowMillis) return false
    if (alarm.contextVariantIndex == null) return true
    if (alarm.fireAtMillis > nowMillis + WEATHER_RESOLVE_VALID_WINDOW_MILLIS) return false
    return (alarm.contextResolvedAtMillis ?: 0L) <
        alarm.fireAtMillis - WEATHER_RESOLVE_VALID_WINDOW_MILLIS
}

/** 준비창: 며칠 뒤 예보로 조건을 굳히면 엉뚱해지므로 곧 울릴 알람만 대상으로 삼는다. */
private const val WEATHER_PREPARE_WINDOW_MILLIS = 48 * 60 * 60 * 1000L

/** 이 발사분의 조건으로 인정하는 범위 — 발사 24시간 이내에 받은 값. */
private const val WEATHER_RESOLVE_VALID_WINDOW_MILLIS = 24 * 60 * 60 * 1000L

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
    draftResolvedNow: Boolean = false,
): WeatherVariantState = when {
    // 새로 받아 온 값이 reset 보다 먼저다. 날짜·지역·목소리를 바꾼 편집이야말로 reset 이
    // 켜지는 경우인데, 그때 버려 버리면 저장 전에 받아 온 의미가 없어진다 — 워커가 돌기
    // 전에 울리면 '못 받았어요' 클립이 나간다. 이 값은 이미 새 조건으로 받은 것이다.
    nextBucketId == "weather" && draftResolvedNow && draftIndex != null -> WeatherVariantState(
        index = draftIndex,
        resolvedAtMillis = System.currentTimeMillis(),
    )
    resetWeatherVariant -> WeatherVariantState(index = null, resolvedAtMillis = null)
    // 편집기에서 그대로 실려 온 옛 스냅샷은 쓰지 않는다 — 저장된 최신 값을 덮어쓰면 안 된다.
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
