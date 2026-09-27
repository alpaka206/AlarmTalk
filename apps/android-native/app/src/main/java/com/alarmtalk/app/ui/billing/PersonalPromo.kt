package com.alarmtalk.app

import android.content.Context
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthUser
import com.alarmtalk.app.network.PersonalPromo
import com.alarmtalk.app.network.normalizePersonalPromo
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// 기간 한정 개인 플랜(`personal_promo`) — 앱 쪽 판정·표시를 한 곳에 모은다.
//
// ⚠ **날짜를 여기 박지 말 것.** 종료 시각·안내 시작 시각은 전부 서버가 준다(원본은
//   `packages/shared` 의 `PERSONAL_PROMO`). 앱에 날짜가 있으면 연장·조기 종료에 스토어
//   릴리스가 필요해지고, 서버 게이트와 앱 표시가 갈라진다.

/**
 * 서버 ISO 시각을 epoch millis 로. 못 읽으면 null.
 *
 * `Instant.parse` 만 쓰지 않는 이유: API 26 의 java.time 은 JDK 8 기반이라 `Z` 가 아닌
 * 오프셋(`+09:00`)을 거절한다. 서버는 `Z` 를 쓰지만 형식이 바뀌어도 조용히 null 이 되지
 * 않게 오프셋 형식을 한 번 더 받아 본다.
 */
internal fun parseServerInstantMillis(value: String?): Long? {
    val text = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
}

// ── 오프라인 차단 — **낡은 캐시만** 자른다 ────────────────────────────────────────────

/**
 * 계정·구독 응답의 **답한 시각** — 오프라인 차단(D1)이 '그 답을 받은 시각' 으로 적는 값(D7).
 *
 * 서버가 `personal_promo.computed_at`(서버 시계로 plan 을 계산한 순간)을 주면 **그것**을,
 * 없으면(그 키를 모르는 서버·프로모가 없는 답·못 읽는 값) 기기가 받은 시각([receivedAtMillis])을 쓴다.
 *
 * 왜 서버 시계인가: 비교 대상인 `ends_at` 이 서버 시계다. 기기 시계로 찍으면 기기가 서버보다 Δ
 * 만큼 빠를 때, 종료 직전에 계산된 답을 종료 Δ 안에 받으면 '종료 뒤에 받은 답' 으로 찍혀
 * [personalPromoLapsed] 가 **기한 없이** 권위로 믿는다 — 울림 경로가 다음 `/auth/me` 까지 클론
 * 목소리를 계속 쓴다.
 *
 * ⚠ **받는 자리는 전부 이 한 곳을 지난다** — 세션 저장(`AuthSessionStore` 의 `save`), 스냅샷의
 *   `AccessSnapshot.withServerUser`·`withBillingResponse`. 호출부는 기기가 받은 시각만 넘긴다.
 *   `computed_at` 은 정규화에서 빠지므로(`normalizePersonalPromo`) 한 번 바뀐 값에 다시 걸어도
 *   그대로다.
 * ⚠ **되돌릴 수 없는 경로는 이걸 쓰지 않는다** — 방금 받은 답은 [freshPlanPromoStamp] 다.
 */
internal fun planAnswerStampMillis(promo: PersonalPromo?, receivedAtMillis: Long): Long =
    parseServerInstantMillis(runCatching { promo?.computedAt }.getOrNull()) ?: receivedAtMillis

/**
 * 캐시된 plan 답에 붙은 **프로모 표지** — 그 plan 이 기간 한정 개인 플랜으로 계산된 값일 때,
 * 그 답의 종료 시각([endsAt])과 그 답의 **시각**([fetchedAtMillis] — 서버가 준 `computed_at`,
 * 없으면 기기가 받은 시각. [planAnswerStampMillis]).
 *
 * plan 과 **같은 응답**에서 만든다. 다른 응답의 표지를 붙이면 쿠폰으로 진짜 유료가 된
 * 사용자가 옛 종료 시각에 잠긴다(`AccessSnapshot.userPlanPromoStamp`).
 */
