package com.voicealarm.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.util.Locale
import com.voicealarm.nativeapp.data.DynamicPromptPreferenceStore
import com.voicealarm.nativeapp.data.toDynamicPromptSettings
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.DynamicPromptSettings
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
    onUpdateDynamicPromptSettings: (DynamicPromptSettings) -> Unit,
    onLogout: () -> Unit,
    onDeleteAccount: () -> Unit,
) {
    val context = LocalContext.current
    val promptPreferenceStore = remember(context) { DynamicPromptPreferenceStore(context) }
    var promptPreferences by remember(context) { mutableStateOf(promptPreferenceStore.read()) }
    var showThemeDialog by remember { mutableStateOf(false) }
    var showWeatherLocationDialog by remember { mutableStateOf(false) }
    var showFortuneInfoDialog by remember { mutableStateOf(false) }
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
            SettingsCard(title = "랜덤 문구") {
                SettingsRow(
                    label = "날씨 위치",
                    value = weatherLocationSettingsLabel(
                        promptPreferences.weatherCountry,
                        promptPreferences.weatherCity,
                    ),
                    onClick = { showWeatherLocationDialog = true },
                )
                HorizontalDivider()
                SettingsRow(
                    label = "운세용 정보",
                    value = fortuneInfoSettingsLabel(
                        promptPreferences.fortuneGender,
                        promptPreferences.fortuneBirthDate,
                        promptPreferences.fortuneBirthTime,
                    ),
                    onClick = { showFortuneInfoDialog = true },
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
                SettingsCard(title = "상대 알람 설정") {
                    SettingsToggleRow(
                        label = "상대가 내 알람 맞추기",
                        value = if (authSession.user.allowFamilyAlarms) "허용함" else "허용 안 함",
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
                            label = "알람 받지 않을 시간",
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
                onUpdateDynamicPromptSettings(promptPreferences.toDynamicPromptSettings())
                showWeatherLocationDialog = false
            },
        )
    }

    if (showFortuneInfoDialog) {
        FortuneInfoDialog(
            gender = promptPreferences.fortuneGender,
            birthDate = promptPreferences.fortuneBirthDate,
            birthTime = promptPreferences.fortuneBirthTime,
            description = "운세 문구를 만들 때만 사용해요. 가족이나 연인이 내 알람을 맞춰줄 때도 이 정보를 기준으로 써요.",
            onDismissWithoutSave = { showFortuneInfoDialog = false },
            onConfirm = { gender, birthDate, birthTime ->
                promptPreferenceStore.saveFortuneInfo(gender, birthDate, birthTime)
                promptPreferences = promptPreferenceStore.read()
                onUpdateDynamicPromptSettings(promptPreferences.toDynamicPromptSettings())
                showFortuneInfoDialog = false
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
                    text = "날씨 문구를 만들 때 이 위치를 사용해요.",
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
                        if (countryError) Text("꼭 입력해 주세요.")
                    },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
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
                        if (cityError) Text("꼭 입력해 주세요.")
                    },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
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
                shape = WakerButtonShape,
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

@OptIn(ExperimentalMaterial3Api::class)
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
    var timePickerTarget by remember { mutableStateOf<QuietTimePickerTarget?>(null) }
    val valid = drafts.isNotEmpty() && drafts.all { it.isValid() }

    fun updateDraft(index: Int, transform: (QuietWindowDraft) -> QuietWindowDraft) {
        drafts = drafts.mapIndexed { currentIndex, draft ->
            if (currentIndex == index) transform(draft) else draft
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            shadowElevation = 18.dp,
        ) {
            Column(
                modifier = Modifier
                    .padding(horizontal = 22.dp, vertical = 22.dp)
                    .heightIn(max = 620.dp),
            ) {
                Text(
                    text = "알람 받지 않을 시간",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "선택한 시간대에는 다른 사람이 내 알람을 맞출 수 없어요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp, bottom = 16.dp),
                )
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    drafts.forEachIndexed { draftIndex, draft ->
                        QuietWindowCard(
                            index = draftIndex,
                            draft = draft,
                            removable = drafts.size > 1,
                            onToggleDay = { dayIndex ->
                                updateDraft(draftIndex) {
                                    val days = if (dayIndex in it.days) it.days - dayIndex else it.days + dayIndex
                                    it.copy(days = days)
                                }
                            },
                            onPickStart = {
                                timePickerTarget = QuietTimePickerTarget(draftIndex, isStart = true)
                            },
                            onPickEnd = {
                                timePickerTarget = QuietTimePickerTarget(draftIndex, isStart = false)
                            },
                            onRemove = {
                                drafts = drafts.filterIndexed { index, _ -> index != draftIndex }
                            },
                        )
                    }
                    OutlinedButton(
                        onClick = {
                            if (drafts.size < 8) {
                                drafts = drafts + FamilyAlarmQuietWindow(
                                    days = listOf(1, 2, 3, 4, 5),
                                    start = "22:00",
                                    end = "07:00",
                                ).toDraft()
                            }
                        },
                        enabled = drafts.size < 8,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                        border = wakerCardBorder(),
                        colors = wakerOutlinedButtonColors(),
                    ) {
                        Text("+ 시간 추가")
                    }
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 18.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedButton(
                        onClick = onDismiss,
                        modifier = Modifier.weight(1f),
                        shape = WakerButtonShape,
                    ) {
                        Text("취소")
                    }
                    Button(
                        onClick = { onConfirm(drafts.map { it.toWindow() }) },
                        enabled = valid,
                        modifier = Modifier.weight(1f),
                        shape = WakerButtonShape,
                    ) {
                        Text("저장")
                    }
                }
            }
        }
    }

    timePickerTarget?.let { target ->
        val draft = drafts.getOrNull(target.index) ?: return@let
        val initialHour = (if (target.isStart) draft.startHour else draft.endHour).toIntOrNull()?.coerceIn(0, 23) ?: 9
        val initialMinute = (if (target.isStart) draft.startMinute else draft.endMinute).toIntOrNull()?.coerceIn(0, 59) ?: 0
        val state = rememberTimePickerState(
            initialHour = initialHour,
            initialMinute = initialMinute,
            is24Hour = true,
        )
        Dialog(onDismissRequest = { timePickerTarget = null }) {
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
                shadowElevation = 18.dp,
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = if (target.isStart) "시작 시간" else "종료 시간",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    TimePicker(state = state)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    ) {
                        TextButton(onClick = { timePickerTarget = null }) { Text("취소") }
                        TextButton(
                            onClick = {
                                val hh = String.format(Locale.US, "%02d", state.hour)
                                val mm = String.format(Locale.US, "%02d", state.minute)
                                updateDraft(target.index) {
                                    if (target.isStart) it.copy(startHour = hh, startMinute = mm)
                                    else it.copy(endHour = hh, endMinute = mm)
                                }
                                timePickerTarget = null
                            },
                        ) { Text("확인") }
                    }
                }
            }
        }
    }
}

