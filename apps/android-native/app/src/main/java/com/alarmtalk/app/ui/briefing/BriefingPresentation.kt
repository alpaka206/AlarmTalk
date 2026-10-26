package com.alarmtalk.app

import androidx.annotation.StringRes
import com.alarmtalk.app.data.SUBSTITUTE_SYSTEM_VOICE_ID
import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.network.BriefingCompanyStatus
import com.alarmtalk.app.network.BriefingDisclosure
import com.alarmtalk.app.network.BriefingPolicyNews
import com.alarmtalk.app.network.BriefingSourceError
import com.alarmtalk.app.network.BriefingTodayResponse
import com.alarmtalk.app.network.VoiceProfile

/**
 * 아침 소식 응답 → **무엇을 말할지**(`docs/spec/morning-briefing.md` §8 「상태별 표시」). 화면은 이 결과를 글자로 옮기기만 한다.
 * iOS 짝은 `BriefingPresentation.swift` — 판정이 갈라지면 같은 응답을 두 앱이 다르게 읽는다.
 *
 * ⚠ **"없어요" 는 정말 확인했을 때만이다.** 기업 상태가 `ok` 이고 응답이 `complete` 일 때만 [BriefingCompanyNote.NO_DISCLOSURES]
 *   다. 실패를 빈 목록으로 읽지 않는다 — `stale`·`unavailable` 이나 `complete` 가 거짓이면 다른 말을 한다.
 */
internal enum class BriefingCompanyState { OK, STALE, UNAVAILABLE }

internal enum class BriefingCompanyNote {
    /** 공시 목록만 보여 준다. */
    NONE,

    /** `ok` + `complete` + 빈 목록 — 이 기간에 접수된 공시가 정말 없다. */
    NO_DISCLOSURES,

    /** `ok` 인데 `complete` 가 거짓 + 빈 목록 — 없다고 말할 수 없다. */
    NOT_CONCLUSIVE,

    /** 이번에 확인하지 못해 그때(`fetchedAt`) 받아 둔 것을 보여 준다. 비었어도 "없었다" 고 단정하지 않는다. */
    STALE,

    /** 한 번도 확인하지 못했다. */
    UNAVAILABLE,
}

internal data class BriefingCompanySection(
    val corpCode: String,
    val corpName: String?,
    val state: BriefingCompanyState,
    /** 그 기업을 마지막으로 확인한 시각(ISO). `stale` 이면 '그때' 다. */
    val fetchedAt: String?,
    val disclosures: List<BriefingDisclosure>,
    val note: BriefingCompanyNote,
    /** 이번에 확인하지 못한 이유(`errors[].code`). 없으면 null. */
    val errorCode: String?,
)

internal enum class BriefingNewsNote {
    NONE,

    /** 원천이 실패하지 않았고 목록이 비었다. */
    NO_NEWS,

    /** 이번에 확인하지 못해 전에 받아 둔 목록을 보여 준다. */
    STALE,

    /** 이번에 확인하지 못했고 받아 둔 것도 없다. */
    UNAVAILABLE,
}

internal data class BriefingNewsSection(
    val items: List<BriefingPolicyNews>,
    val note: BriefingNewsNote,
    val errorCode: String?,
)

internal data class BriefingView(
    /** 공시를 찾은 범위(한국 날짜 `from` → `to`). 없으면 null. */
    val window: Pair<String, String>?,
    val companies: List<BriefingCompanySection>,
    val news: BriefingNewsSection,
    val fetchedAt: String?,
    val complete: Boolean,
    val stale: Boolean,
    /** 다음 요청을 보내도 되는 때까지 남은 초(`errors[].retry_after_seconds` 의 최댓값). 없으면 null. */
    val retryAfterSeconds: Int?,
)

internal object BriefingPresentation {
    const val SOURCE_OPENDART = "opendart"
    const val SOURCE_POLICY_NEWS = "policy_news"

    /** 모르는 상태 값은 '확인하지 못했다' 로 읽는다 — '확인했다' 로 읽으면 없는 공시를 "없어요" 라고 말한다. */
    fun companyState(raw: String?): BriefingCompanyState = when (raw) {
        "ok" -> BriefingCompanyState.OK
        "stale" -> BriefingCompanyState.STALE
        else -> BriefingCompanyState.UNAVAILABLE
    }

    fun companyNote(state: BriefingCompanyState, complete: Boolean, hasDisclosures: Boolean): BriefingCompanyNote =
        when (state) {
            BriefingCompanyState.STALE -> BriefingCompanyNote.STALE
            BriefingCompanyState.UNAVAILABLE -> BriefingCompanyNote.UNAVAILABLE
            BriefingCompanyState.OK -> when {
                hasDisclosures -> BriefingCompanyNote.NONE
                complete -> BriefingCompanyNote.NO_DISCLOSURES
                else -> BriefingCompanyNote.NOT_CONCLUSIVE
            }
        }

    /** 그 기업의 오류 — 그 기업 `corp_code` 를 가진 항목, 없으면 기업을 가리지 않은 `opendart` 항목. */
    fun companyErrorCode(errors: List<BriefingSourceError>, corpCode: String): String? =
        errors.firstOrNull { it.source == SOURCE_OPENDART && it.corpCode == corpCode }?.code
            ?: errors.firstOrNull { it.source == SOURCE_OPENDART && it.corpCode == null }?.code

