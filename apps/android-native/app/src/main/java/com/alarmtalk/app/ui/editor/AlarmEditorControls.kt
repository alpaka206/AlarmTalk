package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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
import com.alarmtalk.app.WakerChipShape
import com.alarmtalk.app.WakerPillShape
import com.alarmtalk.app.data.AlarmAudioLimits
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmTimeCalculator
import com.alarmtalk.app.data.HolidayDate
import com.alarmtalk.app.data.holidayCountryDisplayName
import com.alarmtalk.app.data.holidayCountryFlagEmoji
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
    onToggleDay: (Int) -> Unit,
    onHolidayOffChange: (Boolean) -> Unit,
    holidayCountryCode: String,
    upcomingHolidays: List<HolidayDate>,
    onHolidayColdCache: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerCardShape,
        color = MaterialTheme.colorScheme.surface,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            RepeatSelector(
                hour = hour,
                minute = minute,
                repeatDaysMask = repeatDaysMask,
                holidayOff = holidayOff,
                onToggleDay = onToggleDay,
                onHolidayOffChange = onHolidayOffChange,
                holidayCountryCode = holidayCountryCode,
                upcomingHolidays = upcomingHolidays,
                onHolidayColdCache = onHolidayColdCache,
            )
        }
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
    holidayCountryCode: String,
    upcomingHolidays: List<HolidayDate>,
    onHolidayColdCache: () -> Unit,
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
            // 끄기가 켜졌을 때만: (a) 적용되는 공휴일 달력 국가 라벨, (b) 다가오는 공휴일 목록.
            if (holidayOff) {
                val flag = holidayCountryFlagEmoji(holidayCountryCode)
                val countryName = holidayCountryDisplayName(holidayCountryCode)
                val countryLabelValue = listOf(flag, countryName)
                    .filter { it.isNotBlank() }
                    .joinToString(" ")
                Text(
                    text = stringResource(R.string.editor_holiday_country_label, countryLabelValue),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                HolidayUpcomingList(
                    holidays = upcomingHolidays,
                    countryCode = holidayCountryCode,
                    onColdCache = onHolidayColdCache,
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
    val interactionSource = remember { MutableInteractionSource() }
    Surface(
        onClick = onClick,
        modifier = modifier
            .aspectRatio(1f)
            .wakerPressScale(interactionSource),
        interactionSource = interactionSource,
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
        EditorSectionTitle(stringResource(R.string.editor_play_mode_title))
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
    // 세그먼트 컨트롤: 하나의 트랙 안에서 선택 세그먼트만 채워진다.
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerButtonShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        border = wakerCardBorder(),
    ) {
        Row(
            modifier = Modifier.padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
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
}

// 편집기 공용 세그먼트 선택기 — '재생 방식'과 '목소리/녹음·파일' 소스가 같은 트랙·크기·
// 선택색(primaryContainer)을 쓰도록 통일한다. PlayModeChip 을 그대로 재사용해 높이·모서리·
// 굵기가 일치한다(예전엔 소스가 M3 FilterChip 라 더 작고 선택색도 secondaryContainer 였다).
@Composable
internal fun EditorSegmentedSelector(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = WakerButtonShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        border = wakerCardBorder(),
    ) {
        Row(
            modifier = Modifier.padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            options.forEach { (value, label) ->
                PlayModeChip(
                    label = label,
                    selected = selected == value,
                    onClick = { onSelect(value) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
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
    val interactionSource = remember { MutableInteractionSource() }
    Surface(
        onClick = onClick,
        modifier = modifier
            .wakerPressScale(interactionSource)
            .alpha(if (locked && !selected) 0.58f else 1f),
        interactionSource = interactionSource,
        shape = WakerChipShape,
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            Color.Transparent
        },
        border = if (selected) {
            BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.42f))
        } else {
            null
        },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 12.dp),
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
    "medication" to R.string.editor2_cat_medication,
    "study" to R.string.editor2_cat_study,
    "cheer" to R.string.editor2_cat_cheer,
    "love" to R.string.editor2_cat_love,
    "exercise" to R.string.editor2_cat_exercise,
)

/**
 * 무료 플랜이 알람 "버킷"으로 고를 수 있는 카테고리(노출 순서). 실제 노출은 stockClips
 * manifest 와 교차한다 → 서버에 버킷을 추가/재시드하면 여기에만 추가하면 칩이 늘어난다.
 */
internal val FreeBucketOrder: List<String> = listOf("morning", "medication")

/** 버킷 칩 라벨. 카테고리 라벨 문자열을 재사용한다(기상·약 …). */
internal fun freeBucketLabelRes(category: String): Int =
    (TtsCategories.firstOrNull { it.first == category }?.second) ?: R.string.editor2_cat_morning

/** stockClips manifest 에서 (해당 보이스·언어) 로 실제 존재하는 무료 버킷을 노출 순서대로. */
internal fun freeBucketsFor(
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    voiceProfileId: String?,
    language: String,
): List<String> {
    if (voiceProfileId.isNullOrBlank()) return emptyList()
    val available = stockClips
        .asSequence()
        .filter { it.voiceProfileId == voiceProfileId && (it.language ?: "ko") == language }
        .mapNotNull { it.category }
        .toSet()
    return FreeBucketOrder.filter { it in available }
}

// 문구 컨텍스트의 정규화·기본값용 정식 집합(back-compat/normalize 유지). preset 은 새 알람의
// 보이지 않는 기본값이자 시스템 목소리 사전 렌더 트리거라 여기 남는다. 편집기 선택 목록은
// 아래 EditorMessageContexts 를 따로 쓴다.
internal val RandomPromptContexts: List<Pair<String, Int>> = listOf(
    // 추가 정보 없이 바로 쓰는 고정 문구 풀 — 새 알람의 기본값(사전 렌더). 무료 플랜도 이것만.
    "preset" to R.string.editor2_ctx_preset,
    "wake_weather" to R.string.editor2_ctx_wake_weather,
    "wake_fortune" to R.string.editor2_ctx_wake_fortune,
    "meal" to R.string.editor2_ctx_meal,
    "sleep" to R.string.editor2_ctx_sleep,
    "exercise" to R.string.editor2_ctx_exercise,
    "love" to R.string.editor2_ctx_love,
)

// '직접 입력'(랜덤 끄고 사용자가 문구를 직접 타이핑) 을 나타내는 특수 선택값.
internal const val ManualMessageContext = "manual"

// 편집기 '문구' 선택기에 노출하는 옵션 — 직접 입력 + 동적 문구(날씨·운세·운동·사랑).
// 기본문구(preset)·식사·취침은 목록에서 제외한다(preset 은 보이지 않는 기본값으로만 유지).
internal val EditorMessageContexts: List<Pair<String, Int>> = listOf(
    "wake_weather" to R.string.editor2_ctx_wake_weather,
    "wake_fortune" to R.string.editor2_ctx_wake_fortune,
    "exercise" to R.string.editor2_ctx_exercise,
    "love" to R.string.editor2_ctx_love,
    ManualMessageContext to R.string.editor_msg_mode_manual,
)
