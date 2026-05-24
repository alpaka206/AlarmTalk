package com.voicealarm.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun HomeHeader() {
    val hour = java.time.LocalTime.now().hour
    val (greetingTop, greetingBottom) = when {
        hour < 6 -> "좋아하는 목소리로" to "깨워드릴게요"
        hour < 12 -> "오늘 아침," to "잘 일어나셨나요?"
        hour < 17 -> "내일 알람을" to "준비해요"
        hour < 21 -> "서로의 목소리로" to "아침을 예약해요"
        else -> "좋아하는 목소리로" to "깨워드릴게요"
    }
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = greetingTop,
            modifier = Modifier.padding(end = 72.dp),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = greetingBottom,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
internal fun ProfileMenu(
    isPlanOwner: Boolean,
    onSelectTab: (NativeTab) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenMemberManagement: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Surface(
            modifier = Modifier
                .size(44.dp)
                .clickable { expanded = true },
            shape = CircleShape,
            color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shadowElevation = 4.dp,
        ) {
            Box(
                modifier = Modifier.size(44.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Person,
                    contentDescription = "프로필",
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.width(232.dp),
            shape = RoundedCornerShape(22.dp),
            containerColor = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 14.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Column(
                modifier = Modifier.padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (!isPlanOwner) {
                    ProfileMenuItem(
                        icon = Icons.Outlined.QrCode2,
                        label = "초대 코드 등록",
                    ) {
                        expanded = false
                        onSelectTab(NativeTab.People)
                    }
                }
                ProfileMenuItem(
                    icon = Icons.Outlined.EmojiEvents,
                    label = "캐릭터",
                ) {
                    expanded = false
                    onSelectTab(NativeTab.Growth)
                }
                ProfileMenuItem(
                    icon = Icons.Outlined.CreditCard,
                    label = "이용권",
                ) {
                    expanded = false
                    onSelectTab(NativeTab.Billing)
                }
                if (isPlanOwner) {
                    ProfileMenuItem(
                        icon = Icons.Outlined.People,
                        label = "멤버 관리",
                    ) {
                        expanded = false
                        onOpenMemberManagement()
                    }
                }
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                ProfileMenuItem(
                    icon = Icons.Outlined.Settings,
                    label = "설정",
                ) {
                    expanded = false
                    onOpenSettings()
                }
            }
        }
    }
}

@Composable
internal fun ProfileMenuItem(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier.size(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(21.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}


enum class ThemeMode { System, Light, Dark }

internal fun themeModeLabel(mode: ThemeMode): String = when (mode) {
    ThemeMode.System -> "시스템"
    ThemeMode.Light -> "라이트"
    ThemeMode.Dark -> "다크"
}

@Composable
internal fun ThemeModePickerDialog(
    current: ThemeMode,
    onDismiss: () -> Unit,
    onSelect: (ThemeMode) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("화면 모드") },
        text = {
            Column {
                ThemeMode.entries.forEach { mode ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = mode == current,
                            onClick = { onSelect(mode) },
                        )
                        Text(themeModeLabel(mode))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("닫기") }
        },
    )
}

@Composable
internal fun NicknameEditDialog(
    initial: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("닉네임 수정") },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it.take(30) },
                label = { Text("닉네임") },
                singleLine = true,
                enabled = !busy,
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(value) },
                enabled = !busy && value.trim().isNotEmpty() && value.trim() != initial,
            ) { Text("저장") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("취소") }
        },
    )
}

@Composable
internal fun DeleteAccountConfirmDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("회원 탈퇴") },
        text = {
            Text(
                "정말 탈퇴할까요? 알람, 음성, 메시지 등 모든 데이터가 삭제되고 복구할 수 없어요.",
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !busy) {
                Text(
                    text = "탈퇴",
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("취소") }
        },
    )
}

@Composable
internal fun ScreenHeader(
    title: String,
    subtitle: String? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        if (!subtitle.isNullOrBlank()) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
