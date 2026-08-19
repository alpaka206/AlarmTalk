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
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Menu
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
import androidx.compose.ui.unit.Dp
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
                // ⚠ **세 탭 모두 Material 아이콘이다**(2026-08-17 지시 "글리프는 각 OS 것").
                // 예전에는 알람만 Material 이고 목소리·더보기는 **iOS(SF) 모양을 베낀 자체
                // 드로어블**이었다 — 한 줄 안에 두 디자인 언어가 섞여 있었다.
                // ⚠ Material 알람은 Outlined 와 Filled 의 path 가 사실상 같다 — 선택 표시는
                // **색으로만** 된다. 그게 원래 안드로이드 동작이다.
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
            AlarmTalkTabItem(
                tab = NativeTab.Menu,
                selectedTab = selectedTab,
                icon = Icons.Filled.Menu,
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
    icon: ImageVector,
    selectedIcon: ImageVector = icon,
    /// 아이콘 박스 크기. Material 은 24 격자에서 잉크가 20.2(84%)뿐이라, SF 심볼 기준
    /// 22 로 두면 작아 보인다 — 잉크를 맞춘 값이 26 이다(22 / 0.842).
    /// 세 탭이 모두 Material 이므로 이제 한 값이다(2026-08-17).
    iconSize: Dp = 26.dp,
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
                val iconModifier = Modifier.size(iconSize)
                Icon(
                    imageVector = if (selected) selectedIcon else icon,
                    contentDescription = label,
                    tint = selectedContentColor,
                    modifier = iconModifier,
                )
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


private fun badgeLabel(count: Int): String = if (count > 99) "99+" else count.toString()
