package com.alarmtalk.app

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun AlarmTalkBottomBar(
    selectedTab: NativeTab,
    unreadAlarmCount: Int,
    unreadMessageCount: Int,
    messagesLocked: Boolean,
    onSelectTab: (NativeTab) -> Unit,
    onCreateAlarm: () -> Unit,
) {
    // 배경색과 동일하게 깔아 시스템 내비게이션 바(배경색)와 이음새 없이 이어지게 한다.
    Surface(
        color = MaterialTheme.colorScheme.background,
        tonalElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .height(76.dp)
                .padding(horizontal = 6.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AlarmTalkTabItem(
                tab = NativeTab.Alarms,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Alarm,
                selectedIcon = Icons.Filled.Alarm,
                label = stringResource(R.string.r3app_bottom_tab_alarms),
                badgeCount = unreadAlarmCount,
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Voices,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Mic,
                selectedIcon = Icons.Filled.Mic,
                label = stringResource(R.string.r3app_bottom_tab_voices),
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmCreateBarButton(
                onClick = onCreateAlarm,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Messages,
                selectedTab = selectedTab,
                icon = Icons.AutoMirrored.Outlined.Message,
                selectedIcon = Icons.AutoMirrored.Filled.Message,
                label = stringResource(R.string.r3app_bottom_tab_messages),
                badgeCount = unreadMessageCount,
                locked = messagesLocked,
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Menu,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Menu,
                selectedIcon = Icons.Filled.Menu,
                label = stringResource(R.string.r3app_bottom_tab_menu),
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

// 중앙 알람 생성 버튼 — 탭이 아닌 유일한 '동작' 슬롯이라 원형 프라이머리로 도드라지게 그린다.
@Composable
private fun AlarmCreateBarButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxHeight(),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            shadowElevation = 6.dp,
        ) {
            Box(
                modifier = Modifier.size(52.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Add,
                    contentDescription = stringResource(R.string.r3app_bottom_create_alarm_desc),
                    modifier = Modifier.size(26.dp),
                )
            }
        }
    }
}

@Composable
internal fun AlarmTalkTabItem(
    tab: NativeTab,
    selectedTab: NativeTab,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selectedIcon: androidx.compose.ui.graphics.vector.ImageVector = icon,
    label: String,
    badgeCount: Int = 0,
    locked: Boolean = false,
    onSelectTab: (NativeTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val selected = selectedTab == tab
    val interactionSource = remember { MutableInteractionSource() }
    // 배경 인디케이터 없이 색(+filled 아이콘 스왑)으로만 선택을 표시한다.
    val selectedContentColor by animateColorAsState(
        targetValue = if (selected) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
        label = "tab-tint",
    )
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
        modifier = modifier
            .fillMaxHeight()
            .clickable(
                enabled = !selected,
                interactionSource = interactionSource,
                indication = null,
                role = Role.Tab,
                onClick = { onSelectTab(tab) },
            ),
    ) {
        Box(
            modifier = Modifier
                .width(54.dp)
                .height(30.dp),
            contentAlignment = Alignment.Center,
        ) {
            BadgedBox(
                badge = {
                    if (!locked && badgeCount > 0) {
                        Badge(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ) {
                            Text(text = badgeLabel(badgeCount))
                        }
                    }
                },
            ) {
                Icon(
                    imageVector = if (selected) selectedIcon else icon,
                    contentDescription = label,
                    tint = selectedContentColor,
                    modifier = Modifier.size(22.dp),
                )
            }
            if (locked) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 9.dp, y = (-4).dp)
                        .size(15.dp)
                        .background(MaterialTheme.colorScheme.surface, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Lock,
                        contentDescription = stringResource(R.string.r3app_bottom_locked_desc),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = selectedContentColor,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

private fun badgeLabel(count: Int): String = if (count > 99) "99+" else count.toString()