internal data class PlanPromoStamp(
    val endsAt: String,
    /** 모르면 null — 그때는 종료 전에 받은 답으로 본다(옛 캐시, fail-closed — D7). */
    val fetchedAtMillis: Long?,
)

/** [promo] 가 있으면 그 답의 표지. 종료 시각이 없으면(프로모 아님) null. */
internal fun planPromoStampOf(promo: PersonalPromo?, fetchedAtMillis: Long?): PlanPromoStamp? =
    normalizePersonalPromo(promo)?.endsAt?.let { PlanPromoStamp(it, fetchedAtMillis) }

/** 세션에 캐시된 plan 답의 표지 — 세션의 promo 와 **그 세션이 받은 시각**의 짝. */
internal fun AuthSession.planPromoStamp(): PlanPromoStamp? =
    planPromoStampOf(user.personalPromo, userFetchedAtMillis)

/**
 * **방금** 서버에서 받은 답의 표지 — 받은 시각이 곧 판정 시각([nowMillis])이다.
 *
 * ⚠ 되돌릴 수 없는 경로(`PlanChangeSyncWorker` 의 영구 강등)가 이걸 쓴다. 이렇게 넘기면
 * [personalPromoLapsed] 가 **절대 참이 되지 않는다** — 서버가 방금 `plus` 라고 계산해 준
 * 답을 기기 시계로 뒤집어 잠그는 일이 없다(기기 시계가 빠르거나, 경계에 걸친 경우).
 */
internal fun freshPlanPromoStamp(user: AuthUser, nowMillis: Long): PlanPromoStamp? =
    planPromoStampOf(user.personalPromo, nowMillis)

/**
 * 캐시된 계산값 `plus` 를 **이제 무료로 읽어야 하는가** — 오프라인 차단(양 앱 공통 규칙).
 *
 * 참이 되는 것은 셋이 모두 맞을 때뿐이다:
 * 1. 종료 시각을 읽을 수 있다(못 읽으면 자르지 않는다 — 서버 게이트가 제 시각에 스스로 닫힌다).
 * 2. 지금이 종료 시각 이후다(종료는 배타).
 * 3. 그 답을 **종료 전에** 받았다. 종료 **뒤에** 받은 답은 서버가 이미 계산한 것이라 권위다 —
 *    기기 시계가 서버보다 빠르면 끝난 뒤에도 `plus` 가 올 수 있고, 그걸 기기 시계로 자르면
 *    서버가 방금 열어 준 것을 앱이 닫는다. 받은 시각을 모르면(옛 캐시) 종료 전에 받은 것으로 본다.
 *    '받은 시각' 은 서버가 계산한 시각(`computed_at`)이 있으면 그것이다([planAnswerStampMillis]).
 *
 * 진짜 구독 행은 이 규칙과 무관하다 — 판정기가 행을 먼저 본다(`resolvePaidVoiceAccess`).
 */
internal fun personalPromoLapsed(stamp: PlanPromoStamp?, nowMillis: Long): Boolean {
    val endsAtMillis = parseServerInstantMillis(stamp?.endsAt) ?: return false
    if (nowMillis < endsAtMillis) return false
    val fetchedAt = stamp?.fetchedAtMillis
    return fetchedAt == null || fetchedAt < endsAtMillis
}

// ── 표시 ──────────────────────────────────────────────────────────────────────

/**
 * 이 프로모가 **지금** 살아 있는가(종료는 배타). 종료 시각을 못 읽으면 false —
 * 표시할 날짜가 없으니 아무것도 보이지 않는다(fail-closed).
 */
internal fun isPersonalPromoActive(promo: PersonalPromo?, nowMillis: Long): Boolean {
    val endsAtMillis = parseServerInstantMillis(normalizePersonalPromo(promo)?.endsAt) ?: return false
    return nowMillis < endsAtMillis
}

