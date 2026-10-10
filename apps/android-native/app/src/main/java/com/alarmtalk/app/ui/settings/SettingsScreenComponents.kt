package com.alarmtalk.app

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import java.time.LocalTime
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
    /**
     * 행 아래 작은 안내 한 줄(예: 목록에 없는 옛 지역 — "목록에서 다시 골라 주세요").
     * 값 칸에 붙이지 않는 이유: 값은 한 줄로 잘리는 자리라 안내가 먼저 잘려 사라진다.
     */
    supportingText: String? = null,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
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
        if (supportingText != null) {
            // ⚠ **왼쪽 정렬, 라벨과 같은 시작선**(행 안쪽 12dp)이다. 오른쪽 정렬은 이 앱에서
            // **값**만의 자리다 — 보조 문장(동의 내역의 국외 이전 안내 `consent_overseas_withdraw_notice`,
            // 더보기 프로필의 부제 `menu_profile_subtitle`)은 전부 시작선에 붙는다. 값 밑에 오른쪽으로
            // 붙이면 값의 일부처럼 읽힌다. iOS `SettingsValueButton` 의 `note` 도 `.leading` 이다.
            Text(
                text = supportingText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Start,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
            )
        }
    }
}

// 지역 고르기는 편집기 문구 pane 의 WeatherLocationDialog(AlarmRandomPromptSettings.kt)를
// 공유한다 — 나라 → 지역 목록, 직접 입력 없음(2026-09-30).

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

    // ⚠ **가운데 카드 + X 로 되돌리지 말 것** — 아이폰의 폼 모달은 시트 + 상단바다
    // (`ui/components/WakerModal.kt` 의 `WakerFormSheet` 주석 참조).
    WakerFormSheet(
        title = stringResource(R.string.hs_quiet_time_dialog_title),
        onCancel = onDismiss,
        onSave = { onConfirm(drafts.map { it.toWindow() }) },
        saveLabel = stringResource(R.string.hs_save),
        cancelLabel = stringResource(R.string.editor_cancel),
        // 이 폼은 값이 갖춰져야만 저장할 수 있다(운세와 달리 어느 칸이 비었는지 카드마다
        // 이미 보인다) — 그래서 잠근다.
        saveEnabled = valid,
    ) {
                Text(
                    text = stringResource(R.string.hs_quiet_time_dialog_desc),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp, bottom = 16.dp),
                )
                // ⚠ 여기서 다시 `verticalScroll`·`weight` 를 쓰지 말 것 —
                // 바깥 `WakerFormSheet` 가 이미 스크롤한다(스크롤 안의 스크롤은
                // 높이 제약이 무한이라 `weight` 가 터진다).
                Column(
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
    }

    timePickerTarget?.let { target ->
        val draft = drafts.getOrNull(target.index) ?: return@let
        val initial = if (target.isStart) draft.start else draft.end
        val state = rememberTimePickerState(
            initialHour = initial.hour,
            initialMinute = initial.minute,
            is24Hour = true,
        )
        // 자기 창을 여는 모달 — 진입 안내가 이 위에 겹치지 않게 적어 둔다(`OpenModalRegistry`).
        TrackOpenModal()
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
                                val picked = LocalTime.of(state.hour, state.minute)
                                updateDraft(target.index) {
                                    if (target.isStart) it.copy(start = picked) else it.copy(end = picked)
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
                    label = formatQuietTime(draft.start.toString()),
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
                    label = formatQuietTime(draft.end.toString()),
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

/**
 * 방해금지 구간 편집 초안. 시각은 TimePicker 로만 바뀌므로 언제나 유효한 [LocalTime] 이다 —
 * 글자 입력 시절의 시·분 문자열 검증은 필요 없다.
 */
internal data class QuietWindowDraft(
    val days: Set<Int>,
    val start: LocalTime,
    val end: LocalTime,
)

internal fun FamilyAlarmQuietWindow.toDraft(): QuietWindowDraft =
    QuietWindowDraft(
        days = days.filter { it in 0..6 }.toSet().ifEmpty { setOf(1, 2, 3, 4, 5) },
        start = quietTimeOrDefault(start),
        end = quietTimeOrDefault(end),
    )

// LocalTime 은 초가 0 이면 "HH:mm" 으로 적힌다 — 서버 TIME_RE 형식 그대로다.
internal fun QuietWindowDraft.toWindow(): FamilyAlarmQuietWindow =
    FamilyAlarmQuietWindow(days = days.sorted(), start = start.toString(), end = end.toString())

internal fun QuietWindowDraft.isValid(): Boolean = days.isNotEmpty()

/** "HH:mm" 을 읽는다. 시·분이 범위를 벗어나거나 숫자가 아니면 **각각** 9시·0분으로 채운다. */
internal fun quietTimeOrDefault(value: String): LocalTime {
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull()?.takeIf { it in 0..23 } ?: 9
    val minute = parts.getOrNull(1)?.toIntOrNull()?.takeIf { it in 0..59 } ?: 0
    return LocalTime.of(hour, minute)
}

internal fun quietScheduleLabel(context: Context, windows: List<FamilyAlarmQuietWindow>): String {
    if (windows.isEmpty()) return context.getString(R.string.misc2_quiet_none)
    val visible = windows.take(2).joinToString(" · ") { quietWindowLabel(context, it) }
    val hidden = windows.size - 2
    return if (hidden > 0) context.getString(R.string.misc2_quiet_more, visible, hidden) else visible
}

/**
 * 설정 '지역' 행에 보이는 값 — **지역 이름만** 쓴다(판정은 `weatherRegionDisplay` 한 곳).
 *
 * ⚠ **나라를 붙이지 말 것**(2026-08-17 통일). 저장은 나라+지역 글자 둘 다 하지만, 앱의 다른
 * 자리가 전부 지역 이름으로 말한다(문구 요약 행의 `날씨 · 서울`). 설정에서만 "대한민국 인천" 이면
 * 같은 값이 두 이름을 갖는다. iOS `weatherLocationLabel` 도 같다.
 * 목록의 지역이면 앱 언어의 이름, 되짚지 못한 옛 값이면 적힌 글자 그대로다(행 아래 안내가 붙는다).
 */
internal fun weatherLocationSettingsLabel(context: Context, country: String, city: String): String =
    weatherRegionDisplay(context, country, city).label
        .ifBlank { context.getString(R.string.misc2_settings_not_set) }

/**
 * 설정 행에 보이는 운세 정보 — **성별 · 생년월일**까지다.
 *
 * ⚠ **'설정됨' 으로 줄이지 말 것.** 이 행이 답해야 하는 질문은 둘이다: 넣었나, 그리고
 * **제대로 넣었나**. 사주는 생년월일이 전부라 오타가 나면 알람 문구가 통째로 남의 것이
 * 되는데, '설정됨' 은 그걸 영영 감춘다.
 * ⚠ **태어난 시각까지 넣지도 말 것**(2026-08-17 정리). 셋을 다 넣으면 행이 넘쳐 잘리고,
 * 잘리는 쪽은 값이다 — 훑어서 틀림을 알아채라고 둔 정보가 먼저 사라진다.
 * 시각은 눌러서 여는 다이얼로그에 그대로 있다. iOS `fortuneInfoLabel` 도 같다.
 */
internal fun fortuneInfoSettingsLabel(
    context: Context,
    gender: String,
    birthDate: String,
): String {
    val value = listOf(fortuneValueLabel(context, gender.trim()), birthDate)
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
