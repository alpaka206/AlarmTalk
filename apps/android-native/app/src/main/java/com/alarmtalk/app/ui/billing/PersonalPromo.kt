package com.alarmtalk.app

import android.content.Context
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

/**
 * plan 과 함께 온 프로모 종료 시각이 **지났는가**. 판정기의 오프라인 차단이 쓴다.
 *
 * 모르면(없음·못 읽음) false — 그 plan 은 프로모가 아니거나, 끝을 알 수 없으니 서버가 준
 * 값을 그대로 믿는다. 서버 게이트는 어차피 종료 시각에 스스로 닫힌다.
 */
internal fun personalPromoLapsed(promoEndsAt: String?, nowMillis: Long): Boolean {
    val endsAtMillis = parseServerInstantMillis(promoEndsAt) ?: return false
    return nowMillis >= endsAtMillis
}

/**
 * 이 프로모가 **지금** 살아 있는가(종료는 배타). 종료 시각을 못 읽으면 false —
 * 표시할 날짜가 없으니 아무것도 보이지 않는다(fail-closed).
 */
internal fun isPersonalPromoActive(promo: PersonalPromo?, nowMillis: Long): Boolean {
    val endsAtMillis = parseServerInstantMillis(normalizePersonalPromo(promo)?.endsAt) ?: return false
    return nowMillis < endsAtMillis
}

/**
 * 지금 살아 있는 프로모 — **세션(마지막 `/auth/me`·로그인 응답)을 먼저**, 없으면 구독 응답을 본다.
 * 둘 다 서버가 같은 규칙으로 계산한 값이라 어느 쪽이든 날짜는 같다. 끝났거나 못 읽으면 null.
 * 앱을 켜 둔 채 기간이 끝나도 기기 시계로 다시 재므로 표시가 스스로 사라진다.
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

/** 무료 플랜으로 돌아가는 날 — `ends_at` 의 기기 날짜("…부터"). */
internal fun personalPromoFreeFromDay(promo: PersonalPromo?, zone: ZoneId): LocalDate? {
    val endsAtMillis = parseServerInstantMillis(normalizePersonalPromo(promo)?.endsAt) ?: return null
    return Instant.ofEpochMilli(endsAtMillis).atZone(zone).toLocalDate()
}

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

/**
 * 종료 안내를 **지금 띄워도 되는 화면인가** — 준비 신호와 차단 게이트
 * (`docs/spec/gates-and-overlays.md`).
 *
 * 이 안내는 소진 플래그가 아니라 **진입마다** 뜨지만, 그래도 준비 신호를 지킨다:
 * 응답 전 기본값 `false` 는 '아니오' 가 아니다. 그 틈에 뜨면 뒤늦게 온 차단 화면(업데이트·
 * 동의·탈퇴 유예·교체)이 그 위를 덮거나, 반대로 이 알럿이 차단 화면 위에 얹혀 읽을 수 없는
 * 화면이 된다. 권한 게이트·목소리 받기 화면·다른 모달(강등 안내·민감 동의)과도 겹치지 않는다.
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
    /** 다른 모달(강등 안내·민감 동의)이 떠 있는가. 알럿 두 장을 겹쳐 띄우지 않는다. */
    val otherModalOpen: Boolean,
) {
    fun ready(): Boolean =
        signedIn &&
            versionChecked && !updateRequired && !consentUnsupported &&
            accountStatusChecked && !pendingDeletion &&
            consentStatusChecked && !showConsentScreen &&
            stockReplacementChecked && !stockReplacementPending &&
            !permissionGateOpen && !showVoiceSetup && !otherModalOpen
}

/**
 * 이 **앱 진입**에서 아직 안내를 안 띄웠는가.
 *
 * 진입 번호는 `AppSignals.appEntries` — 콜드 스타트와 백그라운드에서 돌아온 순간마다 오르고
 * 화면 이동·회전으로는 오르지 않는다. 0 은 '아직 한 번도 진입하지 않았다' 라 띄우지 않는다
 * (첫 ON_START 가 오면 1 이 되어 다시 판정된다 — 0 에서 띄우면 같은 콜드 스타트에 두 번 뜬다).
 */
internal fun personalPromoNoticePendingForEntry(entry: Long, handledEntry: Long): Boolean =
    entry > 0L && entry != handledEntry

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