/**
 * 지금 살아 있는 프로모 — [sessionPromo] 를 먼저, 없으면 [billingPromo] 를 본다. 끝났거나 못
 * 읽으면 null. 앱을 켜 둔 채 기간이 끝나도 기기 시계로 다시 재므로 표시가 스스로 사라진다.
 *
 * ⚠ 이용권 화면 한 줄은 이걸 직접 쓰지 않는다 — 두 응답 중 **나중에 받은 답**을 고르는
 *   `planScreenPersonalPromoOf` 를 쓴다(OR 로 보면 결제 직후에도 옛 구독 응답의 promo 가 남는다).
 */
internal fun activePersonalPromoOf(
    sessionPromo: PersonalPromo?,
    billingPromo: PersonalPromo?,
    nowMillis: Long,
): PersonalPromo? =
    listOf(sessionPromo, billingPromo)
        .firstOrNull { isPersonalPromoActive(it, nowMillis) }
        ?.let(::normalizePersonalPromo)

/**
 * 종료 안내를 띄울 **기간**인가: `notice_from ≤ now < ends_at`, 그리고 이 종료 시각에
 * '다시 보지 않기' 를 누르지 않았을 것.
 *
 * - `notice_from` 이 없거나 못 읽으면 띄우지 않는다 — 안내 기간(7일)을 앱이 지어내지 않는다.
 * - '다시 보지 않기' 는 **그 종료 시각에** 묶는다([optedOutEndsAt]). 서버가 기간을 늘리면
 *   종료 시각이 바뀌므로 새 종료를 한 번 더 알린다 — 사용자가 끈 것은 "이 종료 안내" 다.
 */
internal fun isPersonalPromoEndNoticeDue(
    promo: PersonalPromo?,
    nowMillis: Long,
    optedOutEndsAt: String?,
): Boolean {
    val normalized = normalizePersonalPromo(promo) ?: return false
    val endsAtMillis = parseServerInstantMillis(normalized.endsAt) ?: return false
    val noticeFromMillis = parseServerInstantMillis(normalized.noticeFrom) ?: return false
    if (nowMillis < noticeFromMillis || nowMillis >= endsAtMillis) return false
    return optedOutEndsAt == null || optedOutEndsAt != normalized.endsAt
}

/**
 * "…까지" 로 보여 줄 **마지막 날** — `ends_at − 1초` 의 기기 날짜.
 *
 * ⚠ `ends_at` 을 그대로 날짜로 바꾸지 말 것. 종료는 배타(11/1 00:00 KST)라 한국 기기에서
 * "11월 1일까지" 로 보인다 — 하루를 더 준다고 말하는 셈이다.
 */
internal fun personalPromoLastDay(promo: PersonalPromo?, zone: ZoneId): LocalDate? {
    val endsAtMillis = parseServerInstantMillis(normalizePersonalPromo(promo)?.endsAt) ?: return null
    return Instant.ofEpochMilli(endsAtMillis - 1_000L).atZone(zone).toLocalDate()
}

/**
 * 무료 플랜으로 돌아가는 날("…부터") — **마지막 날의 다음 달력 날**.
 *
 * ⚠ `ends_at` 을 기기 날짜로 바꾸지 말 것. 한국 밖 기기에서는 `ends_at` 과 `ends_at − 1초` 가
 * 같은 날이라(UTC 기기: 10/31 15:00) "10월 31일까지 … 10월 31일부터" 로 읽힌다 — 틀린 말은
 * 아니어도 문장이 스스로 모순처럼 보인다. 두 날짜는 언제나 하루 차이로 읽혀야 한다.
 */
internal fun personalPromoFreeFromDay(promo: PersonalPromo?, zone: ZoneId): LocalDate? =
    personalPromoLastDay(promo, zone)?.plusDays(1)

/**
 * 종료 안내가 "등록한 목소리는 3일 보관 후 삭제돼요" 를 말할지. 서버가 `false` 라고 할 때만
 * 뺀다 — 이 키를 주지 않는 서버(null)에서는 예전 문구 그대로다.
 */
