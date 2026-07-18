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

internal fun Int.formatKrw(): String = "%,d".format(this)

internal val PassDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy.MM.dd")

internal val PassShortDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("M/d")

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
