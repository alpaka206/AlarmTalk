package com.alarmtalk.app.data

import android.content.Context
import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 사용 기록을 **로컬 큐에 적는다.** 보내는 일은 `UsageEventUploadWorker` 가 한다.
 *
 * ⚠ **기록이 실패해도 하던 일을 막지 않는다.** 알람을 만들고 지우고 울리는 것이 본업이고,
 * 기록은 곁다리다 — 여기서 예외가 새어 나가면 그 본업이 실패한다. 그래서 모든 경로가
 * `runCatching` 으로 감싸여 있고, 실패는 로그로만 남는다.
 *
 * ⚠ **울릴 때 네트워크를 부르지 않는다**(CLAUDE.md 「Real alarm」). 이 클래스는 DB 에
 * 적기만 한다 — 전송은 워커가 나중에 한다.
 */
object UsageEvents {
    const val ALARM_CREATED = "alarm_created"
    const val ALARM_UPDATED = "alarm_updated"
    const val ALARM_DELETED = "alarm_deleted"
    const val ALARM_RANG = "alarm_rang"
    const val ALARM_DISMISSED = "alarm_dismissed"
    const val ALARM_SNOOZED = "alarm_snoozed"

    /** 직접 입력 문구를 알람에 붙였다 = 그 오디오가 이 기기에서 '사용중'이 됐다. */
    const val MANUAL_MESSAGE_ATTACHED = "manual_message_attached"

    /** 그 문구를 쓰는 알람이 이 기기에서 모두 사라져 오디오를 지웠다 = '비사용중'. */
    const val MANUAL_MESSAGE_RELEASED = "manual_message_released"

    const val VOICE_CREATED = "voice_created"
    const val VOICE_DELETED = "voice_deleted"
}

class UsageEventRecorder(
    private val dao: UsageEventDao,
    private val currentUserId: () -> String?,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** 큐 상한. 넘치면 가장 오래된 것부터 버린다(아래 [trimIfNeeded] 주석). */
    private val queueLimit = 2000

    /**
     * 사건 하나를 적는다. **부르는 쪽을 기다리게 하지 않는다** — 울림 경로처럼 한 순간도
     * 늦출 수 없는 자리에서도 부를 수 있어야 한다.
     */
    fun record(
        type: String,
        alarmId: String? = null,
        voiceProfileId: String? = null,
        messageId: String? = null,
        detail: String? = null,
        occurredAtMillis: Long = System.currentTimeMillis(),
    ) {
        // 계정은 **적는 순간**에 정한다 — 코루틴이 실제로 도는 시점이 아니라. 안에서 읽으면
        // 그 틈에 로그아웃·로그인이 끼어들 때 A 의 사건이 B 의 이름으로 저장된다(서버는
        // 토큰의 주인으로 적으므로 되돌릴 수 없다). iOS `UsageEventQueue.record` 와 한 쌍이다.
        //
        // ⚠ **그 조회도 실패할 수 있다 — 여기서 새면 알람이 죽는다.** 계정은 암호화
        // 프리퍼런스에서 읽는데(키스토어), 키가 무효화되거나 파일이 깨지면 `getString` 이
        // `SecurityException` 을 던진다. `RingingService` 는 해제·다시 울림에서 **이 함수를
        // 먼저** 부르므로(메인 스레드), 새어 나가면 소리를 끄고 다음 예약을 잡는 일이
        // 통째로 죽는다 — 기록은 곁다리인데 본업을 막는다.
        // 못 읽으면 **그 기록을 버린다.** 계정을 비워 두면 다음에 로그인한 사람의 기록으로
        // 올라가므로(`UsageEventDao.oldest` 는 null 을 아무에게나 준다) 그게 더 나쁘다.
        val userId = runCatching { currentUserId() }.getOrElse { error ->
            Log.w(AlarmTalkLog.TAG, "Failed to resolve account for usage event type=$type", error)
            null
        }?.takeIf { it.isNotBlank() } ?: run {
            // 던지지 않고 **null 을 돌려주는** 갈래도 같다 — 로그아웃 중이거나(자동 401 로
            // 세션만 잃은 구간 포함) 저장소에 계정이 없을 때다. 주인 없는 사건은 서버가
            // `user_id NOT NULL` 로 받으므로 어차피 올바르게 올릴 방법이 없다.
            Log.i(AlarmTalkLog.TAG, "Skipping usage event without account type=$type")
            return
        }
        scope.launch {
            runCatching {
                dao.insert(
                    UsageEventEntity(
                        id = UUID.randomUUID().toString(),
                        type = type,
                        occurredAtMillis = occurredAtMillis,
                        alarmId = alarmId,
                        voiceProfileId = voiceProfileId,
                        messageId = messageId,
                        detail = detail?.take(120),
                        userId = userId,
                    ),
                )
                trimIfNeeded()
            }.onFailure { error ->
                // 기록 실패는 조용히 넘긴다 — 이것 때문에 알람이 실패하면 본말이 전도된다.
                Log.w(AlarmTalkLog.TAG, "Failed to record usage event type=$type", error)
            }
        }
    }

    /**
     * 큐가 넘치면 **가장 오래된 것부터** 버린다.
     *
     * 오래 오프라인이었거나 서버가 계속 거절하면 큐만 자란다. 기록은 있으면 좋은 것이지
     * 알람의 조건이 아니므로, 저장소를 먹는 것보다 오래된 몇 건을 잃는 편이 낫다.
     */
    private suspend fun trimIfNeeded() {
        val count = dao.count()
        if (count <= queueLimit) return
        dao.deleteOldest(count - queueLimit)
        Log.i(AlarmTalkLog.TAG, "Trimmed usage event queue to $queueLimit (was $count)")
    }
}