internal fun personalPromoDeletesVoicesAtEnd(promo: PersonalPromo?): Boolean =
    normalizePersonalPromo(promo)?.deletesVoicesAtEnd != false

/**
 * 월·일만 기기 로케일로("10월 31일" / "October 31" / "10月31日"). 연도는 빼는 것이
 * 이 안내의 말투다 — 기간이 한 달 안쪽이라 연도가 헷갈릴 일이 없다.
 */
internal fun formatPersonalPromoDay(date: LocalDate, locale: Locale): String {
    val pattern = runCatching {
        android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMMd")
    }.getOrNull()?.takeIf { it.isNotBlank() }
    val formatter = if (pattern != null) {
        DateTimeFormatter.ofPattern(pattern, locale)
    } else {
        DateTimeFormatter.ofPattern("MMMM d", locale)
    }
    return formatter.format(date)
}

// ── 종료 안내 — 언제 띄우나 ────────────────────────────────────────────────────────

/**
 * 종료 안내를 **지금 띄워도 되는 화면인가** — 준비 신호와 차단 게이트
 * (`docs/spec/gates-and-overlays.md` 「개인 플랜 종료 안내」).
 *
 * 이 안내는 소진 플래그가 아니라 **진입마다** 뜨지만, 그래도 준비 신호를 지킨다:
 * 응답 전 기본값 `false` 는 '아니오' 가 아니다. 그 틈에 뜨면 뒤늦게 온 차단 화면(업데이트·
 * 동의·탈퇴 유예·교체)이 그 위를 덮거나, 반대로 이 알럿이 차단 화면 위에 얹혀 읽을 수 없는
 * 화면이 된다.
 *
 * **다른 모달·시스템 권한 창 위에는 절대 띄우지 않는다.** 진입은 프로세스 ON_START 라,
 * 문서 선택기·시스템 설정에서 돌아오는 것도 진입이다 — 그때 목소리 등록 창 같은 모달이
 * 아직 열려 있다. 떠 있는 동안에도 이 조건이 깨지면 안내를 걷고 기다린다(`AlarmTalkApp`).
 */
internal data class PersonalPromoNoticeGates(
    val signedIn: Boolean,
    val versionChecked: Boolean,
    val updateRequired: Boolean,
    val consentUnsupported: Boolean,
    /** `/auth/me` 응답(= plan·프로모)이 이 계정으로 도착했는가. 실패도 '도착' 이다. */
    val accountStatusChecked: Boolean,
    val pendingDeletion: Boolean,
    val consentStatusChecked: Boolean,
    val showConsentScreen: Boolean,
    val stockReplacementChecked: Boolean,
    val stockReplacementPending: Boolean,
    val permissionGateOpen: Boolean,
    val showVoiceSetup: Boolean,
    /**
     * 다른 모달이 떠 있는가 — 강등 안내·민감 동의, 그리고 **창을 여는 모든 모달**
     * (`OpenModalRegistry`: 알럿·시트·목소리 등록 창 등). 알럿 두 장을 겹쳐 띄우지 않는다.
     */
    val otherModalOpen: Boolean,
    /** 우리가 띄운 시스템 권한 창이 아직 닫히지 않았다(요청 ~ 결과 콜백). */
    val systemPermissionPromptOpen: Boolean,
    /**
     * 화면이 RESUMED 인가. 시스템 권한 창·다른 앱의 창이 위에 있으면 액티비티가 멈춰(PAUSED)
     * 있다 — 그 위로 띄우면 사용자는 권한 창과 안내를 한꺼번에 받는다.
     */
    val activityResumed: Boolean,
) {
    fun ready(): Boolean =
        signedIn &&
            versionChecked && !updateRequired && !consentUnsupported &&
            accountStatusChecked && !pendingDeletion &&
            consentStatusChecked && !showConsentScreen &&
            stockReplacementChecked && !stockReplacementPending &&
            !permissionGateOpen && !showVoiceSetup && !otherModalOpen &&
            !systemPermissionPromptOpen && activityResumed
}

