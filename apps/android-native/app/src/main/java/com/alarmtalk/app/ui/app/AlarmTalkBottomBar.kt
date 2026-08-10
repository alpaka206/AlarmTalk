package com.alarmtalk.app

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.ui.graphics.vector.ImageVector
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun AlarmTalkBottomBar(
    selectedTab: NativeTab,
    unreadAlarmCount: Int,
    onSelectTab: (NativeTab) -> Unit,
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
                // ⚠ **알람만 Material 아이콘이다.** 목소리·더보기는 iOS(SF) 모양의 자체
                // 드로어블인데, 알람은 안드로이드 모양으로 간다(2026-08-10 사용자 결정).
                // iOS 도 같은 도형을 그려 맞춰 뒀다 — `Views/Root/MaterialAlarmShape.swift`.
                // ⚠ Material 알람은 Outlined 와 Filled 의 path 가 사실상 같다 — 선택 표시는
                // **색으로만** 된다. 그게 원래 안드로이드 동작이다.
                icon = TabIcon.Vector(Icons.Outlined.Alarm),
                selectedIcon = TabIcon.Vector(Icons.Filled.Alarm),
                label = stringResource(R.string.r3app_bottom_tab_alarms),
                badgeCount = unreadAlarmCount,
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Voices,
                selectedTab = selectedTab,
                icon = TabIcon.Resource(R.drawable.ic_tab_mic),
                selectedIcon = TabIcon.Resource(R.drawable.ic_tab_mic_fill),
                label = stringResource(R.string.r3app_bottom_tab_voices),
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Menu,
                selectedTab = selectedTab,
                icon = TabIcon.Resource(R.drawable.ic_tab_menu),
                label = stringResource(R.string.r3app_bottom_tab_menu),
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
internal fun AlarmTalkTabItem(
    tab: NativeTab,
    selectedTab: NativeTab,
    // ⚠ 탭마다 아이콘 출처가 다르다 — 알람은 Material `ImageVector`, 목소리·더보기는
    // iOS 모양을 옮긴 자체 드로어블(`res/drawable/ic_tab_*.xml`)이다. 하나로 통일하려
    // 하지 말 것: 알람만 안드로이드 모양으로 두는 게 사용자 결정이다.
    icon: TabIcon,
    selectedIcon: TabIcon = icon,
    label: String,
    badgeCount: Int = 0,
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
                    if (badgeCount > 0) {
                        Badge(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ) {
                            Text(text = badgeLabel(badgeCount))
                        }
                    }
                },
            ) {
                // 크기는 **22** — 안드로이드 원래 값이다(2026-08-10 사용자 결정으로 복귀).
                val iconModifier = Modifier.size(22.dp)
                when (val current = if (selected) selectedIcon else icon) {
                    is TabIcon.Vector -> Icon(
                        imageVector = current.image,
                        contentDescription = label,
                        tint = selectedContentColor,
                        modifier = iconModifier,
                    )
                    is TabIcon.Resource -> Icon(
                        painter = painterResource(current.id),
                        contentDescription = label,
                        tint = selectedContentColor,
                        modifier = iconModifier,
                    )
                }
            }
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 12.sp,
                lineHeight = 16.sp,
                letterSpacing = 0.sp,
            ),
            color = selectedContentColor,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

/** 탭 아이콘 출처 — Material 벡터(알람)와 자체 드로어블(목소리·더보기)을 함께 받는다. */
internal sealed interface TabIcon {
    data class Vector(val image: ImageVector) : TabIcon
    data class Resource(@DrawableRes val id: Int) : TabIcon
}

private fun badgeLabel(count: Int): String = if (count > 99) "99+" else count.toString()
