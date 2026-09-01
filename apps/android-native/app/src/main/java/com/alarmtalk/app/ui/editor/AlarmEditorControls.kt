package com.alarmtalk.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.runtime.getValue
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import com.alarmtalk.app.fitToWidthScale
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
            // ⚠ **공휴일 달력 국가·다가오는 공휴일 목록을 되살리지 말 것**(2026-08-11 요청).
            // 토글이 하는 말("공휴일에는 끄기")로 충분하다 — 어느 나라 달력인지는 설정에서
            // 이미 정했고, 다가오는 공휴일 목록은 이 자리에서 결정에 쓰이지 않는다.
            // 카드만 길어져 아래 여백이 사라진다.
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
        // ⚠ **칩은 `aspectRatio(1f)` 원이라 글자가 줄바꿈으로 흐를 수 없다** —
        // `fitToWidthScale` 표의 '쓴다' 쪽에 해당한다. 안전망이 없던 시절에는 좁은
        // 화면(폴드 커버)이나 큰 글꼴에서 원 안 글자가 잘렸다. iOS 는 같은 자리에
        // `minimumScaleFactor(0.6)` 이 있다 — 하한 숫자를 맞춘다.
        BoxWithConstraints(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            val labelScale = fitToWidthScale(maxWidth, 44.dp, minimumScale = 0.6f)
            val baseStyle = MaterialTheme.typography.bodyLarge
            Text(
                text = label,
                style = baseStyle,
                fontSize = baseStyle.fontSize * labelScale,
                lineHeight = baseStyle.lineHeight * labelScale,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                color = contentColor,
                maxLines = 1,
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

/**
 * 재생 방식('목소리' ↔ '알람')을 바꿀 때 아래 요소가 나타나고 사라지는 전환.
 *
 * 2026-08-15 지적: "왔다갔다하면 아래 요소들이 탁탁 바뀐다." iOS 는 세그먼트를 누를 때
 * `withAnimation(.snappy(duration: 0.28))` 으로 상태를 바꿔서, 그에 딸린 카드들이 함께
 * 늘었다 줄었다 한다(`VoicePlayModePicker.commit`). 컴포즈는 조건부 컴포저블이
 * 그냥 사라지므로 같은 시간값으로 맞춰 준다.
 *
 * 시스템에서 애니메이션을 꺼 둔 사용자에겐 자동으로 즉시 전환된다 — 컴포즈 기본
 * `MotionDurationScale` 이 `Settings.Global.ANIMATOR_DURATION_SCALE` 을 읽는다.
 * (iOS 는 `reduceMotion` 을 직접 본다 — 같은 뜻이다.)
 */
internal const val PlayModeSwitchDurationMillis = 280

/**
 * ⚠ **사라질 때 페이드를 '시간을 들여' 주지 말 것**(2026-08-15 세 번째 지적).
 * 시간을 주면 **접히는 카드가 그대로 읽힌다** — 특히 문구 요약 행은 알람이 실제로 말할
 * 문장이라, 0.1초만 비쳐도 "왜 저게 보이지" 가 된다. iOS 실측(0.28 → 3.0초로 늘려
 * 접근성 트리를 0.25초 간격 조회)에서 **0.25초 시점에 이미 트리에서 사라져 있었다** —
 * 아이폰은 내용을 곧바로 없애고 **자리만** 접는다.
 */
private val PlayModeFadeOutSpec = snap<Float>()

/** 나타날 땐 **자리를 다 연 뒤** 내용을 띄운다 — 눌린 채로 나타나지 않게. */
private const val PlayModeFadeInDelayMillis = 200
private const val PlayModeFadeInMillis = 120

/**
 * 자리가 열리고 닫히는 움직임 — **iOS `withAnimation(.snappy(duration: 0.28))` 과 같은 물리다.**
 *
 * ⚠ **tween 으로 되돌리지 말 것**(2026-08-16 "사라지는 속도 아이폰이랑 완벽하게 동일하게").
 * `.snappy` 는 이징 곡선이 아니라 **스프링**이고, `bounce: 0` = 임계감쇠다. 애플이 공개한
 * 변환식(WWDC23 "Animate with springs")은 지속시간 D 에 대해
 *   `stiffness = (2π / D)²`, `damping = 4π / D` (→ dampingRatio 1)
 * 이고, 컴포즈 `spring()` 의 `stiffness` 도 같은 규약(고유진동수 = √stiffness)이라 그대로 옮긴다.
 *   D = 0.28초 → 2π/0.28 = 22.44 rad/s → stiffness = 503.6
 * 같은 0.28 이라도 tween 은 등속에 가깝게 끝나고 스프링은 끝에서 천천히 붙는다 — 그래서
 * 숫자만 맞춰서는 두 앱이 다르게 보였다.
 */
private const val PlayModeSpringStiffness = 503.6f

private fun <T> playModeSizeSpec(): androidx.compose.animation.core.FiniteAnimationSpec<T> =
    spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = PlayModeSpringStiffness)

/** 재생 방식에 따라 나타났다 사라지는 블록의 등장 전환. */
internal fun playModeEnter(): EnterTransition =
    // ⚠ **`Alignment.Top` 이다.** 기본값(`Bottom`)이면 카드가 아래에서 위로 열려 **글자
    // 윗부분이 잘린 채** 들어온다. 위에서 아래로 열려야 목소리 → 문구 → 크기 순서 그대로 자라난다.
    expandVertically(playModeSizeSpec(), expandFrom = Alignment.Top) +
        fadeIn(tween(PlayModeFadeInMillis, delayMillis = PlayModeFadeInDelayMillis))

/** 같은 블록의 퇴장 전환. */
internal fun playModeExit(): ExitTransition =
    fadeOut(PlayModeFadeOutSpec) +
        shrinkVertically(playModeSizeSpec(), shrinkTowards = Alignment.Top)

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
    // ⚠ **트랙을 직접 그리지 말고 `EditorSegmentedSelector` 에 맡긴다.**
    // 예전에는 여기서 `Surface` + `PlayModeChip` 두 개를 직접 늘어놓았는데, 선택 표시를
    // 칩 배경에서 **미끄러지는 트랙 배경**으로 옮기면서(2026-08-10) 이쪽에는 그 배경을
    // 그려 줄 주체가 없어졌다 — 그래서 **목소리·알람 어느 쪽도 선택돼 보이지 않았다**
    // (같은 날 지적 "둘 다 표시가 안 되어 있다"). 세그먼트가 둘이면 또 갈라진다.
    //
    // ⚠ **두 칸이다.** '알람 + 목소리' 를 되살리지 말 것(AlarmPlayModes 주석 참조).
    // ⚠ **목소리가 왼쪽**이다 — 우리는 목소리 알람 앱이고, 새 알람의 기본값도
    // 목소리다(`AlarmEditorState` 의 초기 playMode). 읽는 순서와 기본 선택이
    // 어긋나면 첫 화면에서 오른쪽 칸이 켜져 있어 무엇이 기본인지 흐려진다.
    EditorSegmentedSelector(
        options = listOf(
            AlarmPlayModes.VOICE_ONLY to stringResource(R.string.editor_play_mode_voice_only),
            AlarmPlayModes.ALARM_ONLY to stringResource(R.string.editor_play_mode_alarm_only),
        ),
        // ⚠ **정규화한 값으로 비교한다.** 저장된 옛 값('알람 + 목소리')은 목소리로 읽는다 —
        // 날것으로 비교하면 어느 칸과도 안 맞아 선택 표시가 사라진다.
        selected = AlarmPlayModes.normalize(selected),
        onSelect = { value ->
            if (value == AlarmPlayModes.VOICE_ONLY && voiceLocked) {
                onLockedVoiceClick()
            } else {
                onSelect(value)
            }
        },
        lockedValues = if (voiceLocked) setOf(AlarmPlayModes.VOICE_ONLY) else emptySet(),
    )
}

