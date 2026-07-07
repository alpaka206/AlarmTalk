package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
import com.alarmtalk.app.WakerHeroShape
import com.alarmtalk.app.WakerPanelShape
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FortuneInfoDialog(
    gender: String,
    birthDate: String,
    birthTime: String,
    onDismissWithoutSave: () -> Unit,
    onConfirm: (String, String, String) -> Unit,
) {
    val context = LocalContext.current
    var draftGender by remember(gender) { mutableStateOf(normalizeFortuneGender(gender)) }
    var draftBirthDate by remember(birthDate) { mutableStateOf(normalizeFortuneBirthDate(birthDate)) }
    var draftBirthTime by remember(birthTime) { mutableStateOf(normalizeFortuneBirthTime(birthTime)) }
    var submitted by remember { mutableStateOf(false) }
    var datePickerOpen by remember { mutableStateOf(false) }
    val genderError = submitted && draftGender.isBlank()
    val birthDateError = submitted && draftBirthDate.isBlank()
    val birthTimeError = submitted && draftBirthTime.isBlank()

    Dialog(
        onDismissRequest = onDismissWithoutSave,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .widthIn(max = 460.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 640.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ModalDialogTitle(
                    title = stringResource(R.string.editorp_fortune_dialog_title),
                    onDismiss = onDismissWithoutSave,
                )
                FortuneInputSection(title = stringResource(R.string.editorp_fortune_gender_section), error = genderError) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        GenderChoice(
                            label = stringResource(R.string.editorp_fortune_gender_male),
                            selected = draftGender == FortuneGenderMale,
                            onClick = { draftGender = FortuneGenderMale },
                            modifier = Modifier.weight(1f),
                        )
                        GenderChoice(
                            label = stringResource(R.string.editorp_fortune_gender_female),
                            selected = draftGender == FortuneGenderFemale,
                            onClick = { draftGender = FortuneGenderFemale },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                FortuneInputSection(title = stringResource(R.string.editorp_fortune_birthdate_section), error = birthDateError) {
                    FortuneSelectorRow(
                        value = if (draftBirthDate.isBlank()) stringResource(R.string.editorp_fortune_birthdate_placeholder) else formatBirthDateDisplay(context, draftBirthDate),
                        placeholderActive = draftBirthDate.isBlank(),
                        error = birthDateError,
                        onClick = { datePickerOpen = true },
                    )
                }

                FortuneInputSection(
                    title = stringResource(R.string.editorp_fortune_birthtime_section),
                    error = birthTimeError,
                    subtitle = stringResource(R.string.editorp_fortune_birthtime_subtitle),
                ) {
                    FortuneBirthTimeDropdown(
                        value = draftBirthTime,
                        error = birthTimeError,
                        onSelect = { draftBirthTime = it },
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Button(
                        onClick = {
                            submitted = true
                            if (
                                draftGender.isNotBlank() &&
                                draftBirthDate.isNotBlank() &&
                                draftBirthTime.isNotBlank()
                            ) {
                                onConfirm(
                                    draftGender.trim(),
                                    draftBirthDate.trim(),
                                    draftBirthTime.trim(),
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                    ) {
                        Icon(Icons.Outlined.Save, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.editorp_fortune_save_button))
                    }
                }
            }
        }
    }

    if (datePickerOpen) {
        val initialMillis = parseBirthDateMillis(draftBirthDate)
        val state = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { datePickerOpen = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        state.selectedDateMillis?.let { millis ->
                            draftBirthDate = formatBirthDateIso(millis)
                        }
                        datePickerOpen = false
                    },
                ) { Text(stringResource(R.string.editorp_fortune_date_confirm)) }
            },
            dismissButton = {},
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ModalDialogTitle(
                    title = stringResource(R.string.editorp_fortune_date_title),
                    onDismiss = { datePickerOpen = false },
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
                DatePicker(state = state)
            }
        }
    }

}

internal const val FortuneGenderMale = "남성"
internal const val FortuneGenderFemale = "여성"
internal const val FortuneBirthTimeUnknown = "시간 모름"

// 태어난 시간 구간 — 사주 시진 경계(한국 표준시 +30분 보정) 그대로. 저장값이 곧
// 백엔드 프롬프트로 전달되므로 로케일 번역 없이 숫자 구간 문자열을 쓴다.
internal val FortuneBirthTimeChoices: List<String> = listOf(
    "00:00~01:30",
    "01:31~03:30",
    "03:31~05:30",
    "05:31~07:30",
    "07:31~09:30",
    "09:31~11:30",
    "11:31~13:30",
    "13:31~15:30",
    "15:31~17:30",
    "17:31~19:30",
    "19:31~21:30",
    "21:31~23:30",
    "23:31~24:00",
)

