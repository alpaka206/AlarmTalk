package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.AlarmAudioLimits
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmTimeCalculator
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.R
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@Composable
internal fun ScheduleDetailsCard(
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    holidayOff: Boolean,
    label: String,
    onLabelChange: (String) -> Unit,
    onToggleDay: (Int) -> Unit,
    onHolidayOffChange: (Boolean) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RepeatSelector(
            hour = hour,
            minute = minute,
            repeatDaysMask = repeatDaysMask,
            holidayOff = holidayOff,
            onToggleDay = onToggleDay,
            onHolidayOffChange = onHolidayOffChange,
        )
        OutlinedTextField(
            value = label,
            onValueChange = onLabelChange,
            label = { Text(stringResource(R.string.editor_label_alarm_name)) },
            placeholder = { Text(stringResource(R.string.editor_placeholder_alarm_name)) },
            singleLine = true,
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
internal fun RepeatSelector(
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    holidayOff: Boolean,
    onToggleDay: (Int) -> Unit,
    onHolidayOffChange: (Boolean) -> Unit,
) {
    val holidayEnabled = repeatDaysMask != 0
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            text = repeatSummaryLabel(context, hour, minute, repeatDaysMask),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            WeekdayLabels.forEachIndexed { index, labelRes ->
                DayTextChip(
                    label = stringResource(labelRes),
                    dayIndex = index,
                    selected = repeatDaysMask and (1 shl index) != 0,
                    onClick = { onToggleDay(index) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        // 공휴일에 끄기는 매주 반복(요일 선택) 알람에만 의미가 있으므로,
        // 요일을 하나라도 고른 경우에만 노출한다.
        if (holidayEnabled) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(end = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(stringResource(R.string.editor_holiday_off_title), fontWeight = FontWeight.SemiBold)
                    Text(
                        text = stringResource(R.string.editor_holiday_off_subtitle),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                AlarmTalkSwitch(
                    checked = holidayOff,
                    onCheckedChange = onHolidayOffChange,
                )
            }
        }
    }
}

@Composable
internal fun DayTextChip(
    label: String,
    dayIndex: Int,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val weekendColor = when (dayIndex) {
        0 -> MaterialTheme.colorScheme.error
        6 -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val selectedContainerColor = when (dayIndex) {
        0 -> MaterialTheme.colorScheme.errorContainer
        6 -> MaterialTheme.colorScheme.secondaryContainer
        else -> MaterialTheme.colorScheme.primaryContainer
    }
    val selectedContentColor = when (dayIndex) {
        0 -> MaterialTheme.colorScheme.onErrorContainer
        6 -> MaterialTheme.colorScheme.onSecondaryContainer
        else -> MaterialTheme.colorScheme.onPrimaryContainer
    }
    val selectedBorderColor = when (dayIndex) {
        0 -> MaterialTheme.colorScheme.error
        6 -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.primary
    }
    val contentColor = if (selected) {
        selectedContentColor
    } else {
        weekendColor
    }
    Surface(
        onClick = onClick,
        modifier = modifier.aspectRatio(1f),
        shape = CircleShape,
        color = if (selected) {
            selectedContainerColor
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.46f)
        },
        border = BorderStroke(
            width = 1.dp,
            color = if (selected) {
                selectedBorderColor.copy(alpha = 0.58f)
            } else {
                MaterialTheme.colorScheme.outlineVariant
            },
        ),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                color = contentColor,
            )
        }
    }
}

internal fun repeatSummaryLabel(
    context: android.content.Context,
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    nowMillis: Long = System.currentTimeMillis(),
    zoneId: ZoneId = ZoneId.systemDefault(),
): String {
    if (repeatDaysMask != 0) {
        if (repeatDaysMask == 0b1111111) return context.getString(R.string.editor2_repeat_every_day)
        val selectedDays = WeekdayLabels
            .filterIndexed { index, _ -> repeatDaysMask and (1 shl index) != 0 }
            .joinToString(", ") { context.getString(it) }
        return context.getString(R.string.editor2_repeat_weekly, selectedDays)
    }

    val nextFireAt = AlarmTimeCalculator.nextFireAtMillis(
        hour = hour,
        minute = minute,
        repeatDaysMask = 0,
        nowMillis = nowMillis,
        zoneId = zoneId,
    )
    val today = Instant.ofEpochMilli(nowMillis).atZone(zoneId).toLocalDate()
    val nextDate = Instant.ofEpochMilli(nextFireAt).atZone(zoneId).toLocalDate()
    val dateLabel = koreanDateLabel(context, nextDate)
    return when (nextDate) {
        today -> context.getString(R.string.editor2_repeat_today, dateLabel)
        today.plusDays(1) -> context.getString(R.string.editor2_repeat_tomorrow, dateLabel)
        else -> dateLabel
    }
}

private fun koreanDateLabel(context: android.content.Context, date: LocalDate): String {
    val dayLabel = context.getString(WeekdayLabels[date.dayOfWeek.value % 7])
    return context.getString(R.string.editor2_date_label, date.monthValue, date.dayOfMonth, dayLabel)
}

private val WeekdayLabels: List<Int> = listOf(
    R.string.editor2_weekday_sun,
    R.string.editor2_weekday_mon,
    R.string.editor2_weekday_tue,
    R.string.editor2_weekday_wed,
    R.string.editor2_weekday_thu,
    R.string.editor2_weekday_fri,
    R.string.editor2_weekday_sat,
)

@Composable
internal fun QuickChip(
    label: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun PlayModeCard(
    selected: String,
    onSelect: (String) -> Unit,
    voiceLocked: Boolean = false,
    onLockedVoiceClick: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = stringResource(R.string.editor_play_mode_title),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        PlayModeSelector(
            selected = selected,
            onSelect = onSelect,
            voiceLocked = voiceLocked,
            onLockedVoiceClick = onLockedVoiceClick,
        )
    }
}

@Composable
internal fun PlayModeSelector(
    selected: String,
    onSelect: (String) -> Unit,
    voiceLocked: Boolean = false,
    onLockedVoiceClick: () -> Unit = {},
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PlayModeChip(
            label = stringResource(R.string.editor_play_mode_alarm_voice),
            selected = selected == AlarmPlayModes.ALARM_VOICE,
            locked = voiceLocked,
            onClick = {
                if (voiceLocked) onLockedVoiceClick() else onSelect(AlarmPlayModes.ALARM_VOICE)
            },
            modifier = Modifier.weight(1f),
        )
        PlayModeChip(
            label = stringResource(R.string.editor_play_mode_voice_only),
            selected = selected == AlarmPlayModes.VOICE_ONLY,
            locked = voiceLocked,
            onClick = {
                if (voiceLocked) onLockedVoiceClick() else onSelect(AlarmPlayModes.VOICE_ONLY)
            },
            modifier = Modifier.weight(1f),
        )
        PlayModeChip(
            label = stringResource(R.string.editor_play_mode_alarm_only),
            selected = selected == AlarmPlayModes.ALARM_ONLY,
            onClick = { onSelect(AlarmPlayModes.ALARM_ONLY) },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
internal fun PlayModeChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    locked: Boolean = false,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.alpha(if (locked && !selected) 0.58f else 1f),
        shape = RoundedCornerShape(14.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else if (locked) {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.32f)
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.44f)
        },
        border = if (selected) {
            BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.42f))
        } else {
            BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.62f))
        },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = label,
                modifier = Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Ellipsis,
                color = if (selected) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else if (locked) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
            if (locked && !selected) {
                FeatureLockBadge(
                    modifier = Modifier.align(Alignment.TopEnd),
                    size = 18.dp,
                    iconSize = 10.dp,
                )
            }
        }
    }
}

