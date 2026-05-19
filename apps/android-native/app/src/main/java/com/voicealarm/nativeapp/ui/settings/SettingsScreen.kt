package com.voicealarm.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.DynamicPromptPreferenceStore
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.FamilyAlarmQuietWindow

@Composable
internal fun SettingsScreen(
    contentPadding: PaddingValues,
    authSession: AuthSession?,
    themeMode: ThemeMode,
    permissions: PermissionSnapshot,
    onBack: () -> Unit,
    onChangeTheme: (ThemeMode) -> Unit,
    onRequestPermission: (PermissionTarget) -> Unit,
    onRequestAllPermissions: () -> Unit,
    onEditNickname: () -> Unit,
    onChangeFamilyAlarmSettings: (Boolean, List<FamilyAlarmQuietWindow>) -> Unit,
    onLogout: () -> Unit,
    onDeleteAccount: () -> Unit,
) {
    val context = LocalContext.current
    val promptPreferenceStore = remember(context) { DynamicPromptPreferenceStore(context) }
    var promptPreferences by remember(context) { mutableStateOf(promptPreferenceStore.read()) }
    var showThemeDialog by remember { mutableStateOf(false) }
    var showWeatherLocationDialog by remember { mutableStateOf(false) }
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

        item {
            SettingsCard(title = "AI 문구") {
                SettingsRow(
                    label = "날씨 위치",
                    value = weatherLocationSettingsLabel(
                        promptPreferences.weatherCountry,
                        promptPreferences.weatherCity,
                    ),
                    onClick = { showWeatherLocationDialog = true },
                )
            }
        }

        item {
            PermissionPanel(
                permissions = permissions,
                onRequestPermission = onRequestPermission,
                onRequestAllPermissions = onRequestAllPermissions,
            )
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
                                authSession.user.familyAlarmQuietWindows,
                            )
                        },
                    )
                    if (authSession.user.allowFamilyAlarms) {
                        HorizontalDivider()
                        SettingsRow(
                            label = "설정 불가 시간",
                            value = quietScheduleLabel(authSession.user.familyAlarmQuietWindows),
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

    if (showWeatherLocationDialog) {
        WeatherLocationPreferenceDialog(
            country = promptPreferences.weatherCountry,
            city = promptPreferences.weatherCity,
            onDismiss = { showWeatherLocationDialog = false },
            onConfirm = { country, city ->
                promptPreferenceStore.saveWeatherLocation(country, city)
                promptPreferences = promptPreferenceStore.read()
                showWeatherLocationDialog = false
            },
        )
    }

    if (showFamilyAlarmDialog && authSession != null) {
        FamilyAlarmQuietTimeDialog(
            initialWindows = authSession.user.familyAlarmQuietWindows,
            onDismiss = { showFamilyAlarmDialog = false },
            onConfirm = { windows ->
                showFamilyAlarmDialog = false
                onChangeFamilyAlarmSettings(true, windows)
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
private fun WeatherLocationPreferenceDialog(
    country: String,
    city: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var draftCountry by remember(country) { mutableStateOf(country) }
    var draftCity by remember(city) { mutableStateOf(city) }
    var submitted by remember { mutableStateOf(false) }
    val countryError = submitted && draftCountry.isBlank()
    val cityError = submitted && draftCity.isBlank()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("날씨 위치") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "랜덤 문구에서 날씨가 필요한 옵션을 고르면 이 위치를 재사용해요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = draftCountry,
                    onValueChange = { draftCountry = it.take(30) },
                    label = { Text("나라") },
                    placeholder = { Text("예: 대한민국") },
                    singleLine = true,
                    isError = countryError,
                    supportingText = {
                        if (countryError) Text("필수 입력 값입니다.")
                    },
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draftCity,
                    onValueChange = { draftCity = it.take(30) },
                    label = { Text("도시") },
                    placeholder = { Text("예: 서울") },
                    singleLine = true,
                    isError = cityError,
                    supportingText = {
                        if (cityError) Text("필수 입력 값입니다.")
                    },
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    submitted = true
                    if (draftCountry.isNotBlank() && draftCity.isNotBlank()) {
                        onConfirm(draftCountry.trim(), draftCity.trim())
                    }
                },
                shape = VocaWakeButtonShape,
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

@Composable
private fun FamilyAlarmQuietTimeDialog(
    initialWindows: List<FamilyAlarmQuietWindow>,
    onDismiss: () -> Unit,
    onConfirm: (List<FamilyAlarmQuietWindow>) -> Unit,
) {
    var drafts by remember(initialWindows) {
        mutableStateOf(
            initialWindows
                .ifEmpty { listOf(FamilyAlarmQuietWindow()) }
                .map { it.toDraft() },
        )
    }
    val valid = drafts.isNotEmpty() && drafts.all { it.isValid() }

    fun updateDraft(index: Int, transform: (QuietWindowDraft) -> QuietWindowDraft) {
        drafts = drafts.mapIndexed { currentIndex, draft ->
            if (currentIndex == index) transform(draft) else draft
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("설정 불가 시간") },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 520.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    text = "선택한 시간에는 다른 사람이 알람을 만들 수 없어요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                drafts.forEachIndexed { draftIndex, draft ->
                    OutlinedCard(
                        shape = VocaWakeCardShape,
                        border = vocaWakeCardBorder(),
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "불가 시간 ${draftIndex + 1}",
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.weight(1f),
                                )
                                if (drafts.size > 1) {
                                    IconButton(
                                        onClick = { drafts = drafts.filterIndexed { index, _ -> index != draftIndex } },
                                    ) {
                                        Icon(Icons.Outlined.Delete, contentDescription = "삭제")
                                    }
                                }
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                dayLabels()
                                    .mapIndexed { index, label -> index to label }
                                    .chunked(4)
                                    .forEach { row ->
                                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                            row.forEach { (dayIndex, label) ->
                                                FilterChip(
                                                    selected = dayIndex in draft.days,
                                                    onClick = {
                                                        updateDraft(draftIndex) {
                                                            val days = if (dayIndex in it.days) {
                                                                it.days - dayIndex
                                                            } else {
                                                                it.days + dayIndex
                                                            }
                                                            it.copy(days = days)
                                                        }
                                                    },
                                                    label = { Text(label) },
                                                )
                                            }
                                        }
                                    }
                            }
                            Text("시작", style = MaterialTheme.typography.labelMedium)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TimePartField(
                                    value = draft.startHour,
                                    label = "시",
                                    isError = draft.startHour.isNotBlank() && !isHourText(draft.startHour),
                                    onValueChange = { value -> updateDraft(draftIndex) { it.copy(startHour = value) } },
                                    modifier = Modifier.weight(1f),
                                )
                                TimePartField(
                                    value = draft.startMinute,
                                    label = "분",
                                    isError = draft.startMinute.isNotBlank() && !isMinuteText(draft.startMinute),
                                    onValueChange = { value -> updateDraft(draftIndex) { it.copy(startMinute = value) } },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            Text("종료", style = MaterialTheme.typography.labelMedium)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TimePartField(
                                    value = draft.endHour,
                                    label = "시",
                                    isError = draft.endHour.isNotBlank() && !isHourText(draft.endHour),
                                    onValueChange = { value -> updateDraft(draftIndex) { it.copy(endHour = value) } },
                                    modifier = Modifier.weight(1f),
                                )
                                TimePartField(
                                    value = draft.endMinute,
                                    label = "분",
                                    isError = draft.endMinute.isNotBlank() && !isMinuteText(draft.endMinute),
                                    onValueChange = { value -> updateDraft(draftIndex) { it.copy(endMinute = value) } },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }
                    }
                }
                Button(
                    onClick = {
                        if (drafts.size < 8) {
                            drafts = drafts + FamilyAlarmQuietWindow(days = listOf(1), start = "09:00", end = "18:30").toDraft()
                        }
                    },
                    enabled = drafts.size < 8,
                    modifier = Modifier.fillMaxWidth(),
                    shape = VocaWakeButtonShape,
                ) {
                    Text("시간 추가")
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(drafts.map { it.toWindow() }) },
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

@Composable
private fun TimePartField(
    value: String,
    label: String,
    isError: Boolean,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { value -> onValueChange(value.filter { it.isDigit() }.take(2)) },
        label = { Text(label) },
        singleLine = true,
        isError = isError,
        shape = VocaWakeInputShape,
        colors = vocaWakeOutlinedTextFieldColors(),
        modifier = modifier,
    )
}

private data class QuietWindowDraft(
    val days: Set<Int>,
    val startHour: String,
    val startMinute: String,
    val endHour: String,
    val endMinute: String,
)

private fun FamilyAlarmQuietWindow.toDraft(): QuietWindowDraft {
    val startParts = splitTime(start)
    val endParts = splitTime(end)
    return QuietWindowDraft(
        days = days.filter { it in 0..6 }.toSet().ifEmpty { setOf(1, 2, 3, 4, 5) },
        startHour = startParts.first,
        startMinute = startParts.second,
        endHour = endParts.first,
        endMinute = endParts.second,
    )
}

private fun QuietWindowDraft.toWindow(): FamilyAlarmQuietWindow =
    FamilyAlarmQuietWindow(
        days = days.sorted(),
        start = "${twoDigit(startHour)}:${twoDigit(startMinute)}",
        end = "${twoDigit(endHour)}:${twoDigit(endMinute)}",
    )

private fun QuietWindowDraft.isValid(): Boolean =
    days.isNotEmpty() &&
        isHourText(startHour) &&
        isMinuteText(startMinute) &&
        isHourText(endHour) &&
        isMinuteText(endMinute)

private fun splitTime(value: String): Pair<String, String> {
    val parts = value.split(":")
    return (parts.getOrNull(0)?.takeIf { isHourText(it) } ?: "09") to
        (parts.getOrNull(1)?.takeIf { isMinuteText(it) } ?: "00")
}

private fun twoDigit(value: String): String =
    value.toIntOrNull()?.coerceIn(0, 99)?.toString()?.padStart(2, '0') ?: "00"

private fun quietScheduleLabel(windows: List<FamilyAlarmQuietWindow>): String {
    if (windows.isEmpty()) return "없음"
    val visible = windows.take(2).joinToString(" · ") { quietWindowLabel(it) }
    val hidden = windows.size - 2
    return if (hidden > 0) "$visible 외 ${hidden}개" else visible
}

private fun weatherLocationSettingsLabel(country: String, city: String): String {
    val value = listOf(country, city)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" ")
    return value.ifBlank { "미설정" }
}

private fun quietWindowLabel(window: FamilyAlarmQuietWindow): String =
    "${quietDaysLabel(window.days)} ${window.start}-${window.end}"

private fun quietDaysLabel(days: List<Int>): String {
    val sorted = days.distinct().sorted()
    return when (sorted) {
        emptyList<Int>() -> "없음"
        listOf(1, 2, 3, 4, 5) -> "평일"
        listOf(0, 6) -> "주말"
        listOf(0, 1, 2, 3, 4, 5, 6) -> "매일"
        else -> sorted.joinToString(",") { dayLabels()[it] }
    }
}

private fun dayLabels(): List<String> = listOf("일", "월", "화", "수", "목", "금", "토")

private fun isHourText(value: String): Boolean =
    value.toIntOrNull()?.let { it in 0..23 } == true

private fun isMinuteText(value: String): Boolean =
    value.toIntOrNull()?.let { it in 0..59 } == true
