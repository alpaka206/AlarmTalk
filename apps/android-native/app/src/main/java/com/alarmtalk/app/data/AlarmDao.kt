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

    /**
     * "한 시각에는 알람 하나" 정책의 충돌 개수. 대상은 **이 계정에 보이는 알람**으로 한정한다
     * ([AlarmRepository.observeAlarms] 와 같은 규칙).
     *
     * 로컬 알람은 로그아웃해도 남으므로, 소유자를 안 보면 앞 계정 A 의 07:00 알람 때문에 B 가
     * 07:00 을 못 쓴다 — 목록에는 안 보이니 지울 수도 없다. 게다가 교체 흐름으로 넘어가면
     * A 의 알람과 음성 캐시가 영구 삭제된다(내 알람은 서버에서 되받는 경로가 없다).
     */
    @Query(
        """
        SELECT COUNT(*) FROM alarms
        WHERE hour = :hour
          AND minute = :minute
          AND (:excludeId IS NULL OR id != :excludeId)
          AND (ownerUserId IS NULL OR ownerUserId = :callerUserId)
        """,
    )
    suspend fun countAtTime(hour: Int, minute: Int, callerUserId: String?, excludeId: String? = null): Int

    /** 같은 시각(HH:mm)의 기존 알람 1건. 중복 시각 교체 흐름에서 충돌 대상을 찾는 데 쓴다. */
    @Query(
        """
        SELECT * FROM alarms
        WHERE hour = :hour
          AND minute = :minute
          AND (:excludeId IS NULL OR id != :excludeId)
          AND (ownerUserId IS NULL OR ownerUserId = :callerUserId)
        LIMIT 1
        """,
    )
    suspend fun findAtTime(hour: Int, minute: Int, callerUserId: String?, excludeId: String? = null): AlarmEntity?

    @Query("SELECT COUNT(*) FROM alarms WHERE audioCacheKey = :cacheKey")
    suspend fun countByAudioCacheKey(cacheKey: String): Int

    @Upsert
    suspend fun upsertRow(alarm: AlarmEntity)

    /**
     * 전체행 저장. 소유자(ownerUserId)만은 DB 에 이미 박힌 값을 지킨다.
     *
     * 소유자는 세션이 끝날 때 한 번 새겨지는데([claimUnownedAlarms]), 하필 그 시점에
     * 편집기·스누즈·반복 알람 해제가 '소유자 없음' 스냅샷을 들고 있다가 나중에 커밋하면
     * 방금 새긴 소유자가 다시 null 로 돌아간다. 그러면 다음에 로그인한 다른 계정이 그
     * 알람을 자기 것으로 삼아 예약·발사한다 — 소유자를 새기는 이유 자체가 무력해진다
     * (Codex #650). 편집 커밋이 remoteAlarmId 를 stale null 로 되돌리던 문제
     * ([upsertPreservingServerSyncFields])와 같은 모양이라 방어도 같게 둔다.
     *
     * 되돌리는 방향(값 있음 → null)만 막는다. 신규 행은 DB 에 값이 없어 그대로 저장되고,
     * 소유자를 정하는 정상 경로(생성·claim)는 null 이 아닌 값을 들고 오므로 영향이 없다.
     */
    @Transaction
    suspend fun upsert(alarm: AlarmEntity) {
        if (alarm.ownerUserId != null) {
            upsertRow(alarm)
            return
        }
        val claimedOwner = getById(alarm.id)?.ownerUserId
        upsertRow(if (claimedOwner == null) alarm else alarm.copy(ownerUserId = claimedOwner))
    }

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

    /**
     * 소유자 미기록 행에 계정을 새긴다. 반환값은 새긴 행 수.
     *
     * 읽고-고쳐-upsert 하면 안 된다: 세션 만료 처리 중에도 리시버(발사·스누즈)·동기화 워커·
     * 사용자 편집이 같은 행을 쓰므로, 스냅샷 전체를 되쓰면 그 사이의 변경(fireAtMillis·
     * enabled·state)이 옛 값으로 되돌아간다. 컬럼 하나만 원자적으로 바꾼다.
     *
     * updatedAtMillis 는 일부러 건드리지 않는다 — 소유자는 서버로 나가지 않는 로컬 전용
     * 개념인데, 여기서 시각을 올리면 AlarmSyncService 의 expectedUpdatedAtMillis 낙관적
     * 동시성이 '사용자 편집'으로 오인해 동기화 상태가 어긋난다.
     */
    @Query(
        """
        UPDATE alarms
        SET ownerUserId = :userId
        WHERE ownerUserId IS NULL
        """,
    )
    suspend fun claimUnownedAlarms(userId: String): Int

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