/**
 * 이 **앱 진입**에서 아직 판정을 안 했는가.
 *
 * 진입 번호는 `AppSignals.appEntries` — 콜드 스타트와 백그라운드에서 돌아온 순간마다 오르고
 * 화면 이동·회전으로는 오르지 않는다. 0 은 '아직 한 번도 진입하지 않았다' 라 판정하지 않는다
 * (첫 ON_START 가 오면 1 이 되어 다시 판정된다 — 0 에서 띄우면 같은 콜드 스타트에 두 번 뜬다).
 */
internal fun personalPromoNoticePendingForEntry(entry: Long, handledEntry: Long): Boolean =
    entry > 0L && entry != handledEntry

/**
 * 계정 응답(`/auth/me`)이 **어느 진입의 몫인가** — 없으면 null.
 *
 * 요청을 **보낸** 진입과 응답이 **도착한** 진입이 같을 때만 그 진입의 답이다. 앞 진입에 보낸
 * 요청이 백그라운드를 건너 늦게 도착한 것은 이번 진입의 '새 응답' 이 아니다 — 그 사이 다른
 * 기기에서 결제했을 수 있다. 0(진입 전에 보낸 요청)도 어느 진입의 몫이 아니다.
 */
internal fun accountAnswerEntryFor(requestEntry: Long, currentEntry: Long): Long? =
    requestEntry.takeIf { it > 0L && it == currentEntry }

/**
 * 한 진입에 보낸 계정 요청(`/auth/me`)의 **첫 결과**(iOS `AccountEntryAnswer` 와 같은 모양).
 *
 * 종료 안내의 준비 신호다. **첫 결과가 그 진입의 판정을 끝낸다 — 성공이든 실패든**(D11):
 * 실패가 먼저면 이 진입은 옛 값으로도, 같은 진입의 뒤 성공(쿠폰·`plan_changed`·결제 신호 뒤의
 * 갱신)으로도 판정하지 않는다. 뒤 성공으로 판정하면 세션 한가운데서 안내가 튀어나온다 —
 * 다음 진입이 다시 판정한다.
 */
internal data class AccountEntryAnswer(val entry: Long, val outcome: Outcome) {
    enum class Outcome {
        /** 이 진입의 첫 응답이 왔다 — 가장 최근 계정 응답의 값으로 판정한다. */
        Answered,

        /** 이 진입의 첫 응답이 실패했다 — 이 진입은 띄우지 않는다. */
        Failed,
    }
}

/** [decidePersonalPromoEndNotice] 의 답. */
internal sealed interface PersonalPromoNoticeDecision {
    /** 지금은 판정하지 않는다 — 이미 이 진입을 판정했거나, 이 진입의 계정 응답을 기다린다. */
    data object NotNow : PersonalPromoNoticeDecision

    /**
     * 이 진입의 판정은 끝났다 — 띄울 것이 없다(프로모 없음·기간 밖·'다시 보지 않기'·이 진입의 첫
     * 계정 응답이 실패). 같은 진입의 뒤 계정 응답으로 다시 판정하지 않는다.
     */
    data object NothingToShow : PersonalPromoNoticeDecision

    /** 띄운다. */
    data class Show(val promo: PersonalPromo) : PersonalPromoNoticeDecision
}

/**
 * 이번 진입에서 종료 안내를 띄울지. **준비 신호·차단 게이트는 부르는 쪽이 본다**
 * ([PersonalPromoNoticeGates]). 여기서는 진입·응답·기간·'다시 보지 않기' 만 본다.
 *
 * ⚠ **이 진입의 새 계정 응답이 온 뒤에만 판정한다**([entryAnswer] 가 [entry] 의 것일 때).
 *   저장된 세션의 promo 는 지난 실행의 것이다 — 그 사이 다른 기기에서 결제했거나 쿠폰을
 *   등록했으면 이미 끝난 프로모의 안내를 띄우게 된다. 기다리는 동안 다른 안내를 막지도 않는다.
 * ⚠ **이 진입의 첫 결과가 실패면 띄우지 않고 이 진입을 끝낸다**(D11 — [AccountEntryAnswer]).
 *   옛 값으로 판정하지 않고, 같은 진입의 뒤 성공으로도 다시 판정하지 않는다. 다음 진입이 다시
 *   판정한다.
 *
 * @param entryAnswer 이 진입에 보낸 계정 요청의 첫 결과. 다른 진입의 것이면 아직 안 온 것이다.
 * @param latestPromo 이 계정의 **가장 최근** 계정 응답의 `personal_promo`.
 */
