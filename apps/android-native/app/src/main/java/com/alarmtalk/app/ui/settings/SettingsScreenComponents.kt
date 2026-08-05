package com.alarmtalk.app

import android.content.Context
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.util.Locale
import com.alarmtalk.app.network.FamilyAlarmQuietWindow

// 더보기(MenuTabPanel) 패널과 같은 시각 규격: 제목을 카드 '안'에 넣은 패널 카드 +
// 텍스트/값/셰브론 행(높이 52·수평 12). 화면마다 카드/행 간격이 달라 보이던 문제의 단일 출처.
@Composable
internal fun SettingsCard(
    title: String?,
    content: @Composable () -> Unit,
) {
    Surface(
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            if (title != null) {
                Text(
                    text = title,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            content()
        }
    }
}

@Composable
internal fun SettingsRow(
    label: String,
    value: String?,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 라벨은 제 너비를 그대로 갖고, **남는 폭을 값이 가져간다.** 반대로(라벨에 weight)
        // 두면 값이 길 때 라벨이 밀려 "운세 / 정보" 처럼 두 줄로 접혔다 — 접혀야 할 쪽은
        // 항상 값이다. 값이 없는 행(로그아웃 등)은 Spacer 가 그 자리를 대신 채워
        // 오른쪽 셰브론이 늘 같은 자리에 온다.
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
        )
        if (value != null) {
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
                textAlign = TextAlign.End,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        Icon(
            imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// 날씨 지역 다이얼로그는 편집기 문구 pane 의 WeatherLocationDialog(AlarmRandomPromptSettings.kt)
// 를 공유한다 — 설정 전용 사본(저장 아이콘 포함)은 중복이라 제거했다.

// 지역 선택 UI 는 WeatherLocationDialog(AlarmRandomPromptSettings.kt)의 바텀시트로 통합 —
// 이전 칩 그리드/드롭다운 구현은 제거했다.

// 방해금지 요일 프리셋(평일/주말/매일) — 백엔드 family-alarm-settings.ts PRESET_QUIET_DAY_SETS와 동일.
private data class QuietDayPreset(val days: Set<Int>, val labelRes: Int)

private val QUIET_DAY_PRESETS = listOf(
    QuietDayPreset(setOf(1, 2, 3, 4, 5), R.string.editor2_quiet_days_weekdays),
    QuietDayPreset(setOf(0, 6), R.string.editor2_quiet_days_weekend),
    QuietDayPreset(setOf(0, 1, 2, 3, 4, 5, 6), R.string.editor2_quiet_days_everyday),
)

// 방해금지 창 최대 개수. 백엔드 MAX_QUIET_WINDOWS(=2) 및 AuthSessionStore와 동일.
private const val QUIET_WINDOW_MAX = 2

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
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
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
                            onSelectDays = { presetDays ->
                                updateDraft(draftIndex) { it.copy(days = presetDays) }
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
                            if (drafts.size < QUIET_WINDOW_MAX) {
                                drafts = drafts + FamilyAlarmQuietWindow(
                                    days = listOf(1, 2, 3, 4, 5),
                                    start = "22:00",
                                    end = "07:00",
                                ).toDraft()
                            }
                        },
                        enabled = drafts.size < QUIET_WINDOW_MAX,
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
                tonalElevation = 0.dp,
                shadowElevation = 18.dp,
                border = wakerCardBorder(),
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
    onSelectDays: (Set<Int>) -> Unit,
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
            // 여러 구간일 때만 '구간 N' 헤더+삭제를 보여준다(단일 구간은 헤더 없이 깔끔하게).
            if (removable) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.hs_quiet_window_index, index + 1),
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = onRemove) {
                        Icon(Icons.Outlined.Delete, contentDescription = stringResource(R.string.hs_quiet_window_delete))
                    }
                }
            }
            // 요일은 평일/주말/매일 프리셋 3택(단일 선택). 세밀한 개별 요일 지정은 없앰 — 방해금지의
            // 실사용은 근무/등교 시간대 정도라 프리셋으로 충분하고 시트 라벨도 짧게 유지된다.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                QUIET_DAY_PRESETS.forEach { preset ->
                    FilterChip(
                        selected = draft.days == preset.days,
                        onClick = { onSelectDays(preset.days) },
                        label = {
                            Box(
                                modifier = Modifier.fillMaxWidth(),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(text = stringResource(preset.labelRes), fontWeight = FontWeight.SemiBold)
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
    val value = listOf(gender, compactBirthDate(birthDate), birthTime)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" · ")
    return value.ifBlank { context.getString(R.string.misc2_settings_not_set) }
}

/**
 * 설정 행에 쓰는 짧은 생년월일 — `2000-05-17` → `000517`.
 *
 * 행 하나에 성별·생년월일·태어난 시간이 다 들어가는데 `2000-05-17` 그대로면 폭을 다 먹는다.
 * 여섯 자리는 주민번호 앞자리와 같은 모양이라 한국어 사용자는 바로 읽고, 정확한 값은
 * 눌러서 여는 다이얼로그에 그대로 있다. **형식이 다르면 손대지 않는다.**
 */
private fun compactBirthDate(raw: String): String {
    val trimmed = raw.trim()
    val looksLikeIsoDate = trimmed.length == 10 && trimmed[4] == '-' && trimmed[7] == '-' &&
        trimmed.filter { it != '-' }.all { it.isDigit() }
    return if (looksLikeIsoDate) trimmed.substring(2).replace("-", "") else trimmed
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

internal fun isHourText(value: String): Boolean =
    value.toIntOrNull()?.let { it in 0..23 } == true

internal fun isMinuteText(value: String): Boolean =
    value.toIntOrNull()?.let { it in 0..59 } == true
