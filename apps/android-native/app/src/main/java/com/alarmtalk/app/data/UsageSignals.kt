package com.alarmtalk.app.data

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.network.AuthSessionStore

/**
 * 사용 기록 2판(`docs/spec/usage-events.md` §7)을 **호출부에서 짧게** 적기 위한 도우미.
 *
 * ⚠ 적기만 한다 — 네트워크를 부르지 않는다. 기록기([UsageEventRecorder])가 계정을 모르면 버리므로 가입 전 사건은
 *   남지 않는다(§7.4). 그 사건을 모아 두었다가 로그인 뒤 붙여 보내는 우회를 여기 만들지 말 것.
 * ⚠ 기록이 실패해도 하던 일을 막지 않는다 — 모든 길이 예외를 삼킨다.
 */
internal object UsageSignals {
    /** 단조 시계(밀리초). `duration_ms` 는 언제나 이것의 차이다 — 벽시계를 돌려도 음수가 나오지 않는다. */
    fun monotonicNow(): Long = SystemClock.elapsedRealtime()

    fun record(
        context: Context,
        type: String,
        alarmId: String? = null,
        voiceProfileId: String? = null,
        messageId: String? = null,
        attemptId: String? = null,
        featureVersion: String? = null,
        props: UsageEventProps? = null,
        /** 비동기 흐름을 시작한 계정 — [UsageEventRecorder.record] 의 `ownerUserId`. */
        ownerUserId: String? = null,
    ) {
        runCatching {
            AlarmAppContainer.usageEventRecorder(context.applicationContext).record(
                type = type,
                alarmId = alarmId,
                voiceProfileId = voiceProfileId,
                messageId = messageId,
                attemptId = attemptId,
                featureVersion = featureVersion,
                props = props,
                ownerUserId = ownerUserId,
            )
        }.onFailure { error -> Log.w(AlarmTalkLog.TAG, "Failed to record usage signal type=$type", error) }
    }

    /**
     * 편집기에서 목소리를 **골랐다**(미리 골라 둔 값은 아니다). `is_first` 는 이 계정에 직전에 쓴 목소리
     * 기록(`DefaultVoicePreferenceStore`)이 없는가, `prepared` 는 그 순간 기기에 준비돼 있었는가다.
     */
    fun voiceSelected(context: Context, voiceProfileId: String, prepared: Boolean) {
        val isFirst = runCatching {
            val userId = AuthSessionStore(context.applicationContext).read()?.user?.id
            DefaultVoicePreferenceStore(context.applicationContext).read(userId).isNullOrBlank()
        }.getOrNull()
        record(
            context,
            UsageEvents.VOICE_SELECTED,
            voiceProfileId = voiceProfileId,
            props = UsageEventProps(
                // 기본 목소리는 id 가 곧 팩 키다. 내 목소리(UUID 가 아닌 값이 올 일은 없다)도 같은 칸 — 모양이 아니면 비운다.
                packId = UsageEventProps.code(voiceProfileId).takeIf { isSystemVoiceId(voiceProfileId) },
                isFirst = isFirst,
                prepared = prepared,
                surface = "editor",
            ),
        )
    }
}

/**
 * 응원의 '다양하게 / 이 문구로 고정'(`content_selected`, `docs/spec/voice-and-message.md` §5-4) — **저장에 성공한** 알람의
 * 선택이다. 부르는 자리는 저장 성공 한 곳뿐이다(`MainViewModelAlarmActions` 의 create/update `onSuccess` — 「직전 선택 유지」와
 * 같은 시점). 편집기에서 눌러만 보고 취소한 것은 적지 않는다.
 *
 * 응원 알람이 아니면(테마가 다르거나 저장값이 없다) 적지 않는다 — 응원 테마가 아닌 알람은 모드를 저장하지 않는다.
 * ⚠ 고정한 문구 ID(`cheer_v2_05`)는 싣지 않는다. 그 ID 를 담을 정해진 칸이 없고(`pack_id` 는 팩·테마·목소리 키다), 칸을 새로
 *   만들려면 서버를 먼저 올려야 한다(§7.2). 모드만 남긴다.
 */
internal fun contentSelectionProps(bucketId: String?, cheerMode: String?): UsageEventProps? {
    if (bucketId != CHEER_BUCKET_ID || cheerMode == null) return null
    val mode = if (CheerModes.normalize(cheerMode) == CheerModes.PINNED) {
        UsageEventProps.CONTENT_FIXED
    } else {
        UsageEventProps.CONTENT_VARIED
    }
    return UsageEventProps(contentMode = mode)
}

