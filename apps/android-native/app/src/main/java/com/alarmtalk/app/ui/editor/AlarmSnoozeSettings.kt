package com.alarmtalk.app

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.Icons
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.fitToWidthScale
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.data.SnoozeMinutes
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatternLibrary
import com.alarmtalk.app.data.VibrationPatterns

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
    vibrator.vibrate(VibrationPatternLibrary.effect(patternName, repeat = false), attributes)
}

@Composable
internal fun AlarmSettingRow(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    trailing: @Composable () -> Unit,
) {
    // 전체 탭과 같은 톤 — 행마다 아이콘 배지 없이 제목·요약·컨트롤만.
    // 누르는 순간 살짝 눌리는 물성(홈 카드와 같은 wakerPressScale)으로 즉각 반응을 준다.
    val interactionSource = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .wakerPressScale(interactionSource)
            .clickable(
                interactionSource = interactionSource,
                indication = LocalIndication.current,
                onClick = onClick,
            )
            // ⚠ **치수는 iOS `AlarmSettingRow` 와 같은 값이다**(2026-08-16 지시
            // "안드로이드가 살짝 커 보인다"). 거긴 `padding(.vertical, 12)` +
            // `frame(minHeight: 56)` 이다 — 여기는 14 였고 최소 높이가 없어 더 두꺼웠다.
            .heightIn(min = 56.dp)
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(end = 12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = title,
                // iOS 는 `bodyLarge`(16) + semibold. M3 `titleMedium` 도 16 이지만
                // 자간(0.15)이 더 벌어져 같은 글자가 더 넓게 퍼져 보였다.
                style = MaterialTheme.typography.bodyLarge,
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
            // iOS 셰브론은 SF Symbol 13pt 다. 머티리얼 글리프는 상자를 더 꽉 채우므로
            // 같은 숫자를 쓰면 오히려 작아 보인다 — 16 이 눈으로 같은 크기다.
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
internal fun AlarmSettingDivider(modifier: Modifier = Modifier) {
    // 구분선은 행 텍스트 시작선에 맞춘다 — 세부 설정 카드는 카드 자체 패딩이 있어 그대로,
    // 목소리 카드처럼 행이 자체 패딩을 갖는 곳은 호출부에서 같은 값으로 인셋을 준다.
    Box(
        modifier = modifier
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
            // 상단바는 공용 `WakerTopBar` 하나다 — 화면마다 손으로 그리지 말 것
            // (알람 목록·설정·문구 pane 이 모두 이걸 쓴다).
            WakerTopBar(
                title = stringResource(R.string.editor_snooze_title),
                onBack = onDismiss,
                modifier = Modifier.padding(top = 24.dp),
            )

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    // 지금은 다 들어가지만 글꼴을 키우면 넘친다 — 진동 pane 과 같은 이유로 연다.
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    // 문구 pane·iOS `PaneScaffold` 와 같은 여백/간격
                    // (`padding(.horizontal, 20).padding(.vertical, 16)` + `VStack(spacing: 16)`).
                    .padding(start = 20.dp, end = 20.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Surface(
                    shape = WakerPanelShape,
                    color = MaterialTheme.colorScheme.surface,
                    border = wakerCardBorder(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // ⚠ **상태말('사용 중'/'사용 안 함')로 되돌리지 말 것.** 스위치가 이미
                        // 상태를 말한다 — 그 자리는 **무엇을 켜는지** 이름을 대야 한다
                        // (iOS `Toggle("다시 알림 사용")` 과 같은 말·같은 무게).
                        Text(
                            text = stringResource(R.string.editor_snooze_use),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        AlarmTalkSwitch(
                            checked = snoozeEnabled,
                            onCheckedChange = onSnoozeEnabledChange,
                        )
                    }
                }

                SnoozeOptionSection(title = stringResource(R.string.editor_snooze_interval)) {
                    SnoozeIntervals.forEachIndexed { index, minutes ->
                        SnoozeRadioRow(
                            label = stringResource(R.string.editor_minutes, minutes),
                            selected = snoozeMinutes == minutes,
                            onClick = { onSnoozeMinutesChange(minutes) },
                        )
                        if (index != SnoozeIntervals.lastIndex) SnoozeOptionDivider()
                    }
                    SnoozeOptionDivider()
                    SnoozeRadioRow(
                        label = if (snoozeMinutes in SnoozeIntervals) {
                            stringResource(R.string.editor_snooze_custom)
                        } else {
                            stringResource(R.string.editor_snooze_custom_value, snoozeMinutes)
                        },
                        selected = snoozeMinutes !in SnoozeIntervals,
                        onClick = {
                            customMinutesText = snoozeMinutes.toString()
                            customIntervalDialogOpen = true
                        },
                    )
                }

                SnoozeOptionSection(title = stringResource(R.string.editor_snooze_repeat)) {
                    val repeatOptions = listOf(
                        SnoozeRepeatLimits.THREE to stringResource(R.string.editor_snooze_repeat_three),
                        SnoozeRepeatLimits.FIVE to stringResource(R.string.editor_snooze_repeat_five),
                        SnoozeRepeatLimits.FOREVER to stringResource(R.string.editor_snooze_repeat_forever),
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
        // 앱 공용 알럿으로 통일한다 — 입력이 하나뿐인 모달이라 별도 껍데기가 필요 없다.
        IosAlertDialog(
            title = stringResource(R.string.editor_snooze_custom_dialog_title),
            // ⚠ **범위는 묻기 전에 말한다**(2026-08-17 iOS 와 통일). 예전에는 벗어났을 때만
            // 오류로 알려서, 처음 여는 사람은 몇 분까지 되는지 모른 채 넣어 보고 막혔다.
            message = stringResource(R.string.editor_snooze_custom_range_hint),
            onDismiss = { customIntervalDialogOpen = false },
            actions = listOf(
                IosAlertAction(
                    // 버튼 짝은 iOS 와 같은 [취소][확인] 이다 — 예전에는 [닫기][적용] 이라
                    // 같은 모달이 두 앱에서 다른 말을 했다.
                    label = stringResource(R.string.editor_cancel),
                    onClick = { customIntervalDialogOpen = false },
                ),
                IosAlertAction(
                    label = stringResource(R.string.auth_confirm),
                    emphasized = true,
                    // 범위 밖이면 **버튼을 흐리게** 둔다. 예전엔 '눌러도 닫히지 않는 것' 으로
                    // 알렸는데, 그건 고장과 구분되지 않는다(Codex #671 P2).
                    //
                    // ⚠ 상한은 **30**이다 — 서버 계약(`routes/alarm-helpers.ts` 의
                    // `INVALID_SNOOZE_MINUTES`)과 `AlarmRepository.saveAlarm` 의
                    // `require(snoozeMinutes in 1..30)` 이 그렇다. 여기가 60 이던 시절에는
                    // 31~60 을 넣으면 다이얼로그는 통과시켜 놓고 저장에서 예외가 났다 —
                    // 사용자에겐 "알람 저장에 실패했어요" 만 보이고 이유가 없었다.
                    // 세 숫자(UI·리포지토리·서버)는 항상 같이 움직인다.
                    enabled = customMinutes != null && customMinutes in SnoozeMinutes.range,
                    onClick = {
                        customMinutes?.takeIf { it in SnoozeMinutes.range }?.let {
                            onSnoozeMinutesChange(it)
                            customIntervalDialogOpen = false
                        }
                    },
                ),
            ),
        ) {
            IosAlertField(
                value = customMinutesText,
                onValueChange = { value -> customMinutesText = value.filter { it.isDigit() }.take(2) },
                placeholder = stringResource(R.string.editor_minute_label),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            // 범위를 벗어나면 이유를 말해 준다. 예전 Material 필드는 isError 로 테두리를
            // 붉혔는데, 알럿으로 옮기며 그 신호가 사라져 '적용을 눌러도 아무 일이 없는'
            // 상태가 됐다 — 눌리지 않는 이유는 눈에 보여야 한다.
            if (customMinutesText.isNotBlank() && customMinutes !in SnoozeMinutes.range) {
                Text(
                    text = stringResource(R.string.editor_snooze_custom_range_error),
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                    style = IosAlertType.Message,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                )
            }
        }
    }
}

@Composable
internal fun SnoozeOptionSection(
    title: String? = null,
    content: @Composable () -> Unit,
) {
    // 제목 ↔ 목록 간격은 iOS 와 같은 16 이다(거긴 `EditorSectionTitle` 과 카드가
    // `VStack(spacing: 16)` 의 형제라 그 간격을 그대로 받는다). 예전에는 3 이라 제목이
    // 목록에 붙어 있었다.
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (title != null) {
            Text(
                text = title,
                // iOS `EditorSectionTitle` = `titleSmall`(14) **bold**.
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Bold,
            )
        }
        Surface(
            // 다행 그룹 박스가 형제 단일 행 패널(18)보다 작은 14 를 쓰던 radius 역전 해소.
            shape = WakerPanelShape,
            color = MaterialTheme.colorScheme.surface,
            border = wakerCardBorder(),
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
    // 리스트 행은 최소 터치 타깃(48dp)보다 여유를 둬 삼성/토스식 넉넉한 간격(56dp)으로.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .heightIn(min = 56.dp)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompactSelectionDot(
            selected = selected,
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = label,
            // iOS `RadioRow` 는 `bodyLarge`(16) **regular** 다 — 굵게 두면 목록이
            // 전부 강조돼 지금 고른 항목이 안 도드라진다(체크로만 구분한다).
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}

/**
 * 잠긴 선택지 행 — 고를 수는 없지만 **목록에서 감추지도 않는다**. 무료 사용자에게 기능이
 * 존재한다는 것 자체를 보여주고, 누르면 호출부가 이용권 안내를 띄운다.
 * 선택 점 대신 자물쇠를 두어 "선택 안 됨"과 "잠김"을 눈으로 구분한다.
 */
@Composable
internal fun SnoozeLockedRow(
    label: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .heightIn(min = 56.dp)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // ⚠ **라디오 점(18dp)보다 크게 둔다**(2026-08-15 지시 "자물쇠 좀 더 크게").
        // 같은 크기면 잠긴 행인지 안 잠긴 행인지 한눈에 안 갈린다.
        FeatureLockBadge(size = 24.dp, iconSize = 14.dp)
        Spacer(Modifier.width(12.dp))
        Text(
            text = label,
            // iOS `RadioRow` 는 `bodyLarge`(16) **regular** 다 — 굵게 두면 목록이
            // 전부 강조돼 지금 고른 항목이 안 도드라진다(체크로만 구분한다).
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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
    // 라디오 점(18dp) + 좌우 여백에 맞춰 텍스트 시작선(14+18+12)까지 들여쓴다.
    Box(
        modifier = Modifier
            .padding(start = 44.dp)
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
internal fun EditorActionButtons(
    isSaving: Boolean,
    canSave: Boolean,
    onSave: () -> Unit,
    onCancel: () -> Unit,
    recipientName: String? = null,
) {
    // 상단바를 없앴으므로 취소·저장을 하단에 한 쌍으로 모은다(삼성 시계식). 취소=외곽선, 저장=채움.
    // 두 버튼은 같은 폭(각 weight 1).
    //
    // ⚠ **여기가 `fitToWidthScale` 표의 세 번째 자리다**(WakerDesign.kt 의 '하단 액션
    // 버튼 라벨 — 폭이 반으로 고정'). 표에는 적혀 있었는데 적용은 안 돼 있었고, 대신
    // `maxLines=1` + `Ellipsis` 로 **잘라내고** 있었다 — '○○에게 저장' 이 '○○에…' 가
    // 되면 누구에게 저장하는지 알 수 없다. 줄바꿈으로 흐를 수 없는 자리이므로 자르는
    // 대신 줄인다(말줄임은 그래도 최후 안전망으로 남긴다).
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
    val actionLabelScale = fitToWidthScale(maxWidth, 392.dp, minimumScale = 0.7f)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(
            onClick = onCancel,
            enabled = !isSaving,
            modifier = Modifier.weight(1f),
            shape = WakerButtonShape,
        ) {
            Text(
                text = stringResource(R.string.editor_cancel),
                fontSize = LocalTextStyle.current.fontSize * actionLabelScale,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Button(
            onClick = onSave,
            enabled = canSave && !isSaving,
            colors = wakerButtonColors(),
            modifier = Modifier.weight(1f),
            shape = WakerButtonShape,
        ) {
            // 저장 진행은 **누른 그 버튼 위에서** 보여준다. 예전엔 목소리 카드에 '준비하는
            // 중이에요' 한 줄이 떴는데, 방금 누른 곳에서 멀어 눌리긴 한 건지 알기 어려웠다.
            // 스피너는 텍스트 왼쪽에 두고 폭은 weight(1f) 로 고정돼 있어 버튼이 튀지 않는다.
            if (isSaving) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    // 비활성 상태의 흐린 라벨색을 그대로 따라간다(색을 새로 박지 않는다).
                    color = LocalContentColor.current,
                )
                Spacer(Modifier.width(8.dp))
            }
            Text(
                text = when {
                    isSaving -> stringResource(R.string.editor_saving)
                    recipientName != null -> stringResource(R.string.editor_save_for, recipientName)
                    else -> stringResource(R.string.editor_save)
                },
                fontSize = LocalTextStyle.current.fontSize * actionLabelScale,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
    }
}
