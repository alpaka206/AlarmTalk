package com.voicealarm.nativeapp

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
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.CharacterResponse

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
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stageEmoji(stage),
                style = MaterialTheme.typography.headlineMedium,
            )
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
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
                        .padding(top = 6.dp)
                        .fillMaxWidth()
                        .height(6.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(999.dp)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(
                                fraction = (
                                    xpIntoLevel.toFloat() /
                                        levelSpan.toFloat().coerceAtLeast(1f)
                                    ).coerceIn(0f, 1f),
                            )
                            .height(6.dp)
                            .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(999.dp)),
                    )
                }
            }
            Text(
                text = ">",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
internal fun NextAlarmHeroCard(
    nextAlarm: AlarmEntity?,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "다음 알람",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.72f),
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = nextAlarm?.let { "%02d:%02d".format(it.hour, it.minute) } ?: "--:--",
                style = MaterialTheme.typography.displayLarge,
                color = MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.Bold,
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (nextAlarm != null) {
                    Icon(
                        imageVector = Icons.Outlined.Alarm,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                        modifier = Modifier.size(18.dp),
                    )
                }
                Text(
                    modifier = Modifier.weight(1f),
                    text = nextAlarm?.let { "${it.label} - ${playModeLabel(it.playMode)}" }
                        ?: "첫 알람 만들기",
                    style = if (nextAlarm == null) {
                        MaterialTheme.typography.bodySmall
                    } else {
                        MaterialTheme.typography.bodyMedium
                    },
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.86f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
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
        Text(
            text = "바로 실행",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HomeActionCard(
                label = "음성 녹음",
                icon = Icons.Outlined.Mic,
                onClick = onRecordVoice,
                locked = voiceLocked,
                modifier = Modifier.weight(1f),
            )
            HomeActionCard(
                label = "알람 추가",
                icon = Icons.Outlined.Alarm,
                onClick = onAddAlarm,
                locked = alarmLocked,
                modifier = Modifier.weight(1f),
            )
        }
        if (canCreateFamilyAlarm) {
            HomeActionCard(
                label = "상대 알람",
                icon = Icons.Outlined.People,
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
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    locked: Boolean = false,
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 16.dp, horizontal = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = if (locked) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.size(30.dp),
                )
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = if (locked) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onSurface,
                )
            }
            if (locked) {
                Icon(
                    imageVector = Icons.Outlined.Lock,
                    contentDescription = "권한 필요",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .size(16.dp),
                )
            }
        }
    }
}
