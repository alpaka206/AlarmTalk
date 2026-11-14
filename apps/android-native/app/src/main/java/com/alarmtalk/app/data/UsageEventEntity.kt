package com.alarmtalk.app.data

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * **아직 서버에 못 보낸 사용 기록.** 오프라인에서도 알람은 만들어지고 울리므로, 그 사건을
 * 여기 적어 두었다가 연결되면 모아 보낸다(`UsageEventUploadWorker`).
 *
 * ⚠ **울릴 때 네트워크를 부르지 않는다.** 알람 경로는 로컬·오프라인이 원칙이라
 * (CLAUDE.md 「Real alarm」) 울림은 이 테이블에 적기만 하고, 전송은 그 뒤 아무 때나 한다.
 *
 * ⚠ **개인 텍스트를 넣지 않는다.** 문구 원문은 이미 알람 행에 있고, 여기 사본을 만들면
 * 목소리 삭제·동의 철회 때 지워야 할 곳이 하나 더 늘어난다 — 식별자만 담는다.
 */
@Entity(tableName = "usage_events")
data class UsageEventEntity(
    /**
     * **기기가 만든 UUID.** 서버 PK 로 그대로 쓰이고 `INSERT OR IGNORE` 와 짝이 되어
     * 재전송을 멱등으로 만든다 — 응답을 못 받은 배치를 다시 보내도 같은 사건이 겹치지 않는다.
     */
    @PrimaryKey val id: String,
    val type: String,
    /** 기기에서 **일어난** 시각. 며칠 늦게 보내도 이 값이 진실이다. */
    val occurredAtMillis: Long,
    val alarmId: String? = null,
    val voiceProfileId: String? = null,
    val messageId: String? = null,
    /** 짧은 부가 값(예: 스누즈 회차). 자유 문자열은 이것 하나뿐이다. */
    val detail: String? = null,
    /**
     * 이 이벤트를 **어느 계정에서** 남겼는가.
     *
     * ⚠ 계정이 바뀌면 남은 큐를 보내지 않는다 — 서버는 토큰의 주인으로 기록하므로,
     * A 가 만든 사건이 B 의 기록에 들어가면 되돌릴 방법이 없다.
     */
    val userId: String? = null,
    /**
     * 스키마 판(`docs/spec/usage-events.md` §7). 2026-10-26 전에 적힌 행은 1(마이그레이션 28→29 기본값)이고 공통 필드가
     * 비어 있다 — 그대로 1판으로 보낸다. 지금 기록기는 1판 종류도 2 로 적는다(앱 버전을 싣는다).
     */
    @ColumnInfo(defaultValue = "1") val schemaVersion: Int = 1,
    /** **적는 순간의** versionCode. 업데이트를 건너 남은 행이 보내는 앱의 버전으로 둔갑하지 않게 여기 적는다. */
    val appVersion: String? = null,
    /** 그 기록을 만든 흐름의 판(예: `prep-1`). */
    val featureVersion: String? = null,
    /** 한 시도(준비·저장·제작·광고 보상)를 묶는 UUID. 시작·완료·실패가 같은 값을 쓴다. */
    val attemptId: String? = null,
    /**
     * 정해진 칸([UsageEventProps])을 Gson 으로 적은 JSON. **로컬 저장 형식일 뿐**이고 전송은 `props` 객체다.
     * ⚠ 문구 원문·이름·이메일을 넣을 칸은 없다 — [UsageEventProps] 에 없는 것은 적히지 않는다.
     */
    val propsJson: String? = null,
)

@Dao
interface UsageEventDao {
    /** 같은 id 는 무시한다 — 기록 지점이 두 번 불려도 사건이 겹치지 않는다. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: UsageEventEntity)

    /**
     * ⚠ **주인 없는 행은 꺼내지 않는다.** 기록기가 계정을 모르면 아예 적지 않으므로
     * (`UsageEventRecorder.record`) 그런 행은 옛 빌드가 남긴 것뿐이고, 지금 로그인한
     * 사람에게 붙이면 **되돌릴 수 없는 오기록**이 된다(서버는 토큰의 주인으로 적는다).
     */
    @Query("SELECT * FROM usage_events WHERE userId = :userId ORDER BY occurredAtMillis ASC LIMIT :limit")
    suspend fun oldest(userId: String, limit: Int): List<UsageEventEntity>

    @Query("DELETE FROM usage_events WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("SELECT COUNT(*) FROM usage_events")
    suspend fun count(): Int

    /**
     * 큐가 넘치지 않게 **가장 오래된 것부터** 버린다.
     *
     * 기록은 있으면 좋은 것이지 알람의 조건이 아니다 — 몇 달치가 밀려 저장소를 먹는 것보다
     * 오래된 몇 건을 잃는 편이 낫다.
     */
    @Query(
        "DELETE FROM usage_events WHERE id IN (" +
            "SELECT id FROM usage_events ORDER BY occurredAtMillis ASC LIMIT :count)",
    )
    suspend fun deleteOldest(count: Int)
}
