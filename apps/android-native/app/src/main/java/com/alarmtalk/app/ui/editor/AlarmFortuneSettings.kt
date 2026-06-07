package com.alarmtalk.app

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatternLibrary
import com.alarmtalk.app.data.VibrationPatterns

@Composable
internal fun FortuneInfoDialog(
    gender: String,
    birthDate: String,
    birthTime: String,
    description: String = "운세가 들어간 문구를 만들 때만 사용해요. 저장하지 않으면 랜덤 문구가 꺼져요.",
    onDismissWithoutSave: () -> Unit,
    onConfirm: (String, String, String) -> Unit,
) {
    var draftGender by remember(gender) { mutableStateOf(normalizeFortuneGender(gender)) }
    var draftBirthDate by remember(birthDate) { mutableStateOf(normalizeFortuneBirthDate(birthDate)) }
    var draftBirthTime by remember(birthTime) { mutableStateOf(normalizeFortuneBirthTime(birthTime)) }
    var submitted by remember { mutableStateOf(false) }
    var datePickerOpen by remember { mutableStateOf(false) }
    var timePickerOpen by remember { mutableStateOf(false) }
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
            shape = WakerCardShape,
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
                    title = "운세 정보",
                    onDismiss = onDismissWithoutSave,
                )
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.45f),
                    border = wakerCardBorder(),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = "운세 문구에만 사용해요",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                        Text(
                            text = description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.78f),
                        )
                    }
                }
                FortuneInputSection(title = "성별", error = genderError) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        GenderChoice(
                            label = "남성",
                            selected = draftGender == FortuneGenderMale,
                            onClick = { draftGender = FortuneGenderMale },
                            modifier = Modifier.weight(1f),
                        )
                        GenderChoice(
                            label = "여성",
                            selected = draftGender == FortuneGenderFemale,
                            onClick = { draftGender = FortuneGenderFemale },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                FortuneInputSection(title = "생년월일", error = birthDateError) {
                    FortuneSelectorRow(
                        value = if (draftBirthDate.isBlank()) "탭하여 생년월일 선택" else formatBirthDateDisplay(draftBirthDate),
                        placeholderActive = draftBirthDate.isBlank(),
                        error = birthDateError,
                        onClick = { datePickerOpen = true },
                    )
                }

                FortuneInputSection(
                    title = "태어난 시간",
                    error = birthTimeError,
                    subtitle = "정확히 모르면 가까운 시간대를 골라도 돼요.",
                ) {
                    FortuneTimeChoiceGrid(
                        selectedValue = draftBirthTime,
                        onSelect = { draftBirthTime = it },
                    )
                    val exactTimePlaceholder = draftBirthTime.isBlank() ||
                        draftBirthTime == FortuneBirthTimeUnknown
                    FortuneSelectorRow(
                        value = if (exactTimePlaceholder) {
                            "정확한 시간 선택"
                        } else {
                            formatBirthTimeDisplay(draftBirthTime)
                        },
                        placeholderActive = exactTimePlaceholder,
                        error = birthTimeError && draftBirthTime.isBlank(),
                        onClick = { timePickerOpen = true },
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
                        Text("저장")
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
                ) { Text("확인") }
            },
            dismissButton = {},
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ModalDialogTitle(
                    title = "생년월일",
                    onDismiss = { datePickerOpen = false },
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
                DatePicker(state = state)
            }
        }
    }

    if (timePickerOpen) {
        val (hourInit, minuteInit) = parseBirthTimeParts(draftBirthTime)
        val state = rememberTimePickerState(
            initialHour = hourInit,
            initialMinute = minuteInit,
            is24Hour = true,
        )
        Dialog(onDismissRequest = { timePickerOpen = false }) {
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
                    ModalDialogTitle(
                        title = "태어난 시간",
                        onDismiss = { timePickerOpen = false },
                    )
                    TimePicker(state = state)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    ) {
                        TextButton(
                            onClick = {
                                draftBirthTime = String.format(
                                    Locale.US,
                                    "%02d:%02d",
                                    state.hour,
                                    state.minute,
                                )
                                timePickerOpen = false
                            },
                        ) { Text("확인") }
                    }
                }
            }
        }
    }
}

private const val FortuneGenderMale = "남성"
private const val FortuneGenderFemale = "여성"
private const val FortuneBirthTimeUnknown = "시간 모름"

internal val FortuneBirthTimeChoices = listOf(
    FortuneBirthTimeUnknown to "시간 모름",
    "05:00" to "새벽",
    "09:00" to "오전",
    "15:00" to "오후",
    "20:00" to "저녁",
)

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

