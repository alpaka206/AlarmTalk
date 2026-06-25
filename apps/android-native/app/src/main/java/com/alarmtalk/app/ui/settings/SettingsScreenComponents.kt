package com.alarmtalk.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.util.Locale
import com.alarmtalk.app.network.FamilyAlarmQuietWindow

@Composable
internal fun SettingsCard(
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
internal fun SettingsRow(
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
internal fun SettingsToggleRow(
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
        AlarmTalkSwitch(
            checked = checked,
            onCheckedChange = onCheckedChange,
        )
    }
}

@Composable
internal fun WeatherLocationPreferenceDialog(
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

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .widthIn(max = 430.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                ModalDialogTitle(stringResource(R.string.hs_weather_dialog_title), onDismiss = onDismiss)
                Surface(
                    shape = WakerPanelShape,
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.34f),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = stringResource(R.string.hs_weather_base_region_title),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                        Text(
                            text = stringResource(R.string.hs_weather_base_region_desc),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = draftCountry,
                        onValueChange = { draftCountry = it.take(30) },
                        label = { Text(stringResource(R.string.hs_weather_country_label)) },
                        placeholder = { Text(stringResource(R.string.hs_weather_country_placeholder)) },
                        singleLine = true,
                        isError = countryError,
                        supportingText = {
                            if (countryError) Text(stringResource(R.string.hs_weather_field_required))
                        },
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = draftCity,
                        onValueChange = { draftCity = it.take(30) },
                        label = { Text(stringResource(R.string.hs_weather_city_label)) },
                        placeholder = { Text(stringResource(R.string.hs_weather_city_placeholder)) },
                        singleLine = true,
                        isError = cityError,
                        supportingText = {
                            if (cityError) Text(stringResource(R.string.hs_weather_field_required))
                        },
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = {
                        submitted = true
                        if (draftCountry.isNotBlank() && draftCity.isNotBlank()) {
                            onConfirm(draftCountry.trim(), draftCity.trim())
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(stringResource(R.string.hs_save))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FamilyAlarmQuietTimeDialog(
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
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            shadowElevation = 18.dp,
        ) {
            Column(
                modifier = Modifier
                    .padding(horizontal = 22.dp, vertical = 22.dp)
                    .heightIn(max = 620.dp),
            ) {
                ModalDialogTitle(
                    title = stringResource(R.string.hs_quiet_time_dialog_title),
                    onDismiss = onDismiss,
                )
                Text(
                    text = stringResource(R.string.hs_quiet_time_dialog_desc),
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
                        Text(stringResource(R.string.hs_quiet_time_add))
                    }
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 18.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Button(
                        onClick = { onConfirm(drafts.map { it.toWindow() }) },
                        enabled = valid,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                    ) {
                        Text(stringResource(R.string.hs_save))
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
                shape = WakerHeroShape,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
                shadowElevation = 18.dp,
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ModalDialogTitle(
                        title = if (target.isStart) stringResource(R.string.hs_quiet_time_start) else stringResource(R.string.hs_quiet_time_end),
                        onDismiss = { timePickerTarget = null },
                    )
                    TimePicker(state = state)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    ) {
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
                        ) { Text(stringResource(R.string.hs_quiet_time_confirm)) }
                    }
                }
            }
        }
    }
}

internal data class QuietTimePickerTarget(val index: Int, val isStart: Boolean)

@Composable
internal fun QuietWindowCard(
    index: Int,
    draft: QuietWindowDraft,
    removable: Boolean,
    onToggleDay: (Int) -> Unit,
    onPickStart: () -> Unit,
    onPickEnd: () -> Unit,
    onRemove: () -> Unit,
) {
    val context = LocalContext.current
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
                    text = stringResource(R.string.hs_quiet_window_index, index + 1),
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (removable) {
                    IconButton(onClick = onRemove) {
                        Icon(Icons.Outlined.Delete, contentDescription = stringResource(R.string.hs_quiet_window_delete))
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                dayLabels(context).forEachIndexed { dayIndex, label ->
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
internal fun QuietTimeChip(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = WakerChipShape,
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

internal fun quietTimeLabel(hour: String, minute: String): String {
    val h = hour.toIntOrNull() ?: 0
    val m = minute.toIntOrNull() ?: 0
    return String.format(Locale.US, "%d:%02d", h, m)
}

internal data class QuietWindowDraft(
    val days: Set<Int>,
    val startHour: String,
    val startMinute: String,
    val endHour: String,
    val endMinute: String,
)

internal fun FamilyAlarmQuietWindow.toDraft(): QuietWindowDraft {
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

internal fun QuietWindowDraft.toWindow(): FamilyAlarmQuietWindow =
    FamilyAlarmQuietWindow(
        days = days.sorted(),
        start = "${twoDigit(startHour)}:${twoDigit(startMinute)}",
        end = "${twoDigit(endHour)}:${twoDigit(endMinute)}",
    )

internal fun QuietWindowDraft.isValid(): Boolean =
    days.isNotEmpty() &&
        isHourText(startHour) &&
        isMinuteText(startMinute) &&
        isHourText(endHour) &&
        isMinuteText(endMinute)

internal fun splitTime(value: String): Pair<String, String> {
    val parts = value.split(":")
    return (parts.getOrNull(0)?.takeIf { isHourText(it) } ?: "09") to
        (parts.getOrNull(1)?.takeIf { isMinuteText(it) } ?: "00")
}

internal fun twoDigit(value: String): String =
    value.toIntOrNull()?.coerceIn(0, 99)?.toString()?.padStart(2, '0') ?: "00"

internal fun quietScheduleLabel(context: Context, windows: List<FamilyAlarmQuietWindow>): String {
    if (windows.isEmpty()) return context.getString(R.string.misc2_quiet_none)
    val visible = windows.take(2).joinToString(" · ") { quietWindowLabel(context, it) }
    val hidden = windows.size - 2
    return if (hidden > 0) context.getString(R.string.misc2_quiet_more, visible, hidden) else visible
}

internal fun weatherLocationSettingsLabel(context: Context, country: String, city: String): String {
    val value = listOf(country, city)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" ")
    return value.ifBlank { context.getString(R.string.misc2_settings_not_set) }
}

internal fun fortuneInfoSettingsLabel(
    context: Context,
    gender: String,
    birthDate: String,
    birthTime: String,
): String {
    val value = listOf(gender, birthDate, birthTime)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" · ")
    return value.ifBlank { context.getString(R.string.misc2_settings_not_set) }
}

internal fun quietWindowLabel(context: Context, window: FamilyAlarmQuietWindow): String =
    "${quietDaysLabel(context, window.days)} ${formatQuietTime(window.start)} ~ ${formatQuietTime(window.end)}"

internal fun formatQuietTime(value: String): String {
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull() ?: return value
    val minute = parts.getOrNull(1)?.toIntOrNull() ?: return value
    return String.format(Locale.US, "%d:%02d", hour, minute)
}

internal fun quietDaysLabel(context: Context, days: List<Int>): String {
    val sorted = days.distinct().sorted()
    return when (sorted) {
        emptyList<Int>() -> context.getString(R.string.misc2_quiet_none)
        listOf(1, 2, 3, 4, 5) -> context.getString(R.string.misc2_days_weekday)
        listOf(0, 6) -> context.getString(R.string.misc2_days_weekend)
        listOf(0, 1, 2, 3, 4, 5, 6) -> context.getString(R.string.misc2_days_everyday)
        else -> sorted.joinToString(",") { dayLabels(context)[it] }
    }
}

internal fun dayLabels(context: Context): List<String> = listOf(
    context.getString(R.string.misc2_day_sun),
    context.getString(R.string.misc2_day_mon),
    context.getString(R.string.misc2_day_tue),
    context.getString(R.string.misc2_day_wed),
    context.getString(R.string.misc2_day_thu),
    context.getString(R.string.misc2_day_fri),
    context.getString(R.string.misc2_day_sat),
)

internal fun Context.openExternalUrl(url: String) {
    runCatching {
        startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

internal fun isHourText(value: String): Boolean =
    value.toIntOrNull()?.let { it in 0..23 } == true

internal fun isMinuteText(value: String): Boolean =
    value.toIntOrNull()?.let { it in 0..59 } == true
