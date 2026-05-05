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
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.People
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
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.CharacterResponse

@Composable
internal fun HomeHeader(
    authSession: AuthSession?,
    syncBusy: Boolean,
    onSelectTab: (NativeTab) -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
) {
    val hour = java.time.LocalTime.now().hour
    val greeting = when {
        hour < 6 -> "좋은 밤이에요"
        hour < 12 -> "좋은 아침이에요"
        hour < 17 -> "좋은 오후예요"
        hour < 21 -> "좋은 저녁이에요"
        else -> "좋은 밤이에요"
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = if (hour in 6..20) Icons.Outlined.Home else Icons.Outlined.Alarm,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                )
                Text(
                    text = greeting,
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
            }
            Text(
                text = "소중한 사람의 목소리가 기다리고 있어요",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        ProfileMenu(
            authSession = authSession,
            syncBusy = syncBusy,
            onSelectTab = onSelectTab,
            onSyncNow = onSyncNow,
            onLogout = onLogout,
        )
    }
}

@Composable
internal fun ProfileMenu(
    authSession: AuthSession?,
    syncBusy: Boolean,
    onSelectTab: (NativeTab) -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            AvatarBubble(label = authSession?.user?.name ?: authSession?.user?.email)
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DropdownMenuItem(
                text = {
                    Column {
                        Text(
                            text = authSession?.user?.name?.takeIf { it.isNotBlank() }
                                ?: authSession?.user?.email
                                ?: "로그인이 필요해요",
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = authSession?.user?.email ?: "홈에서 로그인하면 모든 기능을 사용할 수 있어요.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                onClick = { expanded = false },
            )
            HorizontalDivider()
            ProfileMenuItem("코드 등록") {
                expanded = false
                onSelectTab(NativeTab.People)
            }
            ProfileMenuItem("음성 메시지") {
                expanded = false
                onSelectTab(NativeTab.Messages)
            }
            ProfileMenuItem("캐릭터") {
                expanded = false
                onSelectTab(NativeTab.Growth)
            }
            ProfileMenuItem("구독") {
                expanded = false
                onSelectTab(NativeTab.Billing)
            }
            HorizontalDivider()
            ProfileMenuItem(if (syncBusy) "동기화 중" else "지금 동기화") {
                expanded = false
                onSyncNow()
            }
            if (authSession != null) {
                ProfileMenuItem("로그아웃") {
                    expanded = false
                    onLogout()
                }
            }
        }
    }
}

@Composable
internal fun ProfileMenuItem(
    label: String,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = { Text(label) },
        onClick = onClick,
    )
}

@Composable
internal fun AvatarBubble(label: String?) {
    Box(
        modifier = Modifier
            .size(42.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label?.firstOrNull()?.uppercaseChar()?.toString() ?: "V",
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
internal fun ScreenHeader(
    title: String,
    subtitle: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