internal fun parseBirthTimeParts(value: String): Pair<Int, Int> {
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull()?.coerceIn(0, 23) ?: 9
    val minute = parts.getOrNull(1)?.toIntOrNull()?.coerceIn(0, 59) ?: 0
    return hour to minute
}

internal fun formatBirthDateIso(millis: Long): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(java.util.Date(millis))
}

internal fun formatBirthDateDisplay(value: String): String {
    val digits = value.filter { it.isDigit() }
    if (digits.length != 8) return value
    return "${digits.substring(0, 4)}년 ${digits.substring(4, 6).trimStart('0')}월 ${digits.substring(6, 8).trimStart('0')}일"
}

internal fun formatBirthTimeDisplay(value: String): String {
    if (value == FortuneBirthTimeUnknown) return value
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull() ?: return value
    val minute = parts.getOrNull(1)?.toIntOrNull() ?: return value
    val suffix = if (hour < 12) "오전" else "오후"
    val display = if (hour == 0) 12 else if (hour > 12) hour - 12 else hour
    return "$suffix ${display}시 ${String.format(Locale.US, "%02d", minute)}분"
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
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = if (error) "$title · 필수 입력" else title,
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
internal fun FortuneTimeChoiceGrid(
    selectedValue: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FortuneTimeChoice(
                label = FortuneBirthTimeChoices[0].second,
                value = FortuneBirthTimeChoices[0].first,
                selected = selectedValue == FortuneBirthTimeChoices[0].first,
                onClick = onSelect,
                modifier = Modifier.weight(1f),
            )
            FortuneTimeChoice(
                label = FortuneBirthTimeChoices[1].second,
                value = FortuneBirthTimeChoices[1].first,
                selected = selectedValue == FortuneBirthTimeChoices[1].first,
                onClick = onSelect,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FortuneBirthTimeChoices.drop(2).forEach { (value, label) ->
                FortuneTimeChoice(
                    label = label,
                    value = value,
                    selected = selectedValue == value,
                    onClick = onSelect,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
internal fun FortuneTimeChoice(
    label: String,
    value: String,
    selected: Boolean,
    onClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = { onClick(value) },
        shape = RoundedCornerShape(14.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        border = BorderStroke(
            width = if (selected) 1.5.dp else 1.dp,
            color = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)
            },
        ),
        modifier = modifier,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            color = if (selected) {
                MaterialTheme.colorScheme.onPrimaryContainer
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 11.dp),
        )
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
        shape = RoundedCornerShape(14.dp),
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

internal fun weatherLocationSummary(country: String, city: String): String =
    listOf(country, city)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" ")
        .ifBlank { "나라와 도시를 입력해 주세요." }

internal fun fortuneInfoSummary(gender: String, birthDate: String, birthTime: String): String =
    listOf(gender, birthDate, birthTime)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" · ")
        .ifBlank { "성별, 생년월일, 태어난 시간을 입력해 주세요." }

@Composable
internal fun VoiceTranslationSettingsPane(
    voiceLanguage: String,
    onDismiss: () -> Unit,
    onLanguageChange: (String) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "번역 언어",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SnoozeOptionSection(title = "언어") {
                    TtsTranslationLanguages.forEachIndexed { index, (language, label) ->
                        SnoozeRadioRow(
                            label = label,
                            selected = voiceLanguage == language,
                            onClick = { onLanguageChange(language) },
                        )
                        if (index != TtsTranslationLanguages.lastIndex) SnoozeOptionDivider()
                    }
                }
            }
        }
    }
}

internal fun previewVibration(context: Context, patternName: String) {
    if (patternName == VibrationPatterns.NONE) return
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    } ?: return
    val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    vibrator.cancel()
    @Suppress("DEPRECATION")
    vibrator.vibrate(VibrationEffect.createWaveform(VibrationPatternLibrary.waveform(patternName), -1), attributes)
}

