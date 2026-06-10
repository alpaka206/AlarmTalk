package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun AlarmTalkBottomBar(
    selectedTab: NativeTab,
    unreadAlarmCount: Int,
    unreadMessageCount: Int,
    onSelectTab: (NativeTab) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
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
                tab = NativeTab.Home,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Home,
                label = "홈",
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Voices,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Mic,
                label = "목소리",
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Alarms,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Alarm,
                label = "알람",
                badgeCount = unreadAlarmCount,
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            AlarmTalkTabItem(
                tab = NativeTab.Messages,
                selectedTab = selectedTab,
                icon = Icons.AutoMirrored.Outlined.Message,
                label = "메시지",
                badgeCount = unreadMessageCount,
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
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    badgeCount: Int = 0,
    onSelectTab: (NativeTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val selected = selectedTab == tab
    val interactionSource = remember { MutableInteractionSource() }
    val isDarkScheme = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val selectedBackgroundColor = if (isDarkScheme) {
        MaterialTheme.colorScheme.surfaceVariant
    } else {
        MaterialTheme.colorScheme.primaryContainer
    }
    val selectedContentColor = if (isDarkScheme) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onPrimaryContainer
    }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
        modifier = modifier
            .fillMaxHeight()
            .clickable(
                enabled = !selected,
                interactionSource = interactionSource,
                indication = null,
                role = Role.Tab,
                onClick = { onSelectTab(tab) },
            )
            .background(
                color = if (selected) {
                    selectedBackgroundColor
                } else {
                    Color.Transparent
                },
                shape = RoundedCornerShape(14.dp),
            )
            .padding(vertical = 6.dp),
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
                imageVector = icon,
                contentDescription = label,
                tint = if (selected) {
                    selectedContentColor
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.size(22.dp),
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) {
                selectedContentColor
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

private fun badgeLabel(count: Int): String = if (count > 99) "99+" else count.toString()
