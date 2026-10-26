package com.alarmtalk.app.data

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

    // ── 2판(2026-10-26, `docs/spec/usage-events.md` §7) — shared `USAGE_EVENT_V2_TYPES` 와 같은 목록 ──
    // ⚠ 서버를 먼저 올린다. 모르는 종류는 서버가 배치째 400 으로 거절한다.
    /** 샘플(목소리 미리듣기)이 **실제로 재생을 시작**했다. */
    const val SAMPLE_STARTED = "sample_started"
    /** 그 샘플이 끝까지 재생됐다. 중간에 멈추면 적지 않는다. */
    const val SAMPLE_COMPLETED = "sample_completed"
    const val ONBOARDING_STEP = "onboarding_step"
    /** 로그인 결과. 계정이 생긴 뒤에만 적힌다 — 가입 전 수집은 하지 않는다(§7.4). */
    const val AUTH_RESULT = "auth_result"
    const val VOICE_SELECTED = "voice_selected"
    /** 음성 준비 — **작업 소유자 한 곳**만 적는다: 기본 목소리 전체는 `sync/StockClipPrefetchWorker.kt`, 목소리 하나는 `MainViewModel.cacheVoiceClips`. */
    const val VOICE_PREPARATION_STARTED = "voice_preparation_started"
    const val VOICE_PREPARATION_READY = "voice_preparation_ready"
    const val VOICE_PREPARATION_FAILED = "voice_preparation_failed"
    /** 저장을 눌렀다. ⚠ [ALARM_CREATED] 는 '행이 생겼다' 이고 저장 시도가 아니다. */
    const val ALARM_SAVE_ATTEMPT = "alarm_save_attempt"
    const val ALARM_SAVE_BLOCKED = "alarm_save_blocked"
    /** OS 예약과 오디오 파일이 둘 다 갖춰졌다. */
    const val ALARM_READY = "alarm_ready"
    const val MANUAL_RESULT_REUSED = "manual_result_reused"
    const val GENERATION_OUTCOME = "generation_outcome"
    const val REWARD_OFFER = "reward_offer"
    const val REWARD_VIEW_STARTED = "reward_view_started"
    const val REWARD_PENDING = "reward_pending"
    const val REWARD_GRANTED = "reward_granted"
    const val REWARD_SPENT = "reward_spent"
    // 콘텐츠·소식 — 스키마만. 그 기능 PR 이 심는다.
    const val CONTENT_SELECTED = "content_selected"
    const val DATED_ALARM_SAVED = "dated_alarm_saved"
    const val PACK_SELECTED = "pack_selected"
    const val BRIEFING_OPENED = "briefing_opened"
    const val SOURCE_OPENED = "source_opened"
    const val BRIEFING_AUDIO_REQUESTED = "briefing_audio_requested"
    const val PAYWALL_VIEWED = "paywall_viewed"
    const val STORE_PURCHASE_VERIFIED = "store_purchase_verified"
    const val ENTITLEMENT_CHANGED = "entitlement_changed"

    /** 지금 기록기가 적는 스키마 판. 1판 종류도 2 로 적는다(앱 버전을 싣는다). */
    const val SCHEMA_VERSION = 2
}