@Composable
internal fun AlarmSettingRow(
    title: String,
    subtitle: String,
    icon: ImageVector,
    onClick: () -> Unit,
    trailing: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(38.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.72f),
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(end = 12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            MutedText(subtitle)
        }
        trailing()
        Spacer(Modifier.width(6.dp))
        Icon(
            imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
internal fun AlarmSettingDivider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
internal fun SnoozeSettingsPane(
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    snoozeRepeatLimit: Int,
    onDismiss: () -> Unit,
    onSnoozeEnabledChange: (Boolean) -> Unit,
    onSnoozeMinutesChange: (Int) -> Unit,
    onSnoozeRepeatLimitChange: (Int) -> Unit,
) {
    var customIntervalDialogOpen by remember { mutableStateOf(false) }
    var customMinutesText by remember(snoozeMinutes) { mutableStateOf(snoozeMinutes.toString()) }
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "다시 울림",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = if (snoozeEnabled) "사용 중" else "사용 안 함",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (snoozeEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        VoiceAlarmSwitch(
                            checked = snoozeEnabled,
                            onCheckedChange = onSnoozeEnabledChange,
                        )
                    }
                }

                SnoozeOptionSection(title = "간격") {
                    SnoozeIntervals.forEachIndexed { index, minutes ->
                        SnoozeRadioRow(
                            label = "${minutes}분",
                            selected = snoozeMinutes == minutes,
                            onClick = { onSnoozeMinutesChange(minutes) },
                        )
                        if (index != SnoozeIntervals.lastIndex) SnoozeOptionDivider()
                    }
                    SnoozeOptionDivider()
                    SnoozeRadioRow(
                        label = if (snoozeMinutes in SnoozeIntervals) {
                            "직접 설정"
                        } else {
                            "직접 설정 · ${snoozeMinutes}분"
                        },
                        selected = snoozeMinutes !in SnoozeIntervals,
                        onClick = {
                            customMinutesText = snoozeMinutes.toString()
                            customIntervalDialogOpen = true
                        },
                    )
                }

                SnoozeOptionSection(title = "반복") {
                    val repeatOptions = listOf(
                        SnoozeRepeatLimits.THREE to "3회",
                        SnoozeRepeatLimits.FIVE to "5회",
                        SnoozeRepeatLimits.FOREVER to "계속 반복",
                    )
                    repeatOptions.forEachIndexed { index, (limit, label) ->
                        SnoozeRadioRow(
                            label = label,
                            selected = snoozeRepeatLimit == limit,
                            onClick = { onSnoozeRepeatLimitChange(limit) },
                        )
                        if (index != repeatOptions.lastIndex) SnoozeOptionDivider()
                    }
                }
            }
        }
    }

    if (customIntervalDialogOpen) {
        val customMinutes = customMinutesText.toIntOrNull()
        AlertDialog(
            onDismissRequest = { customIntervalDialogOpen = false },
            title = {
                ModalDialogTitle(
                    title = "간격 직접 설정",
                    onDismiss = { customIntervalDialogOpen = false },
                )
            },
            text = {
                OutlinedTextField(
                    value = customMinutesText,
                    onValueChange = { value ->
                        customMinutesText = value.filter { it.isDigit() }.take(2)
                    },
                    label = { Text("분") },
                    singleLine = true,
                    isError = customMinutesText.isNotBlank() && customMinutes !in 1..60,
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                )
            },
            confirmButton = {
                TextButton(
                    enabled = customMinutes in 1..60,
                    onClick = {
                        onSnoozeMinutesChange(requireNotNull(customMinutes))
                        customIntervalDialogOpen = false
                    },
                ) {
                    Text("적용")
                }
            },
        )
    }
}

@Composable
internal fun SnoozeOptionSection(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 4.dp),
        )
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                content()
            }
        }
    }
}

@Composable
internal fun SnoozeRadioRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CompactSelectionDot(
                selected = selected,
            )
            Spacer(Modifier.width(9.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
internal fun CompactSelectionDot(selected: Boolean) {
    Box(
        modifier = Modifier
            .size(18.dp)
            .border(
                width = 1.5.dp,
                color = if (selected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.outline
                },
                shape = CircleShape,
            )
            .background(
                color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                shape = CircleShape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .background(MaterialTheme.colorScheme.onPrimary, CircleShape),
            )
        }
    }
}

@Composable
internal fun SnoozeOptionDivider() {
    Box(
        modifier = Modifier
            .padding(start = 39.dp)
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
internal fun EditorActionButtons(
    isEditing: Boolean,
    isSaving: Boolean,
    canSave: Boolean,
    onSave: () -> Unit,
) {
    Button(
        onClick = onSave,
        enabled = canSave && !isSaving,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerButtonShape,
    ) {
        Icon(Icons.Outlined.Save, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text(
            when {
                isSaving -> "저장 중"
                isEditing -> "변경사항 저장"
                else -> "알람 설정하기"
            },
        )
    }
}