internal val TtsCategories: List<Pair<String, Int>> = listOf(
    "morning" to R.string.editor2_cat_morning,
    "lunch" to R.string.editor2_cat_lunch,
    "evening" to R.string.editor2_cat_evening,
    "night" to R.string.editor2_cat_night,
    "health" to R.string.editor2_cat_health,
    "study" to R.string.editor2_cat_study,
    "cheer" to R.string.editor2_cat_cheer,
    "love" to R.string.editor2_cat_love,
)

internal val RandomPromptContexts: List<Pair<String, Int>> = listOf(
    // 추가 정보 없이 바로 쓰는 고정 문구 풀 — 새 알람의 기본값. 무료 플랜은 이것만 사용 가능.
    "preset" to R.string.editor2_ctx_preset,
    "wake_weather" to R.string.editor2_ctx_wake_weather,
    "wake_fortune" to R.string.editor2_ctx_wake_fortune,
    "meal" to R.string.editor2_ctx_meal,
    "sleep" to R.string.editor2_ctx_sleep,
    "exercise" to R.string.editor2_ctx_exercise,
    "love" to R.string.editor2_ctx_love,
)

internal val TtsLanguages: List<Pair<String, Int>> = listOf(
    "ko" to R.string.editor2_lang_ko,
    "en" to R.string.editor2_lang_en,
    "ja" to R.string.editor2_lang_ja,
)

internal val TtsTranslationLanguages: List<Pair<String, Int>> = listOf(
    "ko" to R.string.editor2_lang_ko,
    "en" to R.string.editor2_lang_en,
    "ja" to R.string.editor2_lang_ja,
    "fr" to R.string.editor2_lang_fr,
    "it" to R.string.editor2_lang_it,
)