/** [contentSelectionProps] 를 적는다. [ownerUserId] 는 저장을 **시작한** 계정이다(저장은 날씨 조회까지 타는 비동기다). */
internal fun recordContentSelected(context: Context, saved: AlarmEntity, ownerUserId: String?) {
    val props = contentSelectionProps(saved.bucketId, saved.cheerMode) ?: return
    UsageSignals.record(
        context,
        UsageEvents.CONTENT_SELECTED,
        alarmId = saved.id,
        voiceProfileId = saved.voiceProfileId,
        props = props,
        ownerUserId = ownerUserId,
    )
}

/**
 * 날짜 지정 알람(한 번)을 저장했다(`dated_alarm_saved`, `docs/spec/usage-events.md` §7.1). 날짜가 있는 알람의 저장 **성공**에만
 * 적는다 — 날짜·시간대·문구는 싣지 않는다(식별자만). [ownerUserId] 는 저장을 **시작한** 계정이다.
 */
internal fun recordDatedAlarmSaved(context: Context, saved: AlarmEntity, ownerUserId: String?) {
    if (saved.targetDate.isNullOrBlank()) return
    UsageSignals.record(
        context,
        UsageEvents.DATED_ALARM_SAVED,
        alarmId = saved.id,
        voiceProfileId = saved.voiceProfileId,
        ownerUserId = ownerUserId,
    )
}

/**
 * 팩 목소리로 운 알람을 저장했다(`pack_selected`, `docs/spec/usage-events.md` §7.1 · `voice-packs.md`) — 칸은 `pack_id`(팩 id)
 * 하나다. 원문·문구·클립 id 는 싣지 않는다. [contentSelectionProps] 와 같은 시점(저장 성공 한 곳)에 적고, 편집기에서 눌러만 보고
 * 취소한 것은 적지 않는다. 팩 목소리가 아니거나, 그 목소리로 울지 않거나(알람 모드·직접 녹음), 받은 팩 목록에서 그 목소리의 팩을
 * 못 찾으면 적지 않는다.
 */
internal fun packSelectionProps(saved: AlarmEntity, heldPacks: List<HeldVoicePack>): UsageEventProps? {
    val voiceId = saved.voiceProfileId
    if (!isVoicePackVoiceId(voiceId)) return null
    if (saved.voiceSource != VoiceSources.TTS_PROFILE || AlarmPlayModes.normalize(saved.playMode) == AlarmPlayModes.ALARM_ONLY) {
        return null
    }
    val packId = UsageEventProps.code(heldPacks.firstOrNull { it.voiceId == voiceId }?.packId) ?: return null
    return UsageEventProps(packId = packId)
}

/** [packSelectionProps] 를 적는다. [ownerUserId] 는 저장을 **시작한** 계정이고, 팩 목록도 그 계정의 것을 본다. */
internal fun recordPackSelected(context: Context, saved: AlarmEntity, ownerUserId: String?) {
    val props = packSelectionProps(saved, VoicePackStore(context).held(ownerUserId)) ?: return
    UsageSignals.record(context, UsageEvents.PACK_SELECTED, alarmId = saved.id, props = props, ownerUserId = ownerUserId)
}

/**
 * 샘플(목소리 미리듣기) 한 번. **실제로 재생을 시작한 직후** [start] 로 만들고, 끝까지 갔을 때만 [completed].
 * 중간에 멈추거나 오류가 나면 아무것도 하지 않는다(시작만 남는다).
 */
internal class SamplePlayback private constructor(
    private val context: Context,
    private val voiceProfileId: String,
    private val surface: String,
) {
    private val attemptId = UsageEventProps.newAttemptId()
    private val startedAt = UsageSignals.monotonicNow()
    private var completed = false

    fun completed() {
        if (completed) return
        completed = true
        UsageSignals.record(
            context,
            UsageEvents.SAMPLE_COMPLETED,
            voiceProfileId = voiceProfileId,
            attemptId = attemptId,
            props = UsageEventProps(
                surface = surface,
                durationMs = UsageSignals.monotonicNow() - startedAt,
                packId = packIdOf(voiceProfileId),
            ),
        )
    }

    companion object {
        fun start(context: Context, voiceProfileId: String, surface: String): SamplePlayback =
            SamplePlayback(context.applicationContext, voiceProfileId, surface).also { sample ->
                UsageSignals.record(
                    context,
                    UsageEvents.SAMPLE_STARTED,
                    voiceProfileId = voiceProfileId,
                    attemptId = sample.attemptId,
                    props = UsageEventProps(surface = surface, packId = packIdOf(voiceProfileId)),
                )
            }

        private fun packIdOf(voiceProfileId: String): String? =
            UsageEventProps.code(voiceProfileId).takeIf { isSystemVoiceId(voiceProfileId) }
    }
}

