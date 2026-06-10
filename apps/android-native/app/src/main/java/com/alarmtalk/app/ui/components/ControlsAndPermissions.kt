package com.alarmtalk.app

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import kotlin.math.roundToInt

@Composable
internal fun AlarmTalkSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        enabled = enabled,
        modifier = modifier,
        colors = SwitchDefaults.colors(
            checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
            checkedTrackColor = MaterialTheme.colorScheme.primary,
            checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = MaterialTheme.colorScheme.surface,
            uncheckedTrackColor = MaterialTheme.colorScheme.surfaceVariant,
            uncheckedBorderColor = MaterialTheme.colorScheme.outline,
        ),
    )
}

@Composable
internal fun PermissionPanel(
    permissions: PermissionSnapshot,
    onRequestPermission: (PermissionTarget) -> Unit,
    onRequestAllPermissions: () -> Unit,
) {
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = "권한",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (!permissions.allStartupGranted) {
                Button(
                    onClick = onRequestAllPermissions,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Icon(Icons.Outlined.ErrorOutline, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("필요 권한 모두 허용")
                }
            }
            PermissionRow(
                icon = Icons.Outlined.Alarm,
                label = "정확한 알람",
                granted = permissions.exactAlarms,
                actionLabel = "허용하기",
                onAction = { onRequestPermission(PermissionTarget.ExactAlarms) },
            )
            PermissionRow(
                icon = Icons.Outlined.Notifications,
                label = "알림",
                granted = permissions.notifications,
                actionLabel = "허용하기",
                onAction = { onRequestPermission(PermissionTarget.Notifications) },
            )
            PermissionRow(
                icon = Icons.Outlined.Fullscreen,
                label = "전체 화면 알람",
                granted = permissions.fullScreenIntent,
                actionLabel = "허용하기",
                onAction = { onRequestPermission(PermissionTarget.FullScreenIntent) },
            )
            PermissionRow(
                icon = Icons.Outlined.Mic,
                label = "마이크",
                granted = permissions.recordAudio,
                actionLabel = "허용하기",
                onAction = { onRequestPermission(PermissionTarget.RecordAudio) },
            )
        }
    }
}

@Composable
internal fun PermissionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    granted: Boolean,
    actionLabel: String,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Surface(
                modifier = Modifier.size(38.dp),
                shape = RoundedCornerShape(12.dp),
                color = if (granted) {
                    MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f)
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                },
                contentColor = if (granted) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
                }
            }
            Column {
                Text(text = label, fontWeight = FontWeight.Medium)
                Text(
                    text = if (granted) "허용됨" else "필요함",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (granted) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                )
            }
        }
        if (granted) {
            Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        } else {
            TextButton(onClick = onAction, shape = WakerButtonShape) {
                Icon(Icons.Outlined.ErrorOutline, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(actionLabel)
            }
        }
    }
}

@Composable
internal fun AlarmRow(
    alarm: AlarmEntity,
    onToggleEnabled: (Boolean) -> Unit,
    onEditAlarm: () -> Unit,
    onDeleteAlarm: () -> Unit,
) {
    val deleteWidth = 92.dp
    val deleteWidthPx = with(LocalDensity.current) { deleteWidth.toPx() }
    var deleteRevealed by remember(alarm.id) { mutableStateOf(false) }
    var dragOffsetPx by remember(alarm.id) { mutableStateOf(0f) }
    val warningText = alarmRowWarningText(alarm)
    val settledOffsetPx = if (deleteRevealed) -deleteWidthPx else 0f
    val currentOffsetPx = if (dragOffsetPx != 0f) dragOffsetPx else settledOffsetPx
    val deleteVisible = deleteRevealed || currentOffsetPx < -0.5f
    val alarmCardShape = RoundedCornerShape(
        topStart = 22.dp,
        topEnd = if (deleteVisible) 0.dp else 22.dp,
        bottomEnd = if (deleteVisible) 0.dp else 22.dp,
        bottomStart = 22.dp,
    )
    val deleteButtonShape = RoundedCornerShape(
        topStart = 0.dp,
        topEnd = 22.dp,
        bottomEnd = 22.dp,
        bottomStart = 0.dp,
    )
    val dragState = rememberDraggableState { delta ->
        dragOffsetPx = (dragOffsetPx + delta).coerceIn(-deleteWidthPx, 0f)
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        if (deleteVisible) {
            Row(
                modifier = Modifier.matchParentSize(),
                horizontalArrangement = Arrangement.End,
            ) {
                DeleteRevealButton(
                    modifier = Modifier.width(deleteWidth),
                    shape = deleteButtonShape,
                    onDelete = onDeleteAlarm,
                )
            }
        }

        Card(
            onClick = {
                if (!deleteRevealed) {
                    onEditAlarm()
                } else {
                    deleteRevealed = false
                    dragOffsetPx = 0f
                }
            },
            modifier = Modifier
                .offset { IntOffset(currentOffsetPx.roundToInt(), 0) }
                .draggable(
                    state = dragState,
                    orientation = Orientation.Horizontal,
                    onDragStarted = {
                        dragOffsetPx = settledOffsetPx
                        deleteRevealed = false
                    },
                    onDragStopped = {
                        deleteRevealed = dragOffsetPx <= -deleteWidthPx * 0.42f
                        dragOffsetPx = 0f
                    },
                ),
            shape = alarmCardShape,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = wakerCardBorder(),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(
                            text = "%02d:%02d".format(alarm.hour, alarm.minute),
                            style = MaterialTheme.typography.headlineLarge,
                            fontWeight = FontWeight.Normal,
                            color = if (alarm.enabled) {
                                MaterialTheme.colorScheme.onSurface
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                        Text(
                            text = alarm.label,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (alarm.enabled) {
                                MaterialTheme.colorScheme.onSurface
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                    AlarmTalkSwitch(
                        checked = alarm.enabled,
                        onCheckedChange = onToggleEnabled,
                    )
                }
                if (warningText != null) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.72f),
                        contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.ErrorOutline,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                            Text(
                                text = warningText,
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun alarmRowWarningText(alarm: AlarmEntity): String? = when {
    alarm.state == AlarmStates.FAILED -> "알람을 다시 예약하지 못했어요. 시간을 확인하고 다시 저장해 주세요."
    alarm.syncState == AlarmSyncStates.FAILED -> "서버에 저장하지 못했어요. 이 기기의 알람은 그대로 울려요."
    else -> null
}

@Composable
internal fun DeleteRevealButton(
    modifier: Modifier,
    shape: RoundedCornerShape = WakerCardShape,
    onDelete: () -> Unit,
) {
    Surface(
        onClick = onDelete,
        modifier = modifier.fillMaxHeight(),
        color = MaterialTheme.colorScheme.error,
        shape = shape,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.Delete,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onError,
            )
            Text(
                text = "삭제",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onError,
            )
        }
    }
}