private data class QuietTimePickerTarget(val index: Int, val isStart: Boolean)

@Composable
private fun QuietWindowCard(
    index: Int,
    draft: QuietWindowDraft,
    removable: Boolean,
    onToggleDay: (Int) -> Unit,
    onPickStart: () -> Unit,
    onPickEnd: () -> Unit,
    onRemove: () -> Unit,
) {
    val chipColors = FilterChipDefaults.filterChipColors(
        selectedContainerColor = MaterialTheme.colorScheme.primary,
        selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
    )
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "시간대 ${index + 1}",
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (removable) {
                    IconButton(onClick = onRemove) {
                        Icon(Icons.Outlined.Delete, contentDescription = "삭제")
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                dayLabels().forEachIndexed { dayIndex, label ->
                    FilterChip(
                        selected = dayIndex in draft.days,
                        onClick = { onToggleDay(dayIndex) },
                        label = {
                            Box(
                                modifier = Modifier.fillMaxWidth(),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(text = label, fontWeight = FontWeight.SemiBold)
                            }
                        },
                        colors = chipColors,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                QuietTimeChip(
                    label = quietTimeLabel(draft.startHour, draft.startMinute),
                    onClick = onPickStart,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "~",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                QuietTimeChip(
                    label = quietTimeLabel(draft.endHour, draft.endMinute),
                    onClick = onPickEnd,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun QuietTimeChip(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)),
        modifier = modifier,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

private fun quietTimeLabel(hour: String, minute: String): String {
    val h = hour.toIntOrNull() ?: 0
    val m = minute.toIntOrNull() ?: 0
    return String.format(Locale.US, "%d:%02d", h, m)
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

private fun fortuneInfoSettingsLabel(gender: String, birthDate: String, birthTime: String): String {
    val value = listOf(gender, birthDate, birthTime)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" · ")
    return value.ifBlank { "미설정" }
}

private fun quietWindowLabel(window: FamilyAlarmQuietWindow): String =
    "${quietDaysLabel(window.days)} ${formatQuietTime(window.start)} ~ ${formatQuietTime(window.end)}"

private fun formatQuietTime(value: String): String {
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull() ?: return value
    val minute = parts.getOrNull(1)?.toIntOrNull() ?: return value
    return String.format(Locale.US, "%d:%02d", hour, minute)
}

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