/**
 * 음성 준비 한 번(`voice_preparation_*`, §7.3). **작업 소유자 한 곳**이 만든다 — 화면은 만들지 않는다.
 * 받을 것이 없는 회차(이미 다 있음)는 준비가 아니라 적지 않는다.
 */
internal class PreparationAttempt(
    private val context: Context,
    private val scope: String,
    private val language: String?,
    private val voiceProfileId: String? = null,
    /** 이 회차를 시작한 단조 시각. 매니페스트 조회부터 재는 워커는 그 시각을 넘긴다. */
    private val startedAt: Long = UsageSignals.monotonicNow(),
) {
    private val attemptId = UsageEventProps.newAttemptId()
    private var cacheState: String? = null
    private var targetCount: Int = 0
    private var finished = false

    fun start(targetCount: Int, alreadyCached: Int) {
        this.targetCount = targetCount
        cacheState = when {
            alreadyCached <= 0 -> UsageEventProps.CACHE_COLD
            alreadyCached >= targetCount -> UsageEventProps.CACHE_WARM
            else -> UsageEventProps.CACHE_PARTIAL
        }
        emit(UsageEvents.VOICE_PREPARATION_STARTED, completed = alreadyCached, bytes = null, errorCode = null)
    }

    fun ready(completed: Int, bytes: Long) = finish(UsageEvents.VOICE_PREPARATION_READY, completed, bytes, null)

    fun failed(completed: Int, bytes: Long, errorCode: String) =
        finish(UsageEvents.VOICE_PREPARATION_FAILED, completed, bytes, errorCode)

    private fun finish(type: String, completed: Int, bytes: Long, errorCode: String?) {
        if (finished || cacheState == null) return
        finished = true
        emit(type, completed, bytes, errorCode, durationMs = UsageSignals.monotonicNow() - startedAt)
    }

    private fun emit(type: String, completed: Int, bytes: Long?, errorCode: String?, durationMs: Long? = null) {
        UsageSignals.record(
            context,
            type,
            voiceProfileId = voiceProfileId,
            attemptId = attemptId,
            featureVersion = FEATURE_VERSION,
            props = UsageEventProps(
                scope = scope,
                language = language,
                cacheState = cacheState,
                targetCount = targetCount,
                completedCount = completed,
                bytes = bytes,
                durationMs = durationMs,
                errorCode = errorCode,
            ),
        )
    }

    companion object {
        /** 준비 흐름의 판. 받는 방식을 바꾸면 올린다(집계가 판으로 갈린다). */
        const val FEATURE_VERSION = "prep-1"
    }
}

/**
 * 알람 저장 한 번(`alarm_save_attempt` → `alarm_save_blocked` | `alarm_ready`, §7.1). 저장 버튼이 [begin] 하고, 요청 전에
 * 막히면 [blocked], 저장이 끝나 OS 예약과 오디오 파일이 **둘 다** 갖춰졌으면 [ready] 가 같은 `attempt_id` 로 적는다.
 * 편집기는 한 번에 하나라 진행 중인 시도도 하나다 — 새로 누르면 앞 시도는 끝난 것으로 본다.
 *
 * ⚠ 기존 `alarm_created` 를 이것으로 바꾸지 않는다 — 그건 '행이 생겼다' 이고 저장 시도가 아니다.
 */
internal object AlarmSaveAttempts {
    private data class Attempt(val id: String, val startedAt: Long, val alarmId: String?)

    @Volatile private var current: Attempt? = null

    fun begin(context: Context, alarmId: String?) {
        val attempt = Attempt(UsageEventProps.newAttemptId(), UsageSignals.monotonicNow(), alarmId)
        current = attempt
        UsageSignals.record(context, UsageEvents.ALARM_SAVE_ATTEMPT, alarmId = alarmId, attemptId = attempt.id)
    }

    /** [reason] 은 짧은 코드(`SaveBlockReason` 은 소문자 이름). 막힌 시도는 끝난 것이다. */
    fun blocked(context: Context, reason: String) {
        val attempt = current ?: return
        current = null
        UsageSignals.record(
            context,
            UsageEvents.ALARM_SAVE_BLOCKED,
            alarmId = attempt.alarmId,
            attemptId = attempt.id,
            props = UsageEventProps(reason = reason),
        )
    }

