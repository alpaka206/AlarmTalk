package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CharacterEventEntity
import com.alarmtalk.app.data.CharacterEventStates
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CharacterResponse
import com.alarmtalk.app.network.VoucherItem
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun CharacterBillingPanel(
    alarms: List<AlarmEntity>,
    characterEvents: List<CharacterEventEntity>,
    characterBusy: Boolean,
    characterResponse: CharacterResponse?,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    onRefresh: () -> Unit,
    onSyncEvents: () -> Unit,
    onRegisterCode: (String) -> Unit,
) {
    val pendingCount = characterEvents.count { it.state == CharacterEventStates.PENDING }
    val failedCount = characterEvents.count { it.state == CharacterEventStates.FAILED }
    val recentEvents = characterEvents.take(3)
    val alarmsById = remember(alarms) { alarms.associateBy { it.id } }
    val hasUnreflectedEvents = pendingCount + failedCount > 0
    val busy = characterBusy || billingBusy

    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = stringResource(R.string.billing_character_growth_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                }
                IconButton(
                    onClick = if (hasUnreflectedEvents) onSyncEvents else onRefresh,
                    enabled = !busy,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Refresh,
                        contentDescription = if (hasUnreflectedEvents) {
                            stringResource(R.string.billing_character_sync_growth)
                        } else {
                            stringResource(R.string.billing_character_refresh)
                        },
                    )
                }
            }

            if (characterResponse == null) {
                CharacterEmptyState(
                    busy = busy,
                    onRefresh = onRefresh,
                )
            } else {
                val character = characterResponse.character
                val progress = characterResponse.progress
                val stats = characterResponse.stats
                val progressRatio = progress.progressRatio.toFloat().coerceIn(0f, 1f)
                val levelSpan = progress.levelSpan.coerceAtLeast(1)
                val xpIntoLevel = progress.xpIntoLevel.coerceIn(0, levelSpan)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        modifier = Modifier.size(76.dp),
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                    ) {
                        Box(
                            modifier = Modifier.size(76.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = stageEmoji(character.stage),
                                style = MaterialTheme.typography.displaySmall,
                            )
                        }
                    }
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = stringResource(
                                R.string.billing_character_level_stage,
                                character.level,
                                stageLabel(character.stage),
                            ),
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = stringResource(
                                R.string.billing_character_streak,
                                characterResponse.streak.current,
                                characterResponse.streak.longest,
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "XP",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = "$xpIntoLevel/$levelSpan",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    CharacterXpBar(
                        progress = progressRatio,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = stringResource(
                            R.string.billing_character_xp_to_next_level,
                            progress.xpToNextLevel,
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CharacterStatTile(
                            label = stringResource(R.string.billing_character_stat_diligence),
                            value = stats.diligence,
                            modifier = Modifier.weight(1f),
                        )
                        CharacterStatTile(
                            label = stringResource(R.string.billing_character_stat_consistency),
                            value = stats.consistency,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CharacterStatTile(
                            label = stringResource(R.string.billing_character_stat_health),
                            value = stats.health,
                            modifier = Modifier.weight(1f),
                        )
                        CharacterStatTile(
                            label = stringResource(R.string.billing_character_stat_affection),
                            value = character.affection,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            if (hasUnreflectedEvents) {
                CharacterSyncStatus(
                    pendingCount = pendingCount,
                    failedCount = failedCount,
                )
            }

            if (recentEvents.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.billing_character_recent_growth),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    recentEvents.forEach { event ->
                        CharacterEventRow(
                            event = event,
                            alarm = event.sourceAlarmId?.let(alarmsById::get),
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun CharacterEmptyState(
    busy: Boolean,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Surface(
            modifier = Modifier.size(72.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.tertiaryContainer,
            contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = stageEmoji("seed"),
                    style = MaterialTheme.typography.displaySmall,
                )
            }
        }
        MutedText(stringResource(R.string.billing_character_loading))
        IconButton(
            onClick = onRefresh,
            enabled = !busy,
        ) {
            Icon(
                imageVector = Icons.Outlined.Refresh,
                contentDescription = stringResource(R.string.billing_character_refresh),
            )
        }
    }
}

@Composable
internal fun CharacterStatTile(
    label: String,
    value: Int,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = value.toString(),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
internal fun CharacterSyncStatus(
    pendingCount: Int,
    failedCount: Int,
) {
    val needsCheck = failedCount > 0
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (needsCheck) {
            MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.68f)
        } else {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.68f)
        },
        contentColor = if (needsCheck) {
            MaterialTheme.colorScheme.onErrorContainer
        } else {
            MaterialTheme.colorScheme.onPrimaryContainer
        },
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (needsCheck) {
                    stringResource(R.string.billing_character_sync_check_needed)
                } else {
                    stringResource(R.string.billing_character_sync_pending)
                },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = stringResource(R.string.billing_character_sync_count, pendingCount + failedCount),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
internal fun CharacterEventRow(
    event: CharacterEventEntity,
    alarm: AlarmEntity?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = characterEventTimeLabel(event, alarm),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
        Text(
            text = characterEventXpLabel(event.event),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            color = characterEventXpColor(event.event),
        )
    }
}

internal fun characterEventTimeLabel(
    event: CharacterEventEntity,
    alarm: AlarmEntity?,
): String {
    if (alarm != null) {
        return "${event.localDate} ${alarm.hour.toString().padStart(2, '0')}:${alarm.minute.toString().padStart(2, '0')}"
    }
    return runCatching {
        val dateTime = Instant.ofEpochMilli(event.createdAtMillis).atZone(ZoneId.systemDefault())
        CharacterEventTimeFormatter.format(dateTime)
    }.getOrDefault(event.localDate)
}

internal fun characterEventXpLabel(event: String): String = when (event) {
    "alarm_completed" -> "+5 XP"
    "alarm_snoozed", "alarm_dismissed" -> "-5 XP"
    else -> "+0 XP"
}

internal fun passPlanName(planKey: String?, fallback: String?): String = when (planKey) {
    "free" -> "무료"
    "personal", "individual", "plus" -> "개인"
    "couple" -> "커플"
    "family" -> "가족"
    else -> fallback?.takeIf { it.isNotBlank() } ?: "이용권"
}

internal fun formatPassDate(value: String?): String? =
    value?.let {
        runCatching {
            val dateTime = Instant.parse(it).atZone(ZoneId.systemDefault())
            PassDateFormatter.format(dateTime)
        }.getOrNull()
    }

internal fun formatPassShortDate(value: String?): String? =
    value?.let {
        runCatching {
            val dateTime = Instant.parse(it).atZone(ZoneId.systemDefault())
            PassShortDateFormatter.format(dateTime)
        }.getOrNull()
    }

internal fun Int.formatKrw(): String = "%,d".format(this)

@Composable
internal fun characterEventXpColor(event: String): Color = when (event) {
    "alarm_completed" -> MaterialTheme.colorScheme.primary
    "alarm_snoozed", "alarm_dismissed" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

internal val CharacterEventTimeFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

internal val PassDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy.MM.dd")

internal val PassShortDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("M/d")

@Composable
internal fun CharacterXpBar(
    progress: Float,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(999.dp)
    Box(
        modifier = modifier
            .height(8.dp)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(progress.coerceIn(0f, 1f))
                .height(8.dp)
                .clip(shape)
                .background(MaterialTheme.colorScheme.tertiary),
        )
    }
}

@Composable
internal fun PanelHeader(
    title: String,
    actionLabel: String,
    enabled: Boolean,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        TextButton(onClick = onAction, enabled = enabled) {
            Text(actionLabel)
        }
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
