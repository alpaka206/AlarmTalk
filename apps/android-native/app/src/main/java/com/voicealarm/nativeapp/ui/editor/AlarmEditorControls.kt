package com.voicealarm.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmAudioLimits
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.AlarmTimeCalculator
import com.voicealarm.nativeapp.data.VoiceSources
import com.voicealarm.nativeapp.network.VoiceProfile
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

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
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            text = repeatSummaryLabel(hour, minute, repeatDaysMask),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            WeekdayLabels.forEachIndexed { index, label ->
                DayTextChip(
                    label = label,
                    dayIndex = index,
                    selected = repeatDaysMask and (1 shl index) != 0,
                    onClick = { onToggleDay(index) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (holidayEnabled) 1f else 0.46f),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(end = 14.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text("공휴일에는 끄기", fontWeight = FontWeight.SemiBold)
                Text(
                    text = "대체 공휴일 및 임시 공휴일 포함",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            VoiceAlarmSwitch(
                checked = holidayEnabled && holidayOff,
                enabled = holidayEnabled,
                onCheckedChange = { enabled ->
                    if (holidayEnabled) onHolidayOffChange(enabled)
                },
            )
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
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = if (selected) selectedContainerColor else Color.Transparent,
        border = if (selected) BorderStroke(1.dp, selectedBorderColor) else null,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        Text(
            text = label,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 9.dp),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            color = contentColor,
        )
    }
}

internal fun repeatSummaryLabel(
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    nowMillis: Long = System.currentTimeMillis(),
    zoneId: ZoneId = ZoneId.systemDefault(),
): String {
    if (repeatDaysMask != 0) {
        if (repeatDaysMask == 0b1111111) return "매일"
        val selectedDays = WeekdayLabels
            .filterIndexed { index, _ -> repeatDaysMask and (1 shl index) != 0 }
            .joinToString(", ")
        return "매주 $selectedDays"
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
    val dateLabel = koreanDateLabel(nextDate)
    return when (nextDate) {
        today -> "오늘 - $dateLabel"
        today.plusDays(1) -> "내일 - $dateLabel"
        else -> dateLabel
    }
}

private fun koreanDateLabel(date: LocalDate): String {
    val dayLabel = WeekdayLabels[date.dayOfWeek.value % 7]
    return "${date.monthValue}월 ${date.dayOfMonth}일($dayLabel)"
}

private val WeekdayLabels = listOf("일", "월", "화", "수", "목", "금", "토")

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
internal fun PlayModeSelector(
    selected: String,
    onSelect: (String) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PlayModeChip(
            label = "알람만",
            selected = selected == AlarmPlayModes.ALARM_ONLY,
            onClick = { onSelect(AlarmPlayModes.ALARM_ONLY) },
            modifier = Modifier.weight(1f),
        )
        PlayModeChip(
            label = "음성만",
            selected = selected == AlarmPlayModes.VOICE_ONLY,
            onClick = { onSelect(AlarmPlayModes.VOICE_ONLY) },
            modifier = Modifier.weight(1f),
        )
        PlayModeChip(
            label = "알람+음성",
            selected = selected == AlarmPlayModes.ALARM_VOICE,
            onClick = { onSelect(AlarmPlayModes.ALARM_VOICE) },
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
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
    ) {
        Text(
            text = label,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 14.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            color = if (selected) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
    }
}

internal val TtsCategories = listOf(
    "morning" to "아침 기상",
    "lunch" to "점심",
    "sleep" to "취침",
    "medicine" to "약",
    "study" to "영어 공부",
    "custom" to "직접 입력",
)

internal val TtsLanguages = listOf(
    "ko" to "한국어",
    "en" to "영어",
    "ja" to "일본어",
)