// 공용 세그먼트 선택기 — 앱의 **유일한** 세그먼트 구현이다.
//
// ⚠ 주석에 적혀 있던 '목소리/녹음·파일 소스' 는 **더 이상 없다.** 그 세그먼트는 없앴고
// '직접 녹음' 은 목소리 목록의 마지막 항목이 됐다(`VoiceAudioCard` 의 `recordingOption`).
// 지금 쓰는 곳은 `PlayModeSelector`(재생 방식)와 `VoiceProfileManagementPanel` 이다.
@Composable
internal fun EditorSegmentedSelector(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    /// 자물쇠 배지를 달 값들(무료 등급에서 못 고르는 칸). 눌리기는 하되 호출부가 안내를 띄운다.
    lockedValues: Set<String> = emptySet(),
) {
    // ⚠ **선택 표시는 배경 하나가 미끄러져 옮겨간다.** 예전에는 칸마다 색이 즉시
    // 바뀌어(`Surface(color=...)`) 전환이 툭 끊겼다 — iOS 는 `matchedGeometryEffect` 로
    // 하나의 배경을 옮긴다(`Views/Editor/VoicePlayModePicker.swift`). 같은 움직임으로 맞춘다
    // (2026-08-10 사용자 요청 "아이폰처럼 자연스럽게 움직이도록").
    val selectedIndex = options.indexOfFirst { it.first == selected }.coerceAtLeast(0)
    // iOS 와 같은 박자(0.28초). 시스템 '애니메이션 줄이기' 는 Compose 가
    // `MotionDurationScale` 로 이미 반영하므로 따로 분기하지 않는다.
    val thumbFraction by animateFloatAsState(
        targetValue = selectedIndex.toFloat(),
        animationSpec = tween(durationMillis = 280),
        label = "play-mode-thumb",
    )
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = WakerButtonShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        border = wakerCardBorder(),
    ) {
        Box(modifier = Modifier.padding(4.dp)) {
            val count = options.size.coerceAtLeast(1)
            BoxWithConstraints {
                val slotWidth = maxWidth / count
                // ⚠ **`matchParentSize()` 로 한 겹 감싼다.** 트랙의 높이는 아래 `Row`(칩)가
                // 정하는데, 이 `Box` 에 들어오는 높이 제약은 **위가 열려 있다**(wrap content).
                // 그래서 배경에 `fillMaxHeight()` 만 걸면 늘어날 상한이 없어 **높이 0** 이
                // 되고, 배경이 그려지긴 하는데 **보이지 않는다** — 선택된 칸이 아무 표시도
                // 없어 보인다. `matchParentSize` 는 자기 크기를 부모(=Row가 정한 크기)에
                // 맞추면서 **부모 크기 계산에는 끼지 않아** 순환도 생기지 않는다.
                Box(modifier = Modifier.matchParentSize()) {
                    // 미끄러지는 배경 — 칸 하나 크기로 두고 위치만 옮긴다.
                    Box(
                        modifier = Modifier
                            .width(slotWidth)
                            .fillMaxHeight()
                            .offset(x = slotWidth * thumbFraction)
                            .clip(WakerChipShape)
                            .background(MaterialTheme.colorScheme.primaryContainer)
                            .border(
                                BorderStroke(
                                    1.dp,
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.42f),
                                ),
                                WakerChipShape,
                            ),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                    options.forEach { (value, label) ->
                        PlayModeChip(
                            label = label,
                            selected = selected == value,
                            locked = lockedValues.contains(value),
                            onClick = { onSelect(value) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
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
    // ⚠ **칸은 배경을 그리지 않는다.** 선택 표시는 트랙의 미끄러지는 배경이 맡는다
    // (`EditorSegmentedSelector`). 여기서 색을 또 칠하면 옮겨가는 배경과 겹쳐
    // 두 칸이 동시에 칠해진 것처럼 보인다.
    //
    // ⚠ **리플(indication)도 끈다**(2026-08-11 요청 "눌렀을 때 회색 표시되는 거 없애도 돼").
    // `Surface(onClick = …)` 은 기본 리플을 그리는데, 그 회색 사각이 **미끄러지는 선택
    // 배경 위에 겹쳐** 한 칸이 두 겹으로 칠해진 것처럼 보인다. 눌린 느낌은
    // `wakerPressScale` 이 이미 준다 — 피드백이 사라지는 게 아니라 중복이 빠지는 것이다.
    // (같은 이유로 알람 행도 `indication = null` 이다 — `ControlsAndPermissions.kt`.)
    Box(
        modifier = modifier
            .wakerPressScale(interactionSource)
            .alpha(if (locked && !selected) 0.58f else 1f)
            .clip(WakerChipShape)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick,
            ),
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

// TTS 카테고리(서버 전송값)의 정식 집합. 화면에 칩으로 그리지는 않고,
// normalizedTtsCategory 의 화이트리스트와 버킷 칩 라벨 조회에만 쓴다.
// morning = 문구를 안 바꿨을 때의 기본값(서버가 greeting 문구로 이어 붙인다).
internal val TtsCategories: List<Pair<String, Int>> = listOf(
    "morning" to R.string.editor2_cat_morning,
    "medication" to R.string.editor2_cat_medication,
    "love" to R.string.editor2_cat_love,
)


/** stockClips manifest 에서 (해당 보이스·언어) 로 실제 존재하는 무료 버킷을 노출 순서대로. */
/**
 * stockClips manifest 에서 (해당 보이스·언어) 로 **완전히** 준비된 무료 버킷을 노출 순서대로.
 *
 * ⚠ **'하나라도 있으면' 이 아니라 '전부 있어야' 한다**(2026-09-02 리뷰). 매니페스트는
 * 클립이 하나 구워질 때마다 그 카테고리를 곧바로 노출한다 — 시딩이 도는 중에는
 * **부분 세트**가 보인다는 뜻이다. 그때 고르면 `bindStockBucketClips` 가 **그 순간 보이는
 * variant 만** 알람에 박아 두고, `StockClipLanguageRebinder` 는 같은 언어의 기존 버킷을
 * 나중에 넓혀 주지 않는다 — 시딩 중에 만든 알람이 **영구히 부분 세트**로 남는다.
 * 조건형(날씨·운세)에서는 그게 곧 엉뚱한 조건의 클립이 나가는 것이다.
 *
 * 클론 쪽은 `ClipPreparationGate.hasCompleteCloneBucket` 이 같은 일을 하는데,
 * **기본(시스템) 목소리는 그 관문을 그냥 지난다**(선다운로드 대상이라 일부러 그렇게 뒀다).
 * 그래서 그 완전성 판정이 여기 있어야 한다.
 *
 * @param expectedVariants 서버가 내려준 카테고리별 세트 크기. **null 이면 막지 않는다** —
 *   못 물어본 것이 사용자를 막는 근거가 되면 안 된다(관문들과 같은 규약).
 */
internal fun freeBucketsFor(
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    voiceProfileId: String?,
    language: String,
    expectedVariants: com.alarmtalk.app.network.ExpectedVariantCounts? = null,
): List<String> {
    if (voiceProfileId.isNullOrBlank()) return emptyList()
    val variantsByCategory = stockClips
        .asSequence()
        .filter { it.voiceProfileId == voiceProfileId && (it.language ?: "ko") == language }
        .mapNotNull { clip -> clip.category?.let { it to clip.variant } }
        .groupBy({ it.first }, { it.second })
    return FreeBucketOrder.filter { category ->
        val variants = variantsByCategory[category]?.toSet() ?: return@filter false
        val expected = expectedVariants?.countFor(category, isSystemVoice = true)
        // 매니페스트를 못 받았거나 서버가 개수를 모르면 예전대로 '있으면 노출' 이다.
        if (expected == null || expected <= 0) return@filter true
        variants == (0 until expected).toSet()
    }
}

// 문구 컨텍스트의 정규화·기본값용 정식 집합. preset 은 새 알람의 보이지 않는 기본값이자 시스템
// 목소리 사전 렌더 트리거라 여기 남는다. 편집기 선택 목록은 아래 EditorMessageContexts 를 따로 쓴다.
// 목록 밖의 값은 normalizedRandomPromptContext 가 preset 으로 접는다.
internal val RandomPromptContexts: List<Pair<String, Int>> = listOf(
    // 추가 정보 없이 바로 쓰는 고정 문구 풀 — 새 알람의 기본값(사전 렌더). 무료 플랜도 이것만.
    // 화면에 그려지는 라벨은 VoiceAudioCard 가 쓰는 editor_msg_mode_preset 하나로 통일한다.
    "preset" to R.string.editor_msg_mode_preset,
    "wake_weather" to R.string.editor2_ctx_wake_weather,
    "wake_fortune" to R.string.editor2_ctx_wake_fortune,
    "love" to R.string.editor2_ctx_love,
    // 약(medication): 동적 생성 모드가 아니라 고정 프리셋. randomContext='medication' 는
    // 백엔드에서 'preset' 으로 정규화되고 category='medication' 프리셋 문구를 뽑는다.
    "medication" to R.string.editor2_ctx_medication,
)

// '직접 입력'(랜덤 끄고 사용자가 문구를 직접 타이핑) 을 나타내는 특수 선택값.
internal const val ManualMessageContext = "manual"

// 편집기 '문구' 선택기(유료) 노출 옵션 — 기본 인사말 + 날씨·운세·사랑(동적) + 약(고정 프리셋)
// + 직접 입력. preset 을 목록에 노출하는 이유: 새 알람의 기본값이자 '마지막에 고른 문구 종류'로
// 기억될 수 있는 값이라, 목록에 없으면 요약 행은 '기본 인사말'인데 선택기를 열면 아무것도(또는
// 엉뚱한 항목이) 체크돼 보인다. 사용자에겐 선택이 리셋된 것으로 읽힌다. 되돌아올 길도 필요하다.
internal val EditorMessageContexts: List<Pair<String, Int>> = listOf(
    "preset" to R.string.editor_msg_mode_preset,
    "wake_weather" to R.string.editor2_ctx_wake_weather,
    "wake_fortune" to R.string.editor2_ctx_wake_fortune,
    "love" to R.string.editor2_ctx_love,
    "medication" to R.string.editor2_ctx_medication,
    ManualMessageContext to R.string.editor_msg_mode_manual,
)

/**
 * 스톡 클립을 쓰는 목소리(무료 플랜 · 기본 목소리)가 고를 수 있는 버킷 category — **노출 순서**.
 *
 * ⚠ **손으로 적지 않는다.** [EditorMessageContexts] 를 [clonePrerenderBucketCategoryFor] 로
 * 옮긴 것이 전부다. 2026-09-02 전에는 여기가 `listOf("medication", "weather")` 라, 같은
 * '문구 종류' 가 **유료는 5종 · 무료는 2종**으로 갈라져 있었다 — 그 차이는 제품 결정이 아니라
 * *기본 목소리에 운세·사랑 클립이 없었다*는 사정이었고, 클립을 채우고 나니 남을 이유가 없었다.
 * 목록을 두 벌로 두면 한쪽만 늘어나는 사고가 다시 난다.
 *
 * 실제 노출은 stockClips manifest 와 교차한다([freeBucketsFor]) — 서버에 카테고리를
 * 추가하고 재시드하면 앱 수정 없이 칩이 늘어난다. 아직 안 구워진 카테고리는 저절로 빠진다.
 *
 * ⚠ 이 순서는 **직전에 고른 테마가 없을 때만** 쓰는 최후 폴백이다 — 마지막에 고른 테마가
 * 있으면 그쪽이 우선한다(AlarmEditorScreen 의 lastFreeBucket). '항상 적용되는 기본값' 으로
 * 되돌리면 날씨로 저장해도 새 알람이 매번 첫 값으로 돌아간다.
 */
internal val FreeBucketOrder: List<String> = EditorMessageContexts
    // ⚠ **'직접 입력' 을 먼저 걷어내야 한다.** `clonePrerenderBucketCategoryFor` 는 모르는
    //   값을 `preset` 으로 접으므로(`normalizedRandomPromptContext`), 그냥 흘리면 manual 이
    //   **greeting 으로 둔갑해** 목록에 같은 버킷이 두 번 들어온다.
    //
    // ⚠ **'기본 인사말'(preset → greeting)도 뺀다**(2026-09-02 리뷰). 목록을 합칠 때
    //   이것까지 넣었다가 되돌렸다. 이유가 둘인데 **둘 다 스스로 충분하다**:
    //    1. **내용이 다르다.** 스톡 `greeting` 은 목소리 미리듣기용 자기소개다
    //       ("만나서 반가워요, 앞으로 매일 깨워 드릴게요") — 매일 아침 울릴 문구가 아니다.
    //       클론의 `preset` 은 **생성된 기상 인사**라 같은 이름의 다른 것이다.
    //    2. **서버가 막는다.** `alarm-mutation.ts` 가 시스템 보이스 + greeting 을
    //       `INVALID_BUCKET_ID`(400) 로 거절한다 — 미리듣기 클립을 알람으로 돌려 쓰는
    //       우회를 막는 정책이다. 그대로 뒀으면 알람이 로컬에만 남고 서버 sync 가 영영 실패한다.
    //   기본 목소리에도 '기본 인사말' 을 주려면 **기상 인사 스톡 클립을 따로 구워야** 한다
    //   (미리듣기 클립을 재사용하는 것이 아니라). 그건 콘텐츠 작업이라 별도로 다룬다.
    .filterNot { (context, _) -> context == ManualMessageContext || context == DefaultRandomPromptContext }
    .mapNotNull { (context, _) -> clonePrerenderBucketCategoryFor(context) }