    /** 저장이 끝나 울릴 준비가 됐다 — `duration_ms` 는 누른 때부터(생성·저장이 걸린 시간, 사용자 입력은 섞이지 않는다). */
    fun ready(context: Context, alarmId: String) {
        val attempt = current ?: return
        current = null
        UsageSignals.record(
            context,
            UsageEvents.ALARM_READY,
            alarmId = alarmId,
            attemptId = attempt.id,
            props = UsageEventProps(durationMs = UsageSignals.monotonicNow() - attempt.startedAt),
        )
    }
}

/**
 * 직접 입력 '음성 만들기' 의 서버 답을 적는다(§7.1). 서버가 내 기존 결과를 다시 줬으면(`cache_hit`) 재사용(server),
 * 아니면 새 제작(`generation_outcome` success)과 정산 수단(`charged_source`). 광고 보상으로 셌으면 그 보상을 쓴 것이다
 * (`reward_spent`). 서버가 말하지 않은 값(옛 서버의 `charged_source`, 사용월)은 지어내지 않고 비운다.
 */
internal fun recordManualGenerationResult(
    context: Context,
    response: com.alarmtalk.app.network.TtsGenerateResponse,
    requestId: String?,
    attemptId: String,
    charCount: Int,
    ownerUserId: String? = null,
) {
    if (response.cacheHit == true) {
        UsageSignals.record(
            context,
            UsageEvents.MANUAL_RESULT_REUSED,
            voiceProfileId = response.voiceProfileId,
            messageId = response.messageId,
            attemptId = attemptId,
            ownerUserId = ownerUserId,
            props = UsageEventProps(
                reuseLocation = UsageEventProps.REUSE_SERVER,
                requestId = requestId,
                resultId = response.messageId,
                charCount = charCount,
            ),
        )
        return
    }
    UsageSignals.record(
        context,
        UsageEvents.GENERATION_OUTCOME,
        voiceProfileId = response.voiceProfileId,
        messageId = response.messageId,
        attemptId = attemptId,
        ownerUserId = ownerUserId,
        props = UsageEventProps(
            outcome = UsageEventProps.OUTCOME_SUCCESS,
            chargedSource = response.chargedSource,
            usageMonth = response.usageMonth,
            requestId = requestId,
            resultId = response.messageId,
            charCount = charCount,
        ),
    )
    if (response.chargedSource == UsageEventProps.CHARGED_AD) AdRewardAttempts.spent(context, requestId)
}

/**
 * 광고 보상 한 번(`reward_offer` → `reward_view_started` → `reward_pending` → `reward_granted` → `reward_spent`, §7.1).
 * 단계가 같은 `attempt_id` 로 묶인다. 제안 없이 시청이 시작되면(다른 입구) 거기서 새 시도를 연다.
 *
 * ⚠ 앱은 보상을 적립하지 않는다 — `granted` 는 **서버가 적립을 확인한 것을 본 순간**이다(`docs/spec/ad-rewards.md`).
 */
internal object AdRewardAttempts {
    private data class Attempt(val id: String, var pendingAt: Long? = null)

    @Volatile private var current: Attempt? = null

    fun offered(context: Context, surface: String) {
        val attempt = Attempt(UsageEventProps.newAttemptId())
        current = attempt
        UsageSignals.record(context, UsageEvents.REWARD_OFFER, attemptId = attempt.id, props = UsageEventProps(surface = surface))
    }

    fun viewStarted(context: Context) {
        val attempt = current ?: Attempt(UsageEventProps.newAttemptId()).also { current = it }
        UsageSignals.record(context, UsageEvents.REWARD_VIEW_STARTED, attemptId = attempt.id)
    }

    fun pending(context: Context) {
        val attempt = current ?: return
        attempt.pendingAt = UsageSignals.monotonicNow()
        UsageSignals.record(context, UsageEvents.REWARD_PENDING, attemptId = attempt.id)
    }

    /** 대기에서 지급 확인까지(`duration_ms`, 단조 시계). */
    fun granted(context: Context) {
        val attempt = current ?: return
        val waited = attempt.pendingAt?.let { UsageSignals.monotonicNow() - it }
        UsageSignals.record(
            context,
            UsageEvents.REWARD_GRANTED,
            attemptId = attempt.id,
            props = UsageEventProps(durationMs = waited),
        )
    }

    /** 보상으로 직접 입력 한 번을 만들었다. 지급을 본 시도가 있으면 그 시도로 잇고, 없으면(늦게 들어온 보상) 따로 적는다. */
    fun spent(context: Context, requestId: String?) {
        val attempt = current
        current = null
        UsageSignals.record(
            context,
            UsageEvents.REWARD_SPENT,
            attemptId = attempt?.id,
            props = UsageEventProps(requestId = requestId),
        )
    }
}
