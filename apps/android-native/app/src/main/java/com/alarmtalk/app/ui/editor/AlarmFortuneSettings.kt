package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.Icons
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
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
                    // 달력을 따로 띄우지 않고 **이 모달에서 바로** 연·월·일을 고른다. 생년월일은
                    // 수십 년 전으로 스크롤해야 해서 달력이 오히려 느리고, 모달을 하나 더 여는
                    // 만큼 흐름도 끊긴다. 아래 태어난 시간과 같은 드롭다운 문법이라 나란히 읽힌다.
                    FortuneBirthDatePickers(
                        value = draftBirthDate,
                        error = birthDateError,
                        onChange = { draftBirthDate = it },
                    )
                }

                FortuneInputSection(
                    title = stringResource(R.string.editorp_fortune_birthtime_section),
                    error = birthTimeError,
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
                        Text(stringResource(R.string.editorp_fortune_save_button))
                    }
                }
            }
        }
    }
}

/**
 * 생년월일을 연·월·일 드롭다운 셋으로 받는다. 값은 기존과 같은 `yyyy-MM-dd` 문자열이라
 * 저장·전송 형식은 그대로다.
 *
 * 일(日) 목록은 고른 연·월의 **실제 말일까지만** 만든다 — 2월 30일 같은 값이 애초에
 * 선택지에 없다. 이미 31일을 고른 상태에서 2월로 바꾸면 그 달 말일로 당긴다(빈 값으로
 * 되돌리면 사용자가 다시 골라야 한다).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FortuneBirthDatePickers(
    value: String,
    error: Boolean,
    onChange: (String) -> Unit,
) {
    // **고르는 중인 값은 여기 남는다.** 부모는 완성된 날짜만 들고 있어서, 연도만 고른
    // 상태를 표현할 방법이 없다 — 아래 emit 이 미완성일 때 "" 를 내보내므로 부모에만
    // 기대면 연도·월 선택이 그대로 버려지고 셋을 다 고를 방법이 없어진다.
    // value 가 바뀔 때(= 날짜가 완성됐거나 밖에서 갈아끼웠을 때)만 다시 읽는다.
    val digits = value.filter { it.isDigit() }
    var year by remember(value) { mutableStateOf(digits.take(4).toIntOrNull()) }
    var month by remember(value) { mutableStateOf(digits.drop(4).take(2).toIntOrNull()) }
    var day by remember(value) { mutableStateOf(digits.drop(6).take(2).toIntOrNull()) }

    // 올해부터 120년 전까지 — 생년월일에 미래는 없다.
    val thisYear = Calendar.getInstance().get(Calendar.YEAR)
    val years = (thisYear downTo thisYear - 120).toList()
    val months = (1..12).toList()
    val daysInMonth = daysInMonth(year, month)
    val days = (1..daysInMonth).toList()

    fun emit(y: Int?, m: Int?, d: Int?) {
        // 월이 짧아지면 이미 고른 일자를 그 달 말일로 당긴다(2/31 은 선택지에 없다).
        val clamped = if (y != null && m != null) d?.coerceAtMost(daysInMonth(y, m)) else d
        year = y
        month = m
        day = clamped
        // 셋이 다 있을 때만 완성된 날짜를 올려보낸다. 미완성은 "" — 저장 시 필수값
        // 검사에 걸려야 하고, 반쯤 만든 날짜가 알람에 저장돼선 안 된다.
        if (y == null || m == null || clamped == null) {
            onChange("")
            return
        }
        onChange("%04d-%02d-%02d".format(y, m, clamped))
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FortuneUnitDropdown(
            selected = year,
            options = years,
            placeholder = stringResource(R.string.editorp_fortune_birthdate_year),
            suffix = stringResource(R.string.editorp_fortune_unit_year),
            error = error,
            modifier = Modifier.weight(1.2f),
            onSelect = { emit(it, month, day) },
        )
        FortuneUnitDropdown(
            selected = month,
            options = months,
            placeholder = stringResource(R.string.editorp_fortune_birthdate_month),
            suffix = stringResource(R.string.editorp_fortune_unit_month),
            error = error,
            modifier = Modifier.weight(1f),
            onSelect = { emit(year, it, day) },
        )
        FortuneUnitDropdown(
            selected = day,
            options = days,
            placeholder = stringResource(R.string.editorp_fortune_birthdate_day),
            suffix = stringResource(R.string.editorp_fortune_unit_day),
            error = error,
            // 연·월을 먼저 골라야 말일을 알 수 있다.
            enabled = year != null && month != null,
            modifier = Modifier.weight(1f),
            onSelect = { emit(year, month, it) },
        )
    }
}

/** 윤년까지 반영한 그 달의 말일. 연·월을 아직 안 골랐으면 31 로 둔다. */
private fun daysInMonth(year: Int?, month: Int?): Int {
    if (year == null || month == null) return 31
    return Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        clear()
        set(year, month - 1, 1)
    }.getActualMaximum(Calendar.DAY_OF_MONTH)
}

