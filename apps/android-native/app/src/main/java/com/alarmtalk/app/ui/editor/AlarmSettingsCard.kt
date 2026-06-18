package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
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
import com.alarmtalk.app.data.VibrationPatterns

@Composable
internal fun ChipGrid(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    selectedContainerColor: Color? = null,
    selectedLabelColor: Color? = null,
) {
    val chipColors = FilterChipDefaults.filterChipColors(
        selectedContainerColor = selectedContainerColor ?: MaterialTheme.colorScheme.primaryContainer,
        selectedLabelColor = selectedLabelColor ?: MaterialTheme.colorScheme.onPrimaryContainer,
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(3).forEach { rowOptions ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rowOptions.forEach { (value, label) ->
                    FilterChip(
                        selected = selected == value,
                        onClick = { onSelect(value) },
                        colors = chipColors,
                        label = { Text(label) },
                    )
                }
            }
        }
    }
}

internal val SnoozeIntervals = listOf(5, 10, 15, 30)

private val VibrationOptions = listOf(
    VibrationPatterns.DEFAULT to "Basic call",
    VibrationPatterns.STRONG to "Strong",
    VibrationPatterns.SHORT to "Short",
    VibrationPatterns.MEDIUM to "Medium",
    VibrationPatterns.HEARTBEAT to "Heartbeat",
    VibrationPatterns.TICKTOCK to "Ticktock",
    VibrationPatterns.WALTZ to "Waltz",
    VibrationPatterns.ZIGZAG to "Zig-zig-zig",
    VibrationPatterns.OFF_BEAT to "Off-beat",
    VibrationPatterns.RIPPLE to "Ripple",
    VibrationPatterns.SIREN to "Siren",
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
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
            Text(
                text = stringResource(R.string.editor_detail_settings),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(bottom = 6.dp),
            )
            AlarmSettingRow(
                title = stringResource(R.string.editor_snooze_title),
                subtitle = if (snoozeEnabled) {
                    stringResource(R.string.editor_snooze_summary, snoozeMinutes, snoozeRepeatLabel(snoozeRepeatLimit))
                } else {
                    stringResource(R.string.editor_off)
                },
                icon = Icons.Outlined.Snooze,
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
                subtitle = vibrationLabel(vibrationPattern),
                icon = Icons.Outlined.Notifications,
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
                        alarmVolumePercent = alarmVolumePercent,
                        alarmSoundLabel = alarmSoundLabel,
                    ),
                    icon = Icons.Outlined.Alarm,
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
                    subtitle = voiceOutputSummary(voiceVolumePercent, voiceRepeat, voiceRepeatActive),
                    icon = Icons.AutoMirrored.Outlined.VolumeUp,
                    onClick = onOpenVoiceOutputSettings,
                    trailing = {
                        Text(
                            text = ">",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold,
                        )
                    },
                )
            }
        }
}

private fun voiceOutputSummary(
    voiceVolumePercent: Int,
    voiceRepeat: Boolean,
    voiceRepeatActive: Boolean,
): String {
    val volume = "${voiceVolumePercent.coerceIn(0, 100)}%"
    return if (voiceRepeatActive && voiceRepeat) "$volume · 반복" else volume
}

private fun alarmVolumeLabel(value: Int): String =
    if (value <= 0) "무음" else "${value.coerceIn(0, 100)}%"

private fun alarmSoundSummary(
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
): String =
    if (alarmVolumePercent <= 0) {
        "무음"
    } else {
        "${alarmSoundLabel ?: "기본 알람음"} · ${alarmVolumeLabel(alarmVolumePercent)}"
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
            Text(
                text = ">",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
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
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surface,
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
                                text = alarmVolumeLabel(alarmVolumePercent),
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
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surface,
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
                    VibrationOptions.forEachIndexed { index, (pattern, label) ->
                        SnoozeRadioRow(
                            label = label,
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
    val voiceLanguage: String,
    val randomContext: String,
    val weatherCountry: String,
    val weatherCity: String,
    val fortuneGender: String,
    val fortuneBirthDate: String,
    val fortuneBirthTime: String,
)

