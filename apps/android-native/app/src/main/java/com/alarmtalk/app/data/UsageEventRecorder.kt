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
                        userId = currentUserId(),
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
