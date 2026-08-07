package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.data.VibrationPatterns


internal val SnoozeIntervals = listOf(5, 10, 15, 30)

// 라벨은 리소스(vibrationLabel)로 해석한다 — 패턴 고유명은 전 로케일 영어 고정.
private val VibrationOptions = listOf(
    VibrationPatterns.DEFAULT,
    VibrationPatterns.STRONG,
    VibrationPatterns.MEDIUM,
    VibrationPatterns.SHORT,
    VibrationPatterns.RISE,
    VibrationPatterns.PULSE,
    VibrationPatterns.BOUNCE,
    VibrationPatterns.DRUMROLL,
    VibrationPatterns.HEARTBEAT,
    VibrationPatterns.TICKTOCK,
    VibrationPatterns.WALTZ,
    VibrationPatterns.ZIGZAG,
    VibrationPatterns.OFF_BEAT,
    VibrationPatterns.RIPPLE,
    VibrationPatterns.SIREN,
    VibrationPatterns.SOFT,
    VibrationPatterns.SOS,
)

// '기본 알람음'이라는 정보량 없는 표기 대신 시스템 기본 알람음의 실제 이름을 보여준다.
// 타이틀 조회는 바인더 호출이라 컴포지션당 한 번만 하고, 실패 시에만 기존 문구로 폴백.
@Composable
internal fun rememberDefaultAlarmSoundTitle(): String {
    val context = LocalContext.current
    val fallback = stringResource(R.string.editor2_default_alarm_sound)
    return remember(context, fallback) {
        runCatching {
            android.media.RingtoneManager.getActualDefaultRingtoneUri(
                context,
                android.media.RingtoneManager.TYPE_ALARM,
            )?.let { uri ->
                android.media.RingtoneManager.getRingtone(context, uri)?.getTitle(context)
            }
        }.getOrNull()?.takeIf { it.isNotBlank() } ?: fallback
    }
}

@Composable
internal fun AlarmSettingsCard(
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    snoozeRepeatLimit: Int,
    vibrationPattern: String,
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
    alarmSoundEnabled: Boolean,
    showAlarmSound: Boolean,
    onSnoozeEnabledChange: (Boolean) -> Unit,
    onSnoozeMinutesChange: (Int) -> Unit,
    onSnoozeRepeatLimitChange: (Int) -> Unit,
    onVibrationEnabledChange: (Boolean) -> Unit,
    onVibrationSelect: (String) -> Unit,
    onAlarmVolumeChange: (Int) -> Unit,
    onAlarmSoundEnabledChange: (Boolean) -> Unit,
    onOpenSnoozeSettings: () -> Unit,
    onOpenVibrationSettings: () -> Unit,
    onOpenAlarmSoundSettings: () -> Unit,
) {
    val context = LocalContext.current
    // 라벨이 없으면(시스템 기본) 실제 기본 알람음 이름으로 보여준다.
    val resolvedAlarmSoundLabel = alarmSoundLabel ?: rememberDefaultAlarmSoundTitle()
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        EditorSectionTitle(stringResource(R.string.editor_detail_settings))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            border = wakerCardBorder(),
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                AlarmSettingRow(
                    title = stringResource(R.string.editor_snooze_title),
                    subtitle = if (snoozeEnabled) {
                        stringResource(R.string.editor_snooze_summary, snoozeMinutes, snoozeRepeatLabel(context, snoozeRepeatLimit))
                    } else {
                        stringResource(R.string.editor_off)
                    },
                    onClick = onOpenSnoozeSettings,
                    trailing = {
                        AlarmTalkSwitch(
                            checked = snoozeEnabled,
                            onCheckedChange = onSnoozeEnabledChange,
                        )
                    },
                )
                AlarmSettingDivider()
                AlarmSettingRow(
                    title = stringResource(R.string.editor_vibration_title),
                    subtitle = vibrationLabel(context, vibrationPattern),
                    onClick = onOpenVibrationSettings,
                    trailing = {
                        AlarmTalkSwitch(
                            checked = vibrationPattern != VibrationPatterns.NONE,
                            onCheckedChange = onVibrationEnabledChange,
                        )
                    },
                )
                if (showAlarmSound) {
                    AlarmSettingDivider()
                    // 알람음 on/off 토글을 이 행에 함께 둔다. 끄면 알람은 계속 울리되(화면·진동·음성)
                    // 톤만 재생하지 않는다. 켜졌을 때만 볼륨·벨소리(부제 요약, 탭 시 상세)를 노출.
                    AlarmSettingRow(
                        title = stringResource(R.string.editor_alarm_sound_title),
                        subtitle = if (alarmSoundEnabled) {
                            alarmSoundSummary(
                                context = context,
                                alarmVolumePercent = alarmVolumePercent,
                                alarmSoundLabel = resolvedAlarmSoundLabel,
                            )
                        } else {
                            stringResource(R.string.editor_off)
                        },
                        onClick = onOpenAlarmSoundSettings,
                        trailing = {
                            AlarmTalkSwitch(
                                checked = alarmSoundEnabled,
                                onCheckedChange = onAlarmSoundEnabledChange,
                            )
                        },
                    )
                }
                // ⚠ **'목소리' 행을 여기에 다시 넣지 말 것.** 음량·반복은 목소리 카드 안의
                // '목소리 크기' 행(`VoiceVolumeSummaryRow`)이 소유한다. 예전에는 이곳에도
                // 같은 행이 있었고, 호출부가 `showVoiceOutput = false` 로 꺼 둔 채로
                // 남아 있었다 — 살아있는 코드처럼 보이는 죽은 분기였다(2026-08-07 삭제).
            }
        }
    }
}

