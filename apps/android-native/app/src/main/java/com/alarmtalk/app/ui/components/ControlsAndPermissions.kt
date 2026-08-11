package com.alarmtalk.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
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
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerTileShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
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
    // 손잡이는 **켜짐/꺼짐 모두 흰색**이다(2026-08-10 결정 — iOS 시스템 스위치에 맞춘다).
    //
    // 예전에는 다크에서 켜짐 썸을 `onPrimaryContainer`, 꺼짐 썸을 `onSurfaceVariant` 로
    // 따로 줬다. 이유는 타당했다(진네이비 썸이 밝은 트랙보다 어두워 꺼짐으로 오독된다 /
    // surface 썸이 트랙과 동화된다). 다만 그러면 두 앱의 스위치가 서로 다른 물건으로
    // 보였고, 흰 썸으로도 그 두 문제가 생기지 않는다 — 흰색은 켜짐 트랙(#A6D2FF)보다
    // 밝고 꺼짐 트랙(surfaceVariant)과도 충분히 분리된다.
    val checkedThumbColor = Color.White
    val uncheckedThumbColor = Color.White
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        enabled = enabled,
        modifier = modifier,
        colors = SwitchDefaults.colors(
            checkedThumbColor = checkedThumbColor,
            checkedTrackColor = MaterialTheme.colorScheme.primary,
            checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = uncheckedThumbColor,
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

/**
 * 알람 홈용 슬림 권한 경고 배너. 이미 알람이 있는데 알람 권한이 없어 '조용히 안 울릴' 수 있을 때만
 * 노출한다(큰 PermissionPanel 카드 대신 한 줄). 탭하면 권한 게이트 모달이 열려 바로 요청/설정으로 잇는다.
 */

/**
 * 알람 홈용 슬림 권한 경고 배너. 탭하면 권한 게이트가 열려 바로 요청/설정으로 잇는다.
 *
 * 문구를 밖에서 받는다 — 권한이 없을 때 결과가 두 가지라서다(아예 안 울림 / 늦게 울림).
 * 껍데기는 하나로 두고 말만 바꾼다.
 */
@Composable
internal fun AlarmPermissionWarningBanner(
    textResId: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedCard(
        onClick = onClick,
        shape = WakerTileShape,
        border = wakerCardBorder(),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                Icons.Outlined.ErrorOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = stringResource(textResId),
                style = MaterialTheme.typography.bodyMedium,
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
    voiceName: String?,
    onToggleEnabled: (Boolean) -> Unit,
    onEditAlarm: () -> Unit,
    onDeleteAlarm: () -> Unit,
    /** 선택 모드 — 켜지면 행 전체가 '고르기'가 된다(수정·스와이프·토글 없음). */
    selectionMode: Boolean = false,
    selected: Boolean = false,
    onToggleSelected: () -> Unit = {},
    /** 길게 누르면 선택 모드로 들어간다(그 행을 첫 선택으로). */
    onEnterSelection: () -> Unit = {},
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val deleteWidth = 92.dp
    val deleteWidthPx = with(LocalDensity.current) { deleteWidth.toPx() }
    var deleteRevealed by remember(alarm.id) { mutableStateOf(false) }
    // 손가락과 1:1 로 따라오고(snapTo), 놓으면 놓는 순간의 속도를 이어받아 스프링으로
    // 정착한다(animateTo + initialVelocity). 드래그↔애니메이션 사이 이음새를 없애고,
    // 정착 중에 다시 잡아도 현재 위치에서 그대로 이어진다.
    // 바운드 [-deleteWidthPx, 0]: 세게 플릭하면 스프링이 큰 초기 속도를 이어받아 목표를 지나치는데
    // (무진동 감쇠도 초기 속도가 크면 1회 오버슈트), 그러면 카드가 삭제 버튼(고정 92dp)보다 더 밀려
    // '삭제와 분리'돼 보인다 → Animatable 바운드로 양방향 오버슈트를 물리적으로 차단한다.
    val offsetX = remember(alarm.id, deleteWidthPx) {
        Animatable(0f).apply { updateBounds(lowerBound = -deleteWidthPx, upperBound = 0f) }
    }
    val scope = rememberCoroutineScope()
    // 빠른 플릭은 거리가 짧아도 의도가 분명하므로 위치보다 속도 부호를 우선한다.
    val flingVelocityPx = with(LocalDensity.current) { 420.dp.toPx() }
    val settleSpec = spring<Float>(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessMediumLow,
    )
    val rowNotice = alarmRowNotice(alarm)
    val warningText = rowNotice?.let { stringResource(it.textResId) }
    // 스와이프 외에 접근성(TalkBack/지체장애) 대체 삭제 수단: 길게 눌러 메뉴 노출.
    val deleteVisible = offsetX.value < -0.5f
    // 우측 모서리는 드러난 정도에 비례해 22→0dp 로 연속 변형(불연속 형태 전환 방지).
    val revealFraction = (-offsetX.value / deleteWidthPx).coerceIn(0f, 1f)
    val endCornerRadius = 22.dp * (1f - revealFraction)
    val alarmCardShape = RoundedCornerShape(
        topStart = 22.dp,
        topEnd = endCornerRadius,
        bottomEnd = endCornerRadius,
        bottomStart = 22.dp,
    )
    val deleteButtonShape = RoundedCornerShape(
        topStart = 0.dp,
        topEnd = 22.dp,
        bottomEnd = 22.dp,
        bottomStart = 0.dp,
    )
    val dragState = rememberDraggableState { delta ->
        scope.launch {
            offsetX.snapTo((offsetX.value + delta).coerceIn(-deleteWidthPx, 0f))
        }
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
                .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                // 평소: 클릭=수정/펼침 해제, 길게 누르기=선택 모드 진입.
                // 선택 모드: 클릭=선택 토글(길게 누르기는 이미 모드 안이라 무의미).
                // 길게 누르기가 스와이프와 별개의 접근성 친화 경로를 계속 제공한다.
                // 리플(indication)은 끈다 — 카드 전체를 덮는 사각 하이라이트가 길게 누르는
                // 내내 남아 카드 모서리와 어긋나 보인다. 선택 모드 진입은 행의 체크 표시와
                // 상단 [취소][삭제] 바가 이미 분명하게 알려준다.
                .combinedClickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {
                        when {
                            selectionMode -> onToggleSelected()
                            deleteRevealed -> {
                                deleteRevealed = false
                                scope.launch { offsetX.animateTo(0f, settleSpec) }
                            }
                            else -> onEditAlarm()
                        }
                    },
                    onLongClick = { if (!selectionMode) onEnterSelection() },
                )
                .draggable(
                    state = dragState,
                    enabled = !selectionMode,
                    orientation = Orientation.Horizontal,
                    onDragStopped = { velocity ->
                        val open = when {
                            velocity < -flingVelocityPx -> true
                            velocity > flingVelocityPx -> false
                            else -> offsetX.value <= -deleteWidthPx * 0.42f
                        }
                        deleteRevealed = open
                        scope.launch {
                            offsetX.animateTo(
                                targetValue = if (open) -deleteWidthPx else 0f,
                                animationSpec = settleSpec,
                                initialVelocity = velocity,
                            )
                        }
                    },
                ),
            shape = alarmCardShape,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = wakerCardBorder(),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
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
                        // 날짜 뒤에 '누구 목소리로 울리는지'를 붙인다 — 홈에서 알람을 구분하는
                        // 이 앱 고유의 정보라, 라벨 없는 리스트에서 구분자 역할도 겸한다.
                        val dateLabel = nextFireDateLabel(context, nextFireMillis)
                        Text(
                            text = if (voiceName.isNullOrBlank()) {
                                dateLabel
                            } else {
                                stringResource(R.string.hs_alarm_row_date_voice, dateLabel, voiceName)
                            },
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
                    if (selectionMode) {
                        // 선택 모드에선 켜기/끄기 대신 선택 표시를 같은 자리에 둔다 —
                        // 스위치가 남아 있으면 고르려다 알람을 꺼뜨린다.
                        Icon(
                            imageVector = if (selected) {
                                Icons.Outlined.CheckCircle
                            } else {
                                Icons.Outlined.RadioButtonUnchecked
                            },
                            contentDescription = null,
                            tint = if (selected) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outline
                            },
                            modifier = Modifier.size(24.dp),
                        )
                    } else {
                        // 켜짐/꺼짐 텍스트는 두지 않는다 — 스위치 위치·색이 곧 상태 표시.
                        AlarmTalkSwitch(
                            // **저장된 값 그대로.** 권한이 모자라다고 꺼진 것처럼 그리면,
                            // 탭할 때 '켜기' 가 되어 게이트가 뜨고 **끌 수가 없다**.
                            // 게다가 권한이 돌아오면 꺼진 줄 알았던 알람이 울린다(Codex #671 P1).
                            checked = alarm.enabled,
                            onCheckedChange = onToggleEnabled,
                        )
                    }
                }
                if (rowNotice != null && warningText != null) {
                    // 에러(재예약/동기화 실패)는 경고색, 강등 안내는 정보색으로 톤을 구분한다.
                    val isError = rowNotice.isError
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerTileShape,
                        color = if (isError) {
                            MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.72f)
                        } else {
                            MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.72f)
                        },
                        contentColor = if (isError) {
                            MaterialTheme.colorScheme.onErrorContainer
                        } else {
                            MaterialTheme.colorScheme.onSecondaryContainer
                        },
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = if (isError) Icons.Outlined.ErrorOutline else Icons.Outlined.Info,
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

private data class AlarmRowNotice(val textResId: Int, val isError: Boolean)

// 여기 넣기 전 기준: **사용자가 할 일이 있는가.** 없으면 넣지 않는다.
// 서버 동기화 실패(syncState=FAILED)를 뺀 이유가 그것이다 — 알람은 그대로 울리고
// (울림은 온디바이스다), 실패한 행은 다음 sync 마다 자동으로 다시 올라간다
// (AlarmSyncService 의 OUTBOUND_SYNC_STATES 에 FAILED 가 들어 있다). 할 일이 없는데
// 빨간 경고를 띄우면, 멀쩡히 울릴 알람을 고장 난 것으로 믿고 다른 알람을 또 맞춘다.
// 대신 조용히 삼키지는 않는다 — 실패는 로그(AlarmTalkLog)에 남는다.
private fun alarmRowNotice(alarm: AlarmEntity): AlarmRowNotice? = when {
    // 이건 다르다: 예약 자체가 실패해 **정말 안 울린다.** 다시 저장해 달라고 해야 한다.
    alarm.state == AlarmStates.FAILED ->
        AlarmRowNotice(R.string.common_alarm_warning_reschedule_failed, isError = true)
    // ⚠ **무료 강등 안내를 여기에 되살리지 말 것**(2026-08-11 제거).
    // `preLockPlayMode` 는 **영구 마커**라(다시 유료가 되면 복원하려고 남긴다) 이 행에
    // 걸면 안내가 영영 사라지지 않는다 — 해당 알람마다 매번 보인다.
    //
    // 그리고 **이미 1회성 안내가 있다**: 잠그는 순간 `applyFreePlanVoiceLock` 이
    // `msg_gb_free_plan_voice_alarms_locked`("무료 이용권으로 전환되어 목소리 알람이
    // 잠겼어요. 다시 이용권을 등록하면 복구돼요.")를 띄운다. 같은 말을 두 번, 그것도
    // 한쪽은 영구로 하고 있었다. iOS 에는 이 행 배지가 아예 없다.
    //
    // 공유 목소리 해제도 **여기서 알리지 않는다**(2026-08-11). 이제 두 경우 모두
    // `DowngradeNoticeStore` 대기표 → 1회성 모달이 맡는다.
    // 행에 계속 붙여 두면 무료로 지내는 내내 알람마다 경고가 보이는데, **알람은 정상
    // 작동 중이다**(기본 알람음으로 울린다) — 고장난 앱처럼 읽힐 뿐이다.
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

