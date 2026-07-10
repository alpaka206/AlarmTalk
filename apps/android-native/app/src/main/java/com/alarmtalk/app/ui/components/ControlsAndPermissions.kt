package com.alarmtalk.app

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.res.stringResource
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerTileShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    showHeader: Boolean = true,
) {
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (showHeader) {
                Text(
                    text = stringResource(R.string.common_permission_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (!permissions.allStartupGranted) {
                Button(
                    onClick = onRequestAllPermissions,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Icon(Icons.Outlined.ErrorOutline, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.common_permission_allow_all))
                }
            }
            PermissionRow(
                icon = Icons.Outlined.Alarm,
                label = stringResource(R.string.common_permission_exact_alarm_label),
                granted = permissions.exactAlarms,
                actionLabel = stringResource(R.string.common_permission_allow_action),
                onAction = { onRequestPermission(PermissionTarget.ExactAlarms) },
            )
            PermissionRow(
                icon = Icons.Outlined.Notifications,
                label = stringResource(R.string.common_permission_notifications_label),
                granted = permissions.notifications,
                actionLabel = stringResource(R.string.common_permission_allow_action),
                onAction = { onRequestPermission(PermissionTarget.Notifications) },
            )
            PermissionRow(
                icon = Icons.Outlined.Fullscreen,
                label = stringResource(R.string.common_permission_full_screen_label),
                granted = permissions.fullScreenIntent,
                actionLabel = stringResource(R.string.common_permission_allow_action),
                onAction = { onRequestPermission(PermissionTarget.FullScreenIntent) },
            )
            PermissionRow(
                icon = Icons.Outlined.Mic,
                label = stringResource(R.string.common_permission_mic_label),
                granted = permissions.recordAudio,
                actionLabel = stringResource(R.string.common_permission_allow_action),
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
                shape = WakerTileShape,
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
                    text = if (granted) {
                        stringResource(R.string.common_permission_granted)
                    } else {
                        stringResource(R.string.common_permission_required)
                    },
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

/** "7:30" 12시간제(분 0패딩) — 리스트 시각 표시용(오전/오후는 별도 표기). */
private fun alarmRowClockLabel(hour: Int, minute: Int): String {
    val hour12 = hour % 12
    val displayHour = if (hour12 == 0) 12 else hour12
    return "$displayHour:${"%02d".format(minute)}"
}

/** 토글 켜진 알람이 다음 울릴 날짜 — 로케일에 맞춘 "7월 7일 (화)" 형태(연도 생략). */
private fun nextFireDateLabel(context: android.content.Context, fireAtMillis: Long): String =
    android.text.format.DateUtils.formatDateTime(
        context,
        fireAtMillis,
        android.text.format.DateUtils.FORMAT_SHOW_DATE or
            android.text.format.DateUtils.FORMAT_ABBREV_MONTH or
            android.text.format.DateUtils.FORMAT_SHOW_WEEKDAY or
            android.text.format.DateUtils.FORMAT_ABBREV_WEEKDAY or
            android.text.format.DateUtils.FORMAT_NO_YEAR,
    )

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun AlarmRow(
    alarm: AlarmEntity,
    onToggleEnabled: (Boolean) -> Unit,
    onEditAlarm: () -> Unit,
    onDeleteAlarm: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val deleteWidth = 92.dp
    val deleteWidthPx = with(LocalDensity.current) { deleteWidth.toPx() }
    var deleteRevealed by remember(alarm.id) { mutableStateOf(false) }
    var dragOffsetPx by remember(alarm.id) { mutableStateOf(0f) }
    val warningText = alarmRowWarningResId(alarm)?.let { stringResource(it) }
    // 스와이프 외에 접근성(TalkBack/지체장애) 대체 삭제 수단: 길게 눌러 메뉴 노출.
    var menuExpanded by remember(alarm.id) { mutableStateOf(false) }
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
            modifier = Modifier
                .offset { IntOffset(currentOffsetPx.roundToInt(), 0) }
                // 클릭=수정/펼침 해제, 길게 누르기=삭제 메뉴. 길게 누르기로 스와이프와 별개의
                // 접근성 친화 삭제 경로를 제공한다.
                .combinedClickable(
                    onClick = {
                        if (!deleteRevealed) {
                            onEditAlarm()
                        } else {
                            deleteRevealed = false
                            dragOffsetPx = 0f
                        }
                    },
                    onLongClick = { menuExpanded = true },
                )
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
                    // weight(1f) 로 스위치 공간을 남기고 라벨이 가질 폭을 확정해야
                    // 긴 알람 이름이 ellipsis(말줄임)로 잘려 행 레이아웃이 깨지지 않는다.
                    Column(modifier = Modifier.weight(1f)) {
                        val timeColor = if (alarm.enabled) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                        // 시각 앞에 오전/오후를 작게 붙이고 12시간제로 표시.
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                text = if (alarm.hour < 12) {
                                    stringResource(R.string.rd2_am)
                                } else {
                                    stringResource(R.string.rd2_pm)
                                },
                                style = MaterialTheme.typography.titleMedium.copy(
                                    fontSize = 16.sp,
                                    lineHeight = 20.sp,
                                    letterSpacing = 0.sp,
                                ),
                                fontWeight = FontWeight.SemiBold,
                                color = timeColor,
                                modifier = Modifier.padding(end = 6.dp, bottom = 6.dp),
                            )
                            Text(
                                text = alarmRowClockLabel(alarm.hour, alarm.minute),
                                style = MaterialTheme.typography.headlineLarge.copy(
                                    fontSize = 32.sp,
                                    lineHeight = 40.sp,
                                    fontFeatureSettings = "tnum",
                                    letterSpacing = 0.sp,
                                ),
                                fontWeight = FontWeight.Normal,
                                color = timeColor,
                            )
                        }
                        // 라벨 대신 '다음 울릴 날짜'를 안내(기본 시계 라벨보다 실용적). 꺼진 알람도 미리 보이도록,
                        // 켜진 건 실제 예약값(fireAtMillis), 꺼진 건 스케줄로 다음 울림을 계산해 표시한다.
                        val nextFireMillis = if (alarm.enabled) {
                            alarm.fireAtMillis
                        } else {
                            remember(alarm.hour, alarm.minute, alarm.repeatDaysMask, alarm.holidayOff) {
                                com.alarmtalk.app.data.AlarmTimeCalculator.nextFireAtMillis(
                                    hour = alarm.hour,
                                    minute = alarm.minute,
                                    repeatDaysMask = alarm.repeatDaysMask,
                                    holidayOff = alarm.holidayOff,
                                )
                            }
                        }
                        Text(
                            text = nextFireDateLabel(context, nextFireMillis),
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = 15.sp,
                                lineHeight = 21.sp,
                                letterSpacing = 0.sp,
                            ),
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    // 켜짐/꺼짐 텍스트는 두지 않는다 — 스위치 위치·색이 곧 상태 표시.
                    AlarmTalkSwitch(
                        checked = alarm.enabled,
                        onCheckedChange = onToggleEnabled,
                    )
                }
                if (warningText != null) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerTileShape,
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

        // 길게 누르기로 열리는 접근성 대체 삭제 메뉴(스와이프 삭제는 그대로 유지).
        DropdownMenu(
            expanded = menuExpanded,
            onDismissRequest = { menuExpanded = false },
        ) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.common_alarm_delete)) },
                onClick = {
                    menuExpanded = false
                    onDeleteAlarm()
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Outlined.Delete,
                        contentDescription = null,
                    )
                },
            )
        }
    }
}

private fun alarmRowWarningResId(alarm: AlarmEntity): Int? = when {
    alarm.state == AlarmStates.FAILED -> R.string.common_alarm_warning_reschedule_failed
    alarm.syncState == AlarmSyncStates.FAILED -> R.string.common_alarm_warning_sync_failed
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
                text = stringResource(R.string.common_alarm_delete),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onError,
            )
        }
    }
}

