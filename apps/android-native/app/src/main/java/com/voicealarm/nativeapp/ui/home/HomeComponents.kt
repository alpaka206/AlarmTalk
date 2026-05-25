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
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

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
    hasSharedPass: Boolean,
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
                if (!hasSharedPass) {
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
                if (hasSharedPass) {
                    ProfileMenuItem(
                        icon = Icons.Outlined.People,
                        label = "공유 이용권",
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
    ThemeMode.System -> "시스템 설정"
    ThemeMode.Light -> "밝게"
    ThemeMode.Dark -> "어둡게"
}

@Composable
internal fun ThemeModePickerDialog(
    current: ThemeMode,
    onDismiss: () -> Unit,
    onSelect: (ThemeMode) -> Unit,
) {
    val options = listOf(
        ThemeModeOption(
            mode = ThemeMode.System,
            title = "시스템",
            description = "휴대폰 설정을 따라가요.",
            icon = Icons.Outlined.Settings,
        ),
        ThemeModeOption(
            mode = ThemeMode.Light,
            title = "밝게",
            description = "낮에도 선명한 밝은 화면이에요.",
            icon = Icons.Outlined.LightMode,
        ),
        ThemeModeOption(
            mode = ThemeMode.Dark,
            title = "어둡게",
            description = "밤에 보기 편한 어두운 화면이에요.",
            icon = Icons.Outlined.DarkMode,
        ),
    )

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .widthIn(max = 420.dp),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ModalDialogTitle("테마 선택", onDismiss = onDismiss)
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    options.forEach { option ->
                        ThemeModeOptionRow(
                            option = option,
                            selected = option.mode == current,
                            onClick = {
                                onSelect(option.mode)
                                onDismiss()
                            },
                        )
                    }
                }
            }
        }
    }
}

private data class ThemeModeOption(
    val mode: ThemeMode,
    val title: String,
    val description: String,
    val icon: ImageVector,
)

@Composable
private fun ThemeModeOptionRow(
    option: ThemeModeOption,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = if (selected) {
            scheme.primaryContainer.copy(alpha = 0.62f)
        } else {
            scheme.surfaceVariant.copy(alpha = 0.34f)
        },
        border = BorderStroke(
            width = 1.dp,
            color = if (selected) scheme.primary.copy(alpha = 0.52f) else scheme.outlineVariant,
        ),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = CircleShape,
                color = if (selected) scheme.primary else scheme.surface,
                contentColor = if (selected) scheme.onPrimary else scheme.primary,
                border = BorderStroke(1.dp, scheme.outlineVariant),
            ) {
                Box(
                    modifier = Modifier.size(42.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = option.icon,
                        contentDescription = null,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = option.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = scheme.onSurface,
                )
                Text(
                    text = option.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                )
            }
            if (selected) {
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = scheme.primary,
                    contentColor = scheme.onPrimary,
                ) {
                    Text(
                        text = "선택됨",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

@Composable
internal fun NicknameEditDialog(
    initial: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by remember { mutableStateOf(initial) }
    val trimmedValue = value.trim()
    val canSave = !busy && trimmedValue.isNotEmpty() && trimmedValue != initial

    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .widthIn(max = 430.dp),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ModalDialogTitle(
                    title = "닉네임 수정",
                    onDismiss = onDismiss,
                    dismissEnabled = !busy,
                )
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.34f),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surface,
                            contentColor = MaterialTheme.colorScheme.primary,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        ) {
                            Box(
                                modifier = Modifier.size(42.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Person,
                                    contentDescription = null,
                                    modifier = Modifier.size(22.dp),
                                )
                            }
                        }
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = "앱에서 보일 이름",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                            Text(
                                text = "알람, 메시지, 공유 이용권 화면에서 이 이름을 사용해요.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it.take(30) },
                        label = { Text("닉네임") },
                        placeholder = { Text("예: 규원") },
                        singleLine = true,
                        enabled = !busy,
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = "${value.length}/30",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.align(Alignment.End),
                    )
                }
                Button(
                    onClick = { onConfirm(value) },
                    enabled = canSave,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(if (busy) "저장 중" else "저장")
                }
            }
        }
    }
}

@Composable
internal fun DeleteAccountConfirmDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            ModalDialogTitle(
                title = "회원 탈퇴",
                onDismiss = onDismiss,
                dismissEnabled = !busy,
            )
        },
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