class UsageEventRecorder(
    private val dao: UsageEventDao,
    /** **적는 순간의** 앱 버전(versionCode). 테스트가 바꿔 넣는다. */
    private val appVersion: String = com.alarmtalk.app.BuildConfig.VERSION_CODE.toString(),
    // 계정은 마지막 인자다 — 부르는 쪽이 뒤따르는 람다로 넘긴다(`UsageEventRecorderAccountTest`).
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
        /** 한 시도를 묶는 UUID(시작·완료·실패가 같은 값). [UsageEventProps.newAttemptId]. */
        attemptId: String? = null,
        /** 그 흐름의 판(예: `prep-1`). */
        featureVersion: String? = null,
        /** 2판의 정해진 칸. 모양이 틀린 칸은 [UsageEventProps.sanitized] 가 비운다(배치 전체가 400 이 되지 않게). */
        props: UsageEventProps? = null,
    ) {
        // 계정은 **적는 순간**에 정한다 — 코루틴이 실제로 도는 시점이 아니라. 안에서 읽으면
        // 그 틈에 로그아웃·로그인이 끼어들 때 A 의 사건이 B 의 이름으로 저장된다(서버는
        // 토큰의 주인으로 적으므로 되돌릴 수 없다). iOS `UsageEventQueue.record` 와 한 쌍이다.
        //
        // ⚠ **그 조회도 실패할 수 있다 — 여기서 새면 알람이 죽는다.** 계정은 암호화
        // 프리퍼런스에서 읽는데(키스토어), 키가 무효화되거나 파일이 깨지면 `getString` 이
        // `SecurityException` 을 던진다. `RingingService.dismiss` 는 소리를 끄기 **전에**
        // 이 함수를 부르므로(메인 스레드), 새어 나가면 소리를 끄고 다음 예약을 잡는 일이
        // 통째로 죽는다 — 기록은 곁다리인데 본업을 막는다.
        //
        // ⚠ **해제와 다시 울림은 부르는 자리가 다르다 — 맞춰 놓지 말 것.** 다시 울림은
        // 2026-09-07 리뷰 37차부터 `stopRingingOutputs` 뒤 `serviceScope`(IO)에서 부른다:
        // 누른 것과 미뤄진 것이 달라 **결과를 보고** 적어야 하기 때문이다. 해제는 누름과
        // 결과가 언제나 같으므로 누른 자리에 그대로 둔다 — 이 클래스의 [scope] 는 프로세스
        // 수명이지만 `serviceScope` 는 `onDestroy` 에서 취소되므로, 옮기면 서비스가 먼저
        // 죽은 회차의 해제가 통째로 사라진다(`docs/spec/usage-events.md` 구현 지도 「해제」).
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
        val propsJson = runCatching { props?.sanitized()?.takeUnless { it.isEmpty() }?.toJson() }.getOrNull()
        val safeAttemptId = attemptId?.takeIf(UsageEventProps::isUuid)
        val safeFeatureVersion = featureVersion?.takeIf { FEATURE_VERSION.matches(it) }
        scope.launch {
            runCatching {
                dao.insert(
                    UsageEventEntity(
                        id = UUID.randomUUID().toString(),
                        type = type,
                        occurredAtMillis = occurredAtMillis,
                        // ⚠ 서버는 세 식별자를 UUID 로 검증하고 하나라도 틀리면 **배치째 400** 이다 — 큐 맨 앞에서 영원히
                        //   다시 간다. 모양이 아니면 그 칸만 비운다(사건은 남긴다 — §1 「식별자를 못 붙여도 적는다」).
                        alarmId = alarmId?.takeIf(UsageEventProps::isUuid),
                        voiceProfileId = voiceProfileId?.takeIf(UsageEventProps::isUuid),
                        messageId = messageId?.takeIf(UsageEventProps::isUuid),
                        detail = detail?.take(120),
                        userId = userId,
                        schemaVersion = UsageEvents.SCHEMA_VERSION,
                        appVersion = appVersion.takeIf { FEATURE_VERSION.matches(it) },
                        featureVersion = safeFeatureVersion,
                        attemptId = safeAttemptId,
                        propsJson = propsJson,
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
    private companion object {
        /** 서버 `VersionSchema` 와 같은 모양. */
        val FEATURE_VERSION = Regex("^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$")
    }

    private suspend fun trimIfNeeded() {
        val count = dao.count()
        if (count <= queueLimit) return
        dao.deleteOldest(count - queueLimit)
        Log.i(AlarmTalkLog.TAG, "Trimmed usage event queue to $queueLimit (was $count)")
    }
}
