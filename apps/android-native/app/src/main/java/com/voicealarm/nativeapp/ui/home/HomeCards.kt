package com.voicealarm.nativeapp

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.network.CharacterResponse
import kotlin.math.PI
import kotlin.math.sin

@Composable
internal fun NextAlarmHeroCard(
    nextAlarm: AlarmEntity?,
    onClick: () -> Unit,
) {
    val hasAlarm = nextAlarm != null
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        text = if (hasAlarm) "다음 알람" else "아직 알람이 없어요.",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = nextAlarm?.let { "%02d:%02d".format(it.hour, it.minute) }
                            ?: "알람 예약",
                        style = if (hasAlarm) {
                            MaterialTheme.typography.displayLarge
                        } else {
                            MaterialTheme.typography.displaySmall
                        },
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            HomeVoiceWaveform(
                modifier = Modifier.fillMaxWidth(),
                active = hasAlarm,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(
                        text = nextAlarm?.label?.takeIf { it.isNotBlank() }
                            ?: "좋아하는 목소리로 알람 예약",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = nextAlarm?.let {
                            "수정하기"
                        } ?: "바로 시작해봐요.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 12.dp),
                )
            }
        }
    }
}

@Composable
private fun HomeVoiceWaveform(
    modifier: Modifier = Modifier,
    active: Boolean,
) {
    val transition = rememberInfiniteTransition(label = "home-waveform")
    val phase = transition.animateFloat(
        initialValue = 0f,
        targetValue = (PI * 2).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1700, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "home-waveform-phase",
    ).value
    val levels = listOf(
        0.18f, 0.24f, 0.16f, 0.34f, 0.28f, 0.52f, 0.38f, 0.70f,
        0.42f, 0.60f, 0.32f, 0.56f, 0.24f, 0.66f, 0.46f, 0.78f,
        0.40f, 0.62f, 0.34f, 0.58f, 0.28f, 0.54f, 0.36f, 0.64f,
        0.44f, 0.72f, 0.30f, 0.48f, 0.22f, 0.42f, 0.18f, 0.36f,
        0.26f, 0.50f, 0.20f, 0.40f, 0.16f, 0.32f, 0.14f, 0.28f,
    )
    Row(
        modifier = modifier.height(44.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val wave = ((sin(phase + index * 0.56f) + 1f) / 2f).coerceIn(0f, 1f)
            val animatedLevel = (level * (0.72f + 0.28f * wave)).coerceIn(0.12f, 0.88f)
            val alpha = if (active) {
                0.58f + 0.38f * wave
            } else {
                0.24f + 0.28f * wave
            }
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height((8 + animatedLevel * 34).dp)
                    .background(
                        color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
                        shape = RoundedCornerShape(999.dp),
                    ),
            )
        }
    }
}

@Composable
internal fun QuickStartGrid(
    onRecordVoice: () -> Unit,
    onAddAlarm: () -> Unit,
    canCreateFamilyAlarm: Boolean,
    onAddFamilyAlarm: () -> Unit,
    voiceLocked: Boolean = false,
    alarmLocked: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "바로 가기",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.Bold,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HomeActionCard(
                label = "알람 음성",
                icon = Icons.Outlined.Mic,
                accentContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                accentContentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                onClick = onRecordVoice,
                locked = voiceLocked,
                modifier = Modifier.weight(1f),
            )
            HomeActionCard(
                label = "새 알람",
                icon = Icons.Outlined.Alarm,
                accentContainerColor = MaterialTheme.colorScheme.primaryContainer,
                accentContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                onClick = onAddAlarm,
                locked = alarmLocked,
                modifier = Modifier.weight(1f),
            )
        }
        if (canCreateFamilyAlarm) {
            HomeActionCard(
                label = "함께",
                icon = Icons.Outlined.People,
                accentContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                accentContentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                onClick = onAddFamilyAlarm,
                locked = alarmLocked,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
internal fun HomeActionCard(
    label: String,
    icon: ImageVector,
    accentContainerColor: Color,
    accentContentColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    locked: Boolean = false,
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.size(48.dp)) {
                    Surface(
                        modifier = Modifier
                            .size(42.dp)
                            .align(Alignment.CenterStart),
                        shape = CircleShape,
                        color = if (locked) {
                            MaterialTheme.colorScheme.surfaceVariant
                        } else {
                            accentContainerColor
                        },
                        contentColor = if (locked) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            accentContentColor
                        },
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = icon,
                                contentDescription = null,
                                modifier = Modifier.size(23.dp),
                            )
                        }
                    }
                    if (locked) {
                        FeatureLockBadge(
                            modifier = Modifier.align(Alignment.TopEnd),
                            size = 20.dp,
                            iconSize = 11.dp,
                        )
                    }
                }
                Text(
                    text = label,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = if (locked) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
internal fun CharacterMiniCard(
    characterResponse: CharacterResponse?,
    onClick: () -> Unit,
) {
    val character = characterResponse?.character
    val stage = character?.stage ?: "seed"
    val level = character?.level ?: 1
    val streak = characterResponse?.streak?.current ?: 0
    val xpIntoLevel = characterResponse?.progress?.xpIntoLevel ?: 0
    val levelSpan = characterResponse?.progress?.levelSpan ?: 100
    val progress = (xpIntoLevel.toFloat() / levelSpan.toFloat().coerceAtLeast(1f)).coerceIn(0f, 1f)

    Card(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                modifier = Modifier.size(52.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.tertiaryContainer,
                contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = stageEmoji(stage),
                        style = MaterialTheme.typography.titleLarge,
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "LV.$level",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "연속 ${streak}일",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(999.dp)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(progress)
                            .height(5.dp)
                            .background(MaterialTheme.colorScheme.tertiary, RoundedCornerShape(999.dp)),
                    )
                }
            }
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.tertiary,
            )
        }
    }
}
