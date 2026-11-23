package com.alarmtalk.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.alarmtalk.app.billing.PlayBillingProducts
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal fun passPlanName(
    context: android.content.Context,
    planKey: String?,
    fallback: String?,
): String = when (planKey) {
    "free" -> context.getString(R.string.misc2_pass_plan_free)
    "personal", "individual", "plus" -> context.getString(R.string.misc2_pass_plan_personal)
    else -> fallback?.takeIf { it.isNotBlank() } ?: context.getString(R.string.misc2_pass_plan_default)
}

internal fun formatPass(value: String?, formatter: DateTimeFormatter): String? =
    value?.let {
        runCatching {
            val dateTime = Instant.parse(it).atZone(ZoneId.systemDefault())
            formatter.format(dateTime)
        }.getOrNull()
    }

internal val PassDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy.MM.dd")

/**
 * 해지 알럿의 날짜 — 기기 언어의 "월 일"("11월 22일"·"November 22"·"11月22日"). 체험 안내의 날짜와 같은 꼴이다
 * ([formatMonthDay]). 2026-11-22 두 앱 통일 전에는 이 자리만 "11/22" 였다. 날짜는 예전처럼 끝 시각의 기기 날짜다.
 */
internal fun formatPassDay(
    value: String?,
    locale: java.util.Locale,
    zone: ZoneId = ZoneId.systemDefault(),
): String? =
    value?.let {
        runCatching {
            formatMonthDay(Instant.parse(it).atZone(zone).toLocalDate(), locale)
        }.getOrNull()
    }

/**
 * 월·일만 기기 로케일로("10월 31일" / "October 31" / "10月31日"). 연도는 빼는 것이 이 날짜들의 말투다 — 한두 달 안쪽의
 * 날짜라 연도가 헷갈릴 일이 없다.
 */
internal fun formatMonthDay(date: java.time.LocalDate, locale: java.util.Locale): String {
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
 * Google Play 구독 관리 딥링크. planKey 로 Play 상품 ID(sku)를 알면 해당 구독 상세로,
 * 모르면 이 앱 패키지 기준 구독 목록으로 연다. 서버 manage_url 이 없을 때의 폴백이자
 * 이용권 화면의 상시 "Google Play 구독 관리" 링크에도 쓴다.
 */
internal fun playSubscriptionManageUrl(planKey: String?): String {
    val base = "https://play.google.com/store/account/subscriptions"
    val productId = planKey?.let(PlayBillingProducts::productIdFor)
    return if (productId != null) {
        "$base?sku=$productId&package=${BuildConfig.APPLICATION_ID}"
    } else {
        "$base?package=${BuildConfig.APPLICATION_ID}"
    }
}

@Composable
internal fun MutedText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