/** 드롭다운이 화면을 다 덮지 않게 하는 상한. 이 아래는 메뉴 안에서 스크롤한다. */
private val MenuMaxHeight = 288.dp

/** DropdownMenuItem 기본 높이(M3). 스크롤 위치 계산에 쓴다. */
private val MenuItemHeight = 48.dp

/** 고른 값을 눈에 띄게 — 목록에서 지금 뭐가 선택돼 있는지 보이지 않으면 매번 다시 읽어야 한다. */
@Composable
private fun MenuChoice(label: String, selected: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = {
            Text(
                text = label,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            )
        },
        colors = MenuDefaults.itemColors(
            textColor = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        ),
        onClick = onClick,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FortuneUnitDropdown(
    selected: Int?,
    options: List<Int>,
    placeholder: String,
    suffix: String,
    error: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onSelect: (Int) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val menuItemHeightPx = with(LocalDensity.current) { MenuItemHeight.roundToPx() }
    ExposedDropdownMenuBox(
        expanded = expanded && enabled,
        onExpandedChange = { if (enabled) expanded = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = selected?.let { "$it$suffix" } ?: placeholder,
            onValueChange = {},
            readOnly = true,
            singleLine = true,
            enabled = enabled,
            isError = error,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded && enabled) },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        val scrollState = rememberScrollState()
        // 연도는 100개가 넘는다. 열 때마다 맨 위(올해)에서 시작하면 1990년생은 매번
        // 서른여섯 번을 긁어 내려야 한다 — 이미 고른 값이 보이는 위치에서 연다.
        LaunchedEffect(expanded, selected) {
            if (!expanded) return@LaunchedEffect
            val index = options.indexOf(selected)
            if (index >= 0) scrollState.scrollTo(index * menuItemHeightPx)
        }
        ExposedDropdownMenu(
            expanded = expanded && enabled,
            onDismissRequest = { expanded = false },
            scrollState = scrollState,
            modifier = Modifier.heightIn(max = MenuMaxHeight),
        ) {
            options.forEach { option ->
                val isSelected = option == selected
                DropdownMenuItem(
                    text = {
                        Text(
                            text = "$option$suffix",
                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        )
                    },
                    colors = MenuDefaults.itemColors(
                        textColor = if (isSelected) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                    ),
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                )
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
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.heightIn(max = MenuMaxHeight),
        ) {
            MenuChoice(
                label = unknownLabel,
                selected = value == FortuneBirthTimeUnknown,
                onClick = {
                    onSelect(FortuneBirthTimeUnknown)
                    expanded = false
                },
            )
            FortuneBirthTimeChoices.forEach { range ->
                MenuChoice(
                    label = range,
                    selected = value == range,
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

// 섹션별 테두리 상자는 제거 — 내부 컨트롤(성별 칩·날짜 선택 행·시간 드롭다운)에 이미
// 테두리가 있어 이중 테두리 시각 소음이었다. 라벨+컨트롤만 남기고 오류는 라벨 색·필수
// 문구로 표시한다.
@Composable
internal fun FortuneInputSection(
    title: String,
    error: Boolean,
    subtitle: String? = null,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
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

