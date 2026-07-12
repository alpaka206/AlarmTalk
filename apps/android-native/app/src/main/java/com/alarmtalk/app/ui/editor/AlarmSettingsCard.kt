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

// 라벨은 로케일별 리소스(vibrationLabel)로 해석한다 — 코드에 언어를 박지 않는다.
private val VibrationOptions = listOf(
    VibrationPatterns.DEFAULT,
    VibrationPatterns.STRONG,
    VibrationPatterns.SHORT,
    VibrationPatterns.MEDIUM,
    VibrationPatterns.HEARTBEAT,
    VibrationPatterns.TICKTOCK,
    VibrationPatterns.WALTZ,
    VibrationPatterns.ZIGZAG,
    VibrationPatterns.OFF_BEAT,
    VibrationPatterns.RIPPLE,
    VibrationPatterns.SIREN,
)

@Composable
internal fun AlarmSettingsCard(
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    snoozeRepeatLimit: Int,
    vibrationPattern: String,
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
    showAlarmSound: Boolean,
    showVoiceOutput: Boolean,
    voiceVolumePercent: Int,
    voiceRepeat: Boolean,
    voiceRepeatActive: Boolean,
    onSnoozeEnabledChange: (Boolean) -> Unit,
    onSnoozeMinutesChange: (Int) -> Unit,
    onSnoozeRepeatLimitChange: (Int) -> Unit,
    onVibrationEnabledChange: (Boolean) -> Unit,
    onVibrationSelect: (String) -> Unit,
    onAlarmVolumeChange: (Int) -> Unit,
    onOpenSnoozeSettings: () -> Unit,
    onOpenVibrationSettings: () -> Unit,
    onOpenAlarmSoundSettings: () -> Unit,
    onOpenVoiceOutputSettings: () -> Unit,
) {
    val context = LocalContext.current
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
                    AlarmSettingRow(
                        title = stringResource(R.string.editor_alarm_sound_title),
                        subtitle = alarmSoundSummary(
                            context = context,
                            alarmVolumePercent = alarmVolumePercent,
                            alarmSoundLabel = alarmSoundLabel,
                        ),
                        onClick = onOpenAlarmSoundSettings,
                        trailing = {
                            AlarmTalkSwitch(
                                checked = alarmVolumePercent > 0,
                                onCheckedChange = { enabled ->
                                    onAlarmVolumeChange(if (enabled) 100 else 0)
                                },
                            )
                        },
                    )
                }
                if (showVoiceOutput) {
                    AlarmSettingDivider()
                    AlarmSettingRow(
                        title = stringResource(R.string.editor_voice_output_title),
                        subtitle = voiceOutputSummary(context, voiceVolumePercent, voiceRepeat, voiceRepeatActive),
                        onClick = onOpenVoiceOutputSettings,
                        trailing = {},
                    )
                }
            }
        }
    }
}

private fun voiceOutputSummary(
    context: android.content.Context,
    voiceVolumePercent: Int,
    voiceRepeat: Boolean,
    voiceRepeatActive: Boolean,
): String {
    val volume = "${voiceVolumePercent.coerceIn(0, 100)}%"
    return if (voiceRepeatActive && voiceRepeat) {
        context.getString(R.string.editor2_voice_output_summary_repeat, volume)
    } else {
        volume
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
    val alarmEnabled = alarmVolumePercent > 0
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
                            text = if (alarmEnabled) stringResource(R.string.editor_in_use) else stringResource(R.string.editor_silent),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (alarmEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        AlarmTalkSwitch(
                            checked = alarmEnabled,
                            onCheckedChange = { enabled ->
                                onAlarmVolumeChange(if (enabled) 100 else 0)
                            },
                        )
                    }
                }

                if (alarmEnabled) {
                    SnoozeOptionSection(title = stringResource(R.string.editor_alarm_sound_title)) {
                        AlarmSoundActionRow(
                            title = stringResource(R.string.editor_alarm_sound_title),
                            subtitle = alarmSoundLabel ?: stringResource(R.string.editor_default_alarm_sound),
                            onClick = onPickAlarmSound,
                        )
                    }
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
                        Slider(
                            value = alarmVolumePercent.toFloat(),
                            onValueChange = { onAlarmVolumeChange(it.toInt().coerceIn(0, 100)) },
                            valueRange = 0f..100f,
                            steps = 9,
                            enabled = alarmEnabled,
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

                SnoozeOptionSection(title = stringResource(R.string.editor_pattern)) {
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

