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
                icon = R.drawable.ic_tab_alarm,
                selectedIcon = R.drawable.ic_tab_alarm_fill,
                label = stringResource(R.string.r3app_bottom_tab_alarms),
                badgeCount = unreadAlarmCount,
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Voices,
                selectedTab = selectedTab,
                icon = R.drawable.ic_tab_mic,
                selectedIcon = R.drawable.ic_tab_mic_fill,
                label = stringResource(R.string.r3app_bottom_tab_voices),
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Menu,
                selectedTab = selectedTab,
                icon = R.drawable.ic_tab_menu,
                selectedIcon = R.drawable.ic_tab_menu,
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
    // ⚠ **`ImageVector`(Material 아이콘)로 되돌리지 말 것.** 탭 아이콘은 iOS 와 같은 도형을
    // 24 좌표계에 옮긴 **자체 드로어블**이다(`res/drawable/ic_tab_*.xml`).
    @DrawableRes icon: Int,
    @DrawableRes selectedIcon: Int = icon,
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
                Icon(
                    painter = painterResource(if (selected) selectedIcon else icon),
                    contentDescription = label,
                    tint = selectedContentColor,
                    // ⚠ 22 가 아니라 **24** 다. 이 드로어블들은 SF Symbol 을 24 좌표계에
                    // 옮긴 것이라 잉크가 viewport 를 거의 꽉 채운다 — 22 로 그리면
                    // 아이폰보다 작아 보인다(Material 아이콘은 잉크가 18 안팎이었다).
                    modifier = Modifier.size(24.dp),
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
