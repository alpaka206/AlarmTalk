package com.voicealarm.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.network.AuthSession

@Composable
internal fun SettingsScreen(
    contentPadding: PaddingValues,
    authSession: AuthSession?,
    themeMode: ThemeMode,
    onBack: () -> Unit,
    onChangeTheme: (ThemeMode) -> Unit,
    onEditNickname: () -> Unit,
    onChangeFamilyAlarmSettings: (Boolean, List<Int>, String, String) -> Unit,
    onLogout: () -> Unit,
    onDeleteAccount: () -> Unit,
) {
    var showThemeDialog by remember { mutableStateOf(false) }
    var showFamilyAlarmDialog by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Text(
                    text = "설정",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        item {
            SettingsCard(title = "화면") {
                SettingsRow(
                    label = "화면 모드",
                    value = themeModeLabel(themeMode),
                    onClick = { showThemeDialog = true },
                )
            }
        }

        if (authSession != null) {
            item {
                SettingsCard(title = "공유 알람") {
                    SettingsToggleRow(
                        label = "상대방 알람 허용",
                        value = if (authSession.user.allowFamilyAlarms) "허용" else "꺼짐",
                        checked = authSession.user.allowFamilyAlarms,
                        onCheckedChange = {
                            onChangeFamilyAlarmSettings(
                                it,
                                authSession.user.familyAlarmQuietDays,
                                authSession.user.familyAlarmQuietStart,
                                authSession.user.familyAlarmQuietEnd,
                            )
                        },
                    )
                    if (authSession.user.allowFamilyAlarms) {
                        HorizontalDivider()
                        SettingsRow(
                            label = "설정 불가 시간",
                            value = quietScheduleLabel(
                                authSession.user.familyAlarmQuietDays,
                                authSession.user.familyAlarmQuietStart,
                                authSession.user.familyAlarmQuietEnd,
                            ),
                            onClick = { showFamilyAlarmDialog = true },
                        )
                    }
                }
            }

            item {
                SettingsCard(title = "계정") {
                    SettingsRow(
                        label = "닉네임",
                        value = authSession.user.name.ifBlank { "이름 없음" },
                        onClick = onEditNickname,
                    )
                    HorizontalDivider()
                    SettingsRow(
                        label = "로그아웃",
                        value = null,
                        onClick = onLogout,
                    )
                }
            }

            item {
                SettingsCard(title = null) {
                    SettingsRow(
                        label = "회원 탈퇴",
                        value = null,
                        labelColor = MaterialTheme.colorScheme.error,
                        onClick = onDeleteAccount,
                    )
                }
            }
        }
    }

    if (showThemeDialog) {
        ThemeModePickerDialog(
            current = themeMode,
            onDismiss = { showThemeDialog = false },
            onSelect = { mode ->
                showThemeDialog = false
                onChangeTheme(mode)
            },
        )
    }

    if (showFamilyAlarmDialog && authSession != null) {
        FamilyAlarmQuietTimeDialog(
            initialDays = authSession.user.familyAlarmQuietDays,
            initialStart = authSession.user.familyAlarmQuietStart,
            initialEnd = authSession.user.familyAlarmQuietEnd,
            onDismiss = { showFamilyAlarmDialog = false },
            onConfirm = { days, start, end ->
                showFamilyAlarmDialog = false
                onChangeFamilyAlarmSettings(true, days, start, end)
            },
        )
    }
}

@Composable
private fun SettingsCard(
    title: String?,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title != null) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
        OutlinedCard {
            Column { content() }
        }
    }
}

@Composable
private fun SettingsRow(
    label: String,
    value: String?,
    labelColor: Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            color = labelColor,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f),
        )
        if (value != null) {
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(end = 4.dp),
            )
        }
        Icon(
            imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SettingsToggleRow(
    label: String,
    value: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        VoiceAlarmSwitch(
            checked = checked,
            onCheckedChange = onCheckedChange,
        )
    }
}

@Composable
private fun FamilyAlarmQuietTimeDialog(
    initialDays: List<Int>,
    initialStart: String,
    initialEnd: String,
    onDismiss: () -> Unit,
    onConfirm: (List<Int>, String, String) -> Unit,
) {
    var selectedDays by remember(initialDays) {
        mutableStateOf(initialDays.ifEmpty { listOf(1, 2, 3, 4, 5) }.distinct().sorted())
    }
    var start by remember(initialStart) { mutableStateOf(initialStart) }
    var end by remember(initialEnd) { mutableStateOf(initialEnd) }
    val valid = isTimeText(start) && isTimeText(end)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("설정 불가 시간") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    text = "선택한 시간에는 다른 사람이 내 알람을 만들 수 없어요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("일", "월", "화", "수", "목", "금", "토")
                        .mapIndexed { index, label -> index to label }
                        .chunked(4)
                        .forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                row.forEach { (index, label) ->
                                    FilterChip(
                                        selected = index in selectedDays,
                                        onClick = {
                                            selectedDays = if (index in selectedDays) {
                                                selectedDays - index
                                            } else {
                                                (selectedDays + index).distinct().sorted()
                                            }
                                        },
                                        label = { Text(label) },
                                    )
                                }
                            }
                        }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = start,
                        onValueChange = { start = it.filter { char -> char.isDigit() || char == ':' }.take(5) },
                        label = { Text("시작") },
                        singleLine = true,
                        isError = start.isNotBlank() && !isTimeText(start),
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = end,
                        onValueChange = { end = it.filter { char -> char.isDigit() || char == ':' }.take(5) },
                        label = { Text("종료") },
                        singleLine = true,
                        isError = end.isNotBlank() && !isTimeText(end),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(selectedDays, start, end) },
                enabled = valid,
            ) {
                Text("저장")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("취소")
            }
        },
    )
}

private fun quietScheduleLabel(days: List<Int>, start: String, end: String): String =
    "${quietDaysLabel(days)} $start-$end"

private fun quietDaysLabel(days: List<Int>): String {
    val sorted = days.distinct().sorted()
    return when (sorted) {
        emptyList<Int>() -> "없음"
        listOf(1, 2, 3, 4, 5) -> "월-금"
        listOf(0, 6) -> "주말"
        listOf(0, 1, 2, 3, 4, 5, 6) -> "매일"
        else -> sorted.joinToString(",") { listOf("일", "월", "화", "수", "목", "금", "토")[it] }
    }
}

private fun isTimeText(value: String): Boolean =
    Regex("""^([01]\d|2[0-3]):[0-5]\d$""").matches(value)
