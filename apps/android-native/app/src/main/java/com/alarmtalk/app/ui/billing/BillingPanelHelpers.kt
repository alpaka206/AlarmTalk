package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import com.alarmtalk.app.R
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
    "couple" -> context.getString(R.string.misc2_pass_plan_couple)
    "family" -> context.getString(R.string.misc2_pass_plan_family)
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

internal val PassShortDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("M/d")

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
internal fun CompactActionRow(
    title: String,
    subtitle: String,
    actionLabel: String,
    enabled: Boolean = true,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            MutedText(subtitle)
        }
        TextButton(onClick = onAction, enabled = enabled) {
            Text(actionLabel)
        }
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
