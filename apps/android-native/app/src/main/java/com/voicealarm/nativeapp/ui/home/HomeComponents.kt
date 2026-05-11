package com.voicealarm.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.CharacterResponse

@Composable
internal fun HomeHeader() {
    val hour = java.time.LocalTime.now().hour
    val greeting = when {
        hour < 6 -> "좋은 밤이에요"
        hour < 12 -> "좋은 아침이에요"
        hour < 17 -> "좋은 오후예요"
        hour < 21 -> "좋은 저녁이에요"
        else -> "좋은 밤이에요"
    }
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = greeting,
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = "소중한 사람의 목소리가 기다리고 있어요",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                .size(40.dp)
                .clickable { expanded = true },
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.surface),
            shadowElevation = 4.dp,
        ) {
            Box(
                modifier = Modifier.size(40.dp),
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
        ) {
            if (!isPlanOwner) {
                ProfileMenuItem("코드 등록") {
                    expanded = false
                    onSelectTab(NativeTab.People)
                }
            }
            ProfileMenuItem("캐릭터") {
                expanded = false
                onSelectTab(NativeTab.Growth)
            }
            ProfileMenuItem("구독") {
                expanded = false
                onSelectTab(NativeTab.Billing)
            }
            if (isPlanOwner) {
                ProfileMenuItem("멤버/공유 코드 관리") {
                    expanded = false
                    onOpenMemberManagement()
                }
            }
            HorizontalDivider()
            ProfileMenuItem("설정") {
                expanded = false
                onOpenSettings()
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
            style = MaterialTheme.typography.displaySmall,
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
