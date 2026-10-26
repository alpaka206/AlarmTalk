package com.alarmtalk.app.data

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import java.util.UUID

/**
 * 사용 기록 2판의 **정해진 칸**(`packages/shared/src/schemas/usage-event.ts` 의 `UsageEventPropsSchema`,
 * `docs/spec/usage-events.md` §7.2). 이름은 서버 칸 이름 그대로이고, null 은 직렬화에서 빠진다(Gson 기본값).
 *
 * ⚠ **칸을 늘리면 서버를 먼저** 올린다 — 서버는 모르는 칸을 400 으로 거절하고, 앱은 성공한 배치만 지우므로
 *   그 배치가 큐 맨 앞에서 영원히 다시 간다.
 * ⚠ 문구 원문·이름·이메일·기사 원문을 넣을 칸은 없다. 코드 칸에는 [code] 가 걸러 낸 짧은 코드만 들어간다.
 */
data class UsageEventProps(
    // 준비
    val scope: String? = null,
    val language: String? = null,
    val revision: String? = null,
    @SerializedName("cache_state") val cacheState: String? = null,
    @SerializedName("target_count") val targetCount: Int? = null,
    @SerializedName("completed_count") val completedCount: Int? = null,
    val bytes: Long? = null,
    /** **단조 시계**(`SystemClock.elapsedRealtime`)로 잰 밀리초. */
    @SerializedName("duration_ms") val durationMs: Long? = null,
    @SerializedName("error_code") val errorCode: String? = null,
    // 결과·사유
    val outcome: String? = null,
    val reason: String? = null,
    val method: String? = null,
    val step: String? = null,
    @SerializedName("pack_id") val packId: String? = null,
    @SerializedName("is_first") val isFirst: Boolean? = null,
    val prepared: Boolean? = null,
    // 직접 입력
    @SerializedName("reuse_location") val reuseLocation: String? = null,
    @SerializedName("charged_source") val chargedSource: String? = null,
    @SerializedName("usage_month") val usageMonth: String? = null,
    @SerializedName("result_id") val resultId: String? = null,
    @SerializedName("request_id") val requestId: String? = null,
    @SerializedName("char_count") val charCount: Int? = null,
    // 콘텐츠
    @SerializedName("content_mode") val contentMode: String? = null,
    // 결제·광고
    val surface: String? = null,
    @SerializedName("product_id") val productId: String? = null,
    @SerializedName("store_offer") val storeOffer: String? = null,
    @SerializedName("from_plan") val fromPlan: String? = null,
    @SerializedName("to_plan") val toPlan: String? = null,
) {
    /**
     * 서버 스키마가 받는 모양으로 다듬는다. **하나라도 틀리면 배치 전체가 400** 이라 큐가 멈추므로, 틀린 값은 고쳐
     * 보내지 않고 **비운다**(그 칸 하나만 잃는다). 열거 칸은 서버 목록 밖이면 비운다.
     */
    fun sanitized(): UsageEventProps = copy(
        scope = scope.oneOf(SCOPES),
        language = language?.takeIf { LANGUAGE.matches(it) },
        revision = code(revision),
        cacheState = cacheState.oneOf(CACHE_STATES),
        targetCount = targetCount?.coerceIn(0, MAX_COUNT),
        completedCount = completedCount?.coerceIn(0, MAX_COUNT),
        bytes = bytes?.coerceIn(0L, MAX_BYTES),
        durationMs = durationMs?.coerceIn(0L, MAX_DURATION_MS),
        errorCode = code(errorCode),
        outcome = outcome.oneOf(OUTCOMES),
        reason = code(reason),
        method = code(method),
        step = code(step),
        packId = code(packId),
        reuseLocation = reuseLocation.oneOf(REUSE_LOCATIONS),
        chargedSource = chargedSource.oneOf(CHARGED_SOURCES),
        usageMonth = usageMonth?.takeIf { USAGE_MONTH.matches(it) },
        resultId = resultId?.takeIf(::isUuid),
        requestId = requestId?.takeIf(::isUuid),
        charCount = charCount?.coerceIn(0, MAX_CHARS),
        contentMode = contentMode.oneOf(CONTENT_MODES),
        surface = code(surface),
        productId = productId?.takeIf { PRODUCT_ID.matches(it) },
        storeOffer = storeOffer.oneOf(STORE_OFFERS),
        fromPlan = code(fromPlan),
        toPlan = code(toPlan),
    )

    fun isEmpty(): Boolean = this == EMPTY

    fun toJson(): String = gson.toJson(this)

    companion object {
        private val gson = Gson()
        private val EMPTY = UsageEventProps()

        // 서버 목록과 같은 값(`UsageEventPropsSchema`). 한쪽만 늘리지 말 것.
        const val SCOPE_SELECTED_VOICE = "selected_voice"
        const val SCOPE_ALL_VOICES = "all_voices"
        const val SCOPE_BUCKET = "bucket"
        const val SCOPE_CLIP = "clip"
        const val CACHE_COLD = "cold"
        const val CACHE_PARTIAL = "partial"
        const val CACHE_WARM = "warm"
        const val OUTCOME_SUCCESS = "success"
        const val OUTCOME_FAILURE = "failure"
        const val OUTCOME_CANCELLED = "cancelled"
        const val REUSE_LOCAL = "local"
        const val REUSE_SERVER = "server"
        const val CHARGED_BASE = "base"
        const val CHARGED_AD = "ad"
        const val CHARGED_NONE = "none"
        const val OFFER_FREE_TRIAL = "free_trial"
        const val OFFER_INTRO = "intro"
        const val OFFER_NONE = "none"
        const val OFFER_UNKNOWN = "unknown"

        private val SCOPES = setOf(SCOPE_SELECTED_VOICE, SCOPE_ALL_VOICES, SCOPE_BUCKET, SCOPE_CLIP)
        private val CACHE_STATES = setOf(CACHE_COLD, CACHE_PARTIAL, CACHE_WARM)
        private val OUTCOMES = setOf(OUTCOME_SUCCESS, OUTCOME_FAILURE, OUTCOME_CANCELLED)
        private val REUSE_LOCATIONS = setOf(REUSE_LOCAL, REUSE_SERVER)
        private val CHARGED_SOURCES = setOf(CHARGED_BASE, CHARGED_AD, CHARGED_NONE)
        private val CONTENT_MODES = setOf("fixed", "varied")
        private val STORE_OFFERS = setOf(OFFER_FREE_TRIAL, OFFER_INTRO, OFFER_NONE, OFFER_UNKNOWN)

        private val CODE = Regex("^[a-z0-9][a-z0-9_.-]{0,63}$")
        private val LANGUAGE = Regex("^[a-z]{2}(-[A-Z]{2})?$")
        private val USAGE_MONTH = Regex("^\\d{4}-(0[1-9]|1[0-2])$")
        private val PRODUCT_ID = Regex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
        private const val MAX_COUNT = 100_000
        private const val MAX_BYTES = 10_000_000_000L
        private const val MAX_DURATION_MS = 7L * 24 * 3600_000
        private const val MAX_CHARS = 10_000

        /**
         * 짧은 코드로 — 소문자로 내리고 코드에 못 쓰는 글자는 `_` 로, 64자에서 자른다. 그래도 모양이 아니면 비운다
         * (예: 한글만 있는 값). 서버 오류 코드 `VOICE_NOT_FOUND` → `voice_not_found`.
         */
        fun code(raw: String?): String? {
            val value = raw?.trim()?.lowercase()?.replace(Regex("[^a-z0-9_.-]"), "_")?.take(64) ?: return null
            return value.takeIf { CODE.matches(it) }
        }

        fun fromJson(json: String?): UsageEventProps? =
            json?.takeIf { it.isNotBlank() }?.let { runCatching { gson.fromJson(it, UsageEventProps::class.java) }.getOrNull() }

        private fun String?.oneOf(allowed: Set<String>): String? = this?.takeIf { it in allowed }

        /** zod `uuid()` 와 같은 모양(RFC 9562 판·변형 자리까지) — 느슨하게 받으면 서버가 배치를 거절한다. */
        private val UUID_SHAPE =
            Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")

        fun isUuid(value: String): Boolean = UUID_SHAPE.matches(value)

        fun newAttemptId(): String = UUID.randomUUID().toString()
    }
}