internal fun decidePersonalPromoEndNotice(
    entry: Long,
    handledEntry: Long,
    entryAnswer: AccountEntryAnswer?,
    latestPromo: PersonalPromo?,
    nowMillis: Long,
    optedOutEndsAt: String?,
): PersonalPromoNoticeDecision {
    if (!personalPromoNoticePendingForEntry(entry, handledEntry)) return PersonalPromoNoticeDecision.NotNow
    if (entryAnswer == null || entryAnswer.entry != entry) return PersonalPromoNoticeDecision.NotNow
    if (entryAnswer.outcome == AccountEntryAnswer.Outcome.Failed) return PersonalPromoNoticeDecision.NothingToShow
    val promo = activePersonalPromoOf(sessionPromo = latestPromo, billingPromo = null, nowMillis = nowMillis)
        ?: return PersonalPromoNoticeDecision.NothingToShow
    if (!isPersonalPromoEndNoticeDue(promo, nowMillis, optedOutEndsAt)) {
        return PersonalPromoNoticeDecision.NothingToShow
    }
    return PersonalPromoNoticeDecision.Show(promo)
}

/**
 * 떠 있는 안내를 **새 계정 응답에 맞춘다**. 같은 종료 시각이면 새 값(문구 갈래가 바뀌었을 수
 * 있다)으로, 프로모가 사라졌거나(결제·쿠폰으로 원시 유료가 됨) 종료 시각이 바뀌었으면 닫는다(null).
 * 옛 응답의 안내를 그대로 들고 있으면 이미 결제한 사람에게 "곧 끝나요" 를 말한다.
 */
internal fun reconcileShownPersonalPromoNotice(
    showing: PersonalPromo?,
    latestPromo: PersonalPromo?,
    nowMillis: Long,
): PersonalPromo? {
    if (showing == null) return null
    val latest = activePersonalPromoOf(sessionPromo = latestPromo, billingPromo = null, nowMillis = nowMillis)
        ?: return null
    return latest.takeIf { it.endsAt == showing.endsAt }
}

/**
 * 종료 안내의 '다시 보지 않기' — **계정별**, 그리고 **그 종료 시각에** 묶는다
 * ([isPersonalPromoEndNoticeDue] 참조).
 *
 * ⚠ 옛 웰컴 안내의 소진 플래그(`promo_prompted_*`)를 재사용하지 말 것 — 기존 사용자는 이미
 * true 라 새 안내가 영영 안 뜬다. 파일도 키도 새로 쓴다.
 *
 * 명시적 로그아웃에서도 지우지 않는다. 같은 사람이 다시 들어왔을 때 끈 안내가 되살아나면
 * 사용자의 선택을 앱이 도로 취소하는 셈이다.
 */
internal class PersonalPromoNoticeStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** 이 계정이 '다시 보지 않기' 를 누른 종료 시각. 누른 적 없으면 null. */
    fun optedOutEndsAt(userId: String): String? =
        runCatching { prefs.getString(key(userId), null) }.getOrNull()?.takeIf { it.isNotBlank() }

    fun optOut(userId: String, endsAt: String) {
        runCatching { prefs.edit().putString(key(userId), endsAt).apply() }
    }

    private fun key(userId: String) = "end_notice_opt_out_$userId"

    private companion object {
        const val PREFS_NAME = "alarmtalk_personal_promo_notice"
    }
}