    fun newsSection(items: List<BriefingPolicyNews>, errors: List<BriefingSourceError>): BriefingNewsSection {
        val errorCode = errors.firstOrNull { it.source == SOURCE_POLICY_NEWS }?.code
        val note = when {
            errorCode == null && items.isEmpty() -> BriefingNewsNote.NO_NEWS
            errorCode == null -> BriefingNewsNote.NONE
            items.isEmpty() -> BriefingNewsNote.UNAVAILABLE
            else -> BriefingNewsNote.STALE
        }
        return BriefingNewsSection(items = items, note = note, errorCode = errorCode)
    }

    fun retryAfterSeconds(errors: List<BriefingSourceError>): Int? =
        errors.mapNotNull { it.retryAfterSeconds?.takeIf { s -> s > 0 } }.maxOrNull()

    fun view(response: BriefingTodayResponse): BriefingView {
        val errors = response.errors.orEmpty()
        val disclosures = response.disclosures.orEmpty()
        val companies = response.companies.orEmpty().map { status: BriefingCompanyStatus ->
            val state = companyState(status.status)
            val own = disclosures.filter { it.corpCode == status.corpCode }
            BriefingCompanySection(
                corpCode = status.corpCode,
                corpName = status.corpName,
                state = state,
                fetchedAt = status.fetchedAt,
                disclosures = own,
                note = companyNote(state, response.complete, own.isNotEmpty()),
                errorCode = if (state == BriefingCompanyState.OK) null else companyErrorCode(errors, status.corpCode),
            )
        }
        val from = response.window?.from
        val to = response.window?.to
        return BriefingView(
            window = if (!from.isNullOrBlank() && !to.isNullOrBlank()) from to to else null,
            companies = companies,
            news = newsSection(response.policyNews.orEmpty(), errors),
            fetchedAt = response.fetchedAt,
            complete = response.complete,
            stale = response.stale,
            retryAfterSeconds = retryAfterSeconds(errors),
        )
    }

    /**
     * `errors[].code` → 문구(스펙 §8 「문구 표」). 키 오류는 우리 설정 문제라 사용자에게 갈래를 보이지 않는다 — 일반 실패와 같은 말이다.
     * 모르는 코드도 일반 실패다.
     */
    @StringRes
    fun sourceErrorMessageRes(code: String?): Int = when (code) {
        "BRIEFING_SOURCE_NOT_CONFIGURED" -> R.string.briefing_source_not_configured
        "BRIEFING_SOURCE_RATE_LIMITED" -> R.string.briefing_source_rate_limited
        "BRIEFING_SOURCE_MAINTENANCE" -> R.string.briefing_source_maintenance
        else -> R.string.briefing_source_failed
    }
}

/**
 * 관심 기업 목록 규칙 — 상한 3(`BRIEFING_MAX_INTERESTS`, shared `briefing.ts`). 서버가 같은 상한으로 다시 막는다.
 * 목록은 서버로 **통째 교체**해 보내므로 여기서는 보낼 목록만 만든다.
 */
internal object BriefingInterestRules {
    const val MAX_INTERESTS = 3

    fun canAdd(current: List<String>): Boolean = current.size < MAX_INTERESTS

    /** 더한 목록. 이미 있으면 그대로, 상한이면 null(보내지 않는다 — 화면이 이유를 말한다). */
    fun adding(current: List<String>, corpCode: String): List<String>? = when {
        corpCode in current -> current
        !canAdd(current) -> null
        else -> current + corpCode
    }

    fun removing(current: List<String>, corpCode: String): List<String> = current.filterNot { it == corpCode }
}

/**
 * 소식 음성에 고를 수 있는 목소리 — **직접 입력과 같은 권한 규칙**이다(`docs/spec/voice-and-message.md` §8): 기본 목소리 4종은
 * 누구나, 등록(클론) 목소리는 플러스일 때만. 이 화면이 클론을 무료로 쓰는 우회로가 되지 않는다(서버도 같은 규칙으로 막는다).
 */
internal object BriefingVoiceRules {
    fun allowedVoices(profiles: List<VoiceProfile>, paidVoiceEntitled: Boolean): List<VoiceProfile> =
        profiles.filter { profile ->
            val ready = profile.status == null || profile.status == "ready"
            if (isSystemVoiceId(profile.id)) ready else paidVoiceEntitled && ready && profile.isDraft != true
        }

    /** 처음 고른 목소리 — 마지막에 쓴 목소리(쓸 수 있을 때), 아니면 미나, 아니면 첫 목소리. */
    fun initialVoiceId(allowedIds: List<String>, lastUsedVoiceId: String?): String? = when {
        lastUsedVoiceId != null && lastUsedVoiceId in allowedIds -> lastUsedVoiceId
        SUBSTITUTE_SYSTEM_VOICE_ID in allowedIds -> SUBSTITUTE_SYSTEM_VOICE_ID
        else -> allowedIds.firstOrNull()
    }
}