private fun alarmVolumeLabel(context: android.content.Context, value: Int): String =
    if (value <= 0) context.getString(R.string.editor2_silent) else "${value.coerceIn(0, 100)}%"

private fun alarmSoundSummary(
    context: android.content.Context,
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
): String =
    if (alarmVolumePercent <= 0) {
        context.getString(R.string.editor2_silent)
    } else {
        context.getString(
            R.string.editor2_alarm_sound_summary,
            alarmSoundLabel ?: context.getString(R.string.editor2_default_alarm_sound),
            alarmVolumeLabel(context, alarmVolumePercent),
        )
    }

@Composable
private fun AlarmSoundActionRow(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(12.dp))
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
internal fun AlarmSoundSettingsPane(
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
    onDismiss: () -> Unit,
    onAlarmVolumeChange: (Int) -> Unit,
    onPickAlarmSound: () -> Unit,
) {
    val context = LocalContext.current
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
                        contentDescription = stringResource(R.string.editor_back),
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.editor_alarm_sound_title),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            // 켜고 끄는 사용/무음 토글은 두지 않는다 — 알람음 여부는 '재생 방식'이 정하고,
            // 여기선 어떤 소리를 얼마나 크게 울릴지만 고른다(볼륨 0 = 무음).
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SnoozeOptionSection(title = stringResource(R.string.editor_alarm_sound_title)) {
                    AlarmSoundActionRow(
                        title = stringResource(R.string.editor_alarm_sound_title),
                        subtitle = alarmSoundLabel ?: rememberDefaultAlarmSoundTitle(),
                        onClick = onPickAlarmSound,
                    )
                }

                SnoozeOptionSection(title = stringResource(R.string.editor_volume)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = stringResource(R.string.editor_volume),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = alarmVolumeLabel(context, alarmVolumePercent),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        // ⚠ **0 은 슬라이더로 만들 수 없다.** 0 은 '무음' 이라는 별개의 뜻이라
                        // 위 알람음 스위치로만 표현한다 — 끝값으로 두면 실수로 닿아 알람이
                        // 조용히 안 울리고, 무음으로 가는 길이 둘이 되어 상태를 읽기 어려워진다.
                        Slider(
                            value = alarmVolumePercent.coerceIn(MinAlarmVolumePercent, 100).toFloat(),
                            onValueChange = {
                                onAlarmVolumeChange(it.toInt().coerceIn(MinAlarmVolumePercent, 100))
                            },
                            valueRange = MinAlarmVolumePercent.toFloat()..100f,
                            steps = 8,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun VibrationSettingsPane(
    vibrationPattern: String,
    onDismiss: () -> Unit,
    onVibrationEnabledChange: (Boolean) -> Unit,
    onVibrationSelect: (String) -> Unit,
) {
    val context = LocalContext.current
    val vibrationEnabled = vibrationPattern != VibrationPatterns.NONE
    val selectedPattern = if (vibrationEnabled) vibrationPattern else VibrationPatterns.DEFAULT

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
                        contentDescription = stringResource(R.string.editor_back),
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.editor_vibration_title),
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
                        Text(
                            text = if (vibrationEnabled) stringResource(R.string.editor_in_use) else stringResource(R.string.editor_not_in_use),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (vibrationEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        AlarmTalkSwitch(
                            checked = vibrationEnabled,
                            onCheckedChange = onVibrationEnabledChange,
                        )
                    }
                }

                SnoozeOptionSection {
                    VibrationOptions.forEachIndexed { index, pattern ->
                        SnoozeRadioRow(
                            label = vibrationLabel(context, pattern),
                            selected = selectedPattern == pattern,
                            onClick = {
                                onVibrationEnabledChange(true)
                                onVibrationSelect(pattern)
                                previewVibration(context, pattern)
                            },
                        )
                        if (index != VibrationOptions.lastIndex) {
                            SnoozeOptionDivider()
                        }
                    }
                }
            }
        }
    }
}

internal data class RandomPromptSettingsResult(
    val randomContext: String,
    val weatherCountry: String,
    val weatherCity: String,
    val fortuneGender: String,
    val fortuneBirthDate: String,
    val fortuneBirthTime: String,
    // '직접 입력' 선택 시 다이얼로그에서 받은 문구.
    val manualText: String = "",
)

