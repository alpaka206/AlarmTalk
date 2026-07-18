package com.alarmtalk.app.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface AlarmDao {
    @Query("SELECT * FROM alarms ORDER BY hour ASC, minute ASC, createdAtMillis ASC")
    fun observeAlarms(): Flow<List<AlarmEntity>>

    @Query("SELECT * FROM alarms WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): AlarmEntity?

    @Query("SELECT * FROM alarms WHERE remoteAlarmId = :remoteAlarmId LIMIT 1")
    suspend fun getByRemoteAlarmId(remoteAlarmId: String): AlarmEntity?

    /** 같은 서버 알람을 가리키는 모든 로컬 행 — 과거 동시 pull 레이스로 생긴 중복 임포트 정리용. */
    @Query("SELECT * FROM alarms WHERE remoteAlarmId = :remoteAlarmId ORDER BY createdAtMillis")
    suspend fun getAllByRemoteAlarmId(remoteAlarmId: String): List<AlarmEntity>

    /** 같은 시각에 켜져 있는 알람 전부 — 받은 알람 임포트 시 '보낸 사람 알람 우선' 대체 정책에 쓴다. */
    @Query(
        """
        SELECT * FROM alarms
        WHERE hour = :hour
          AND minute = :minute
          AND enabled = 1
          AND (:excludeId IS NULL OR id != :excludeId)
        """,
    )
    suspend fun getEnabledAtTime(hour: Int, minute: Int, excludeId: String? = null): List<AlarmEntity>

    @Query(
        """
        SELECT * FROM alarms
        WHERE enabled = 1
        ORDER BY fireAtMillis ASC
        """,
    )
    suspend fun getEnabledAlarms(): List<AlarmEntity>

    @Query("SELECT * FROM alarms ORDER BY hour ASC, minute ASC, createdAtMillis ASC")
    suspend fun getAllAlarms(): List<AlarmEntity>

    @Query(
        """
        SELECT * FROM alarms
        WHERE enabled = 1
          AND repeatDaysMask != 0
          AND voiceRandomPrompt = 1
          AND playMode != 'alarm_only'
          AND voiceProfileId IS NOT NULL
          AND bucketId IS NULL
        ORDER BY fireAtMillis ASC
        """,
    )
    suspend fun getRepeatingDynamicAlarmTalks(): List<AlarmEntity>

    // 사전렌더 '날씨' 버킷 알람(반복+일회성). 준비창 워커가 저장 위치로 서버에 조건을 resolve 해
    // contextVariantIndex 를 갱신한다. dismiss 로 enabled=0 된 일회성은 자동 제외.
    @Query(
        """
        SELECT * FROM alarms
        WHERE enabled = 1
          AND bucketId = 'weather'
          AND voiceProfileId IS NOT NULL
        ORDER BY fireAtMillis ASC
        """,
    )
    suspend fun getEnabledWeatherBucketAlarms(): List<AlarmEntity>

    // resolvedAtMillis 는 전용 게이트 컬럼(contextResolvedAtMillis). updatedAtMillis 를 건드리지 않아
    // (a) 인덱스 불변이어도 게이트가 전진하고 (b) 무관 편집이 날씨 재해결 시계를 리셋하지 않는다.
    // fireDateStart/End: variant 는 특정 타깃 날짜로 resolve 되므로, 네트워크 왕복 중 사용자가 시간·날짜를
    // 바꿔 fireAtMillis 가 그 날짜 범위를 벗어났으면 옛 날짜 결과를 쓰지 않는다(써 버리면 fresh 타임스탬프로
    // 12h 게이트가 전진해 올바른 재해결이 막힌다). 범위는 [start, end) 반개구간.
    @Query(
        """
        UPDATE alarms
        SET contextVariantIndex = :index, contextResolvedAtMillis = :resolvedAtMillis
        WHERE id = :id
          AND bucketId = 'weather'
          AND COALESCE(voiceProfileId, '') = :voiceProfileId
          AND TRIM(COALESCE(voiceWeatherCountry, '')) = :country
          AND TRIM(COALESCE(voiceWeatherCity, '')) = :city
          AND fireAtMillis >= :fireDateStartMillis
          AND fireAtMillis < :fireDateEndMillis
        """,
    )
    suspend fun updateContextVariantIndexIfContextMatches(
        id: String,
        index: Int,
        resolvedAtMillis: Long,
        voiceProfileId: String,
        country: String,
        city: String,
        fireDateStartMillis: Long,
        fireDateEndMillis: Long,
    ): Int

    @Query(
        """
        SELECT COUNT(*) FROM alarms
        WHERE hour = :hour
          AND minute = :minute
          AND (:excludeId IS NULL OR id != :excludeId)
        """,
    )
    suspend fun countAtTime(hour: Int, minute: Int, excludeId: String? = null): Int

    /** 같은 시각(HH:mm)의 기존 알람 1건. 중복 시각 교체 흐름에서 충돌 대상을 찾는 데 쓴다. */
    @Query(
        """
        SELECT * FROM alarms
        WHERE hour = :hour
          AND minute = :minute
          AND (:excludeId IS NULL OR id != :excludeId)
        LIMIT 1
        """,
    )
    suspend fun findAtTime(hour: Int, minute: Int, excludeId: String? = null): AlarmEntity?

    @Query("SELECT COUNT(*) FROM alarms WHERE audioCacheKey = :cacheKey")
    suspend fun countByAudioCacheKey(cacheKey: String): Int

    @Upsert
    suspend fun upsert(alarm: AlarmEntity)

    /**
     * 사용자 편집 커밋용 전체행 upsert. 커밋 직전 같은 트랜잭션 안에서 DB 의 최신
     * remoteAlarmId/lastSyncedAtMillis 와, 동일 날씨 컨텍스트의 variant/freshness 를
     * [updated] 에 병합한 뒤 저장한다. sync/worker 만 갱신하는 값을 편집이 읽은 stale
     * 스냅샷으로 덮어쓰지 않는다.
     *
     * 이 병합이 없으면 '신규 알람 create 왕복 중 편집' 경합에서 remoteAlarmId 가 유실된다:
     * 편집이 읽은 스냅샷은 remoteAlarmId=null 인데, 그 사이 sync 의 CAS
     * ([setSyncStateIfUnchanged])가 발급받은 remoteAlarmId 를 커밋하고, 뒤이어 편집의
     * 전체행 [upsert] 가 그 값을 stale null 로 되돌린다 → 다음 sync 가 remoteAlarmId==null
     * 을 보고 create 로 재진입해 서버에 '중복 알람' 을 만든다. CAS 는 '편집 커밋이 CAS 보다
     * 먼저' 인 순서만 방어하므로, 여기서 @Transaction 으로 재-read+upsert 를 원자화해
     * '편집 upsert 가 CAS 이후' 순서에서도 유실을 막는다.
     */
    @Transaction
    suspend fun upsertPreservingServerSyncFields(updated: AlarmEntity) {
        val fresh = getById(updated.id)
        val merged = if (fresh == null) {
            updated
        } else {
            val preserveFreshWeatherVariant = updated.bucketId == "weather" &&
                !shouldResetWeatherVariant(
                    currentBucketId = fresh.bucketId,
                    nextBucketId = updated.bucketId,
                    currentVoiceProfileId = fresh.voiceProfileId,
                    nextVoiceProfileId = updated.voiceProfileId,
                    currentCountry = fresh.voiceWeatherCountry,
                    nextCountry = updated.voiceWeatherCountry,
                    currentCity = fresh.voiceWeatherCity,
                    nextCity = updated.voiceWeatherCity,
                    // 발사 날짜가 바뀐 편집/재활성화면 리셋된 null 을 fresh 의 옛 인덱스로 되덮지 않는다.
                    currentFireAtMillis = fresh.fireAtMillis,
                    nextFireAtMillis = updated.fireAtMillis,
                )
            updated.copy(
                remoteAlarmId = fresh.remoteAlarmId,
                lastSyncedAtMillis = fresh.lastSyncedAtMillis,
                contextVariantIndex = if (preserveFreshWeatherVariant) {
                    fresh.contextVariantIndex
                } else {
                    updated.contextVariantIndex
                },
                contextResolvedAtMillis = if (preserveFreshWeatherVariant) {
                    fresh.contextResolvedAtMillis
                } else {
                    updated.contextResolvedAtMillis
                },
            )
        }
        upsert(merged)
    }

    @Delete
    suspend fun delete(alarm: AlarmEntity)

    @Query(
        """
        UPDATE alarms
        SET state = :state, enabled = :enabled, updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun setState(
        id: String,
        state: String,
        enabled: Boolean,
        updatedAtMillis: Long,
    )

    @Query(
        """
        UPDATE alarms
        SET fireAtMillis = :fireAtMillis,
            state = :state,
            enabled = :enabled,
            updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun setScheduleState(
        id: String,
        fireAtMillis: Long,
        state: String,
        enabled: Boolean,
        updatedAtMillis: Long,
    )

    @Query(
        """
        UPDATE alarms
        SET remoteAlarmId = :remoteAlarmId,
            lastSyncedAtMillis = :lastSyncedAtMillis,
            syncState = :syncState,
            updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun setSyncState(
        id: String,
        remoteAlarmId: String?,
        lastSyncedAtMillis: Long?,
        syncState: String,
        updatedAtMillis: Long,
    )

    /**
     * 동시 편집 방어용 조건부 SYNCED 전환. 스냅샷 시점 updatedAtMillis(:expectedUpdatedAtMillis)와
     * 현재 행의 updatedAtMillis 가 일치할 때만 SYNCED 로 덮는다. 네트워크 sync 구간에 사용자가
     * 같은 알람을 편집해 updatedAtMillis 가 바뀌었으면 매칭되지 않아 반환값이 0 이 되고, 이때
     * 호출부가 DIRTY 를 보존해 다음 sync 에서 재전송하도록 한다. 반환값은 갱신된 행 수.
     */
    @Query(
        """
        UPDATE alarms
        SET remoteAlarmId = :remoteAlarmId,
            lastSyncedAtMillis = :lastSyncedAtMillis,
            syncState = :syncState,
            updatedAtMillis = :newUpdatedAtMillis
        WHERE id = :id AND updatedAtMillis = :expectedUpdatedAtMillis
        """,
    )
    suspend fun setSyncStateIfUnchanged(
        id: String,
        remoteAlarmId: String?,
        lastSyncedAtMillis: Long?,
        syncState: String,
        newUpdatedAtMillis: Long,
        expectedUpdatedAtMillis: Long,
    ): Int

    /**
     * 신규 생성 커밋 중 동시 편집이 감지됐을 때(create 응답 커밋과 사용자 편집 경합) 쓰는 폴백.
     * 서버가 발급한 remoteAlarmId 는 반드시 저장해 다음 sync 가 '중복 create' 가 아니라 update 로
     * 재전송하도록 하되, syncState 는 DIRTY 로 두고 updatedAtMillis 는 건드리지 않아 사용자의 편집
     * (updatedAtMillis/페이로드)이 SYNCED 로 덮여 유실되지 않게 보존한다.
     */
    @Query(
        """
        UPDATE alarms
        SET remoteAlarmId = :remoteAlarmId,
            lastSyncedAtMillis = :lastSyncedAtMillis,
            syncState = 'dirty'
        WHERE id = :id
        """,
    )
    suspend fun markRemoteIdKeepDirty(
        id: String,
        remoteAlarmId: String?,
        lastSyncedAtMillis: Long?,
    )

    @Query(
        """
        UPDATE alarms
        SET localAudioUri = :localAudioUri,
            audioCacheKey = :audioCacheKey,
            rawAudioUri = :rawAudioUri,
            voiceText = :voiceText,
            ttsMessageId = :ttsMessageId,
            dynamicVoicePreparedForFireAtMillis = :preparedForFireAtMillis,
            updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun updateDynamicVoiceAudio(
        id: String,
        localAudioUri: String,
        audioCacheKey: String?,
        rawAudioUri: String?,
        voiceText: String,
        ttsMessageId: String?,
        preparedForFireAtMillis: Long,
        updatedAtMillis: Long,
    )

    /** 무료 버킷 회전 인덱스를 다음 값으로 영속화한다(알람이 울린 직후 호출). */
    @Query(
        """
        UPDATE alarms
        SET bucketRotationIndex = :index, updatedAtMillis = :updatedAtMillis
        WHERE id = :id
        """,
    )
    suspend fun updateBucketRotationIndex(id: String, index: Int, updatedAtMillis: Long)
}