// 태어난 시간 드롭다운 — 맨 위 '시간 모름' 다음에 시간 구간 목록.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FortuneBirthTimeDropdown(
    value: String,
    error: Boolean,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val unknownLabel = stringResource(R.string.editor2_fortune_time_unknown)
    val display = when {
        value.isBlank() -> stringResource(R.string.editorp_fortune_birthtime_placeholder)
        value == FortuneBirthTimeUnknown -> unknownLabel
        else -> value
    }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = display,
            onValueChange = {},
            readOnly = true,
            singleLine = true,
            isError = error,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DropdownMenuItem(
                text = { Text(unknownLabel) },
                onClick = {
                    onSelect(FortuneBirthTimeUnknown)
                    expanded = false
                },
            )
            FortuneBirthTimeChoices.forEach { range ->
                DropdownMenuItem(
                    text = { Text(range) },
                    onClick = {
                        onSelect(range)
                        expanded = false
                    },
                )
            }
        }
    }
}

internal fun normalizeFortuneGender(value: String): String =
    when (value.trim()) {
        "남", "남자", "M", "male", "Male", "MALE", FortuneGenderMale -> FortuneGenderMale
        "여", "여자", "F", "female", "Female", "FEMALE", FortuneGenderFemale -> FortuneGenderFemale
        else -> ""
    }

internal fun normalizeFortuneBirthDate(value: String): String {
    val trimmed = value.trim()
    if (trimmed.isBlank()) return ""
    val digits = trimmed.filter { it.isDigit() }
    return if (digits.length == 8) {
        "${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}"
    } else {
        trimmed
    }
}

internal fun normalizeFortuneBirthTime(value: String): String {
    val trimmed = value.trim()
    if (trimmed.isBlank()) return ""
    if (trimmed == FortuneBirthTimeUnknown || trimmed == "모름" || trimmed == "알 수 없음") {
        return FortuneBirthTimeUnknown
    }
    val digits = trimmed.filter { it.isDigit() }
    return when (digits.length) {
        4 -> "${digits.substring(0, 2)}:${digits.substring(2, 4)}"
        3 -> "0${digits.substring(0, 1)}:${digits.substring(1, 3)}"
        else -> trimmed
    }
}

internal fun parseBirthDateMillis(value: String): Long? {
    val digits = value.filter { it.isDigit() }
    if (digits.length != 8) return null
    val year = digits.substring(0, 4).toIntOrNull() ?: return null
    val month = digits.substring(4, 6).toIntOrNull() ?: return null
    val day = digits.substring(6, 8).toIntOrNull() ?: return null
    val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        clear()
        set(year, month - 1, day)
    }
    return calendar.timeInMillis
}

internal fun formatBirthDateIso(millis: Long): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(java.util.Date(millis))
}

internal fun formatBirthDateDisplay(context: android.content.Context, value: String): String {
    val digits = value.filter { it.isDigit() }
    if (digits.length != 8) return value
    return context.getString(
        R.string.editor2_birthdate_display,
        digits.substring(0, 4),
        digits.substring(4, 6).trimStart('0'),
        digits.substring(6, 8).trimStart('0'),
    )
}

@Composable
internal fun FortuneInputSection(
    title: String,
    error: Boolean,
    subtitle: String? = null,
    content: @Composable () -> Unit,
) {
    val borderColor = if (error) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = if (error) stringResource(R.string.editorp_fortune_required_suffix, title) else title,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            content()
        }
    }
}

@Composable
internal fun FortuneSelectorRow(
    value: String,
    placeholderActive: Boolean,
    error: Boolean,
    onClick: () -> Unit,
) {
    val borderColor = when {
        error -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.outline
    }
    Surface(
        onClick = onClick,
        shape = WakerInputShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.bodyLarge,
                color = if (placeholderActive) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun GenderChoice(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = WakerChipShape,
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        border = BorderStroke(
            width = if (selected) 1.5.dp else 1.dp,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        ),
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
                fontWeight = FontWeight.SemiBold,
                color = if (selected) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
        }
    }
}

internal fun weatherLocationSummary(context: android.content.Context, country: String, city: String): String =
    listOf(country, city)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" ")
        .ifBlank { context.getString(R.string.editor2_weather_location_prompt) }

internal fun fortuneInfoSummary(context: android.content.Context, gender: String, birthDate: String, birthTime: String): String =
    listOf(gender, birthDate, birthTime)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" · ")
        .ifBlank { context.getString(R.string.editor2_fortune_info_prompt) }

