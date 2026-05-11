package com.voicealarm.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmAudioLimits
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.SnoozeRepeatLimits
import com.voicealarm.nativeapp.data.VibrationPatterns
import com.voicealarm.nativeapp.data.VoiceSources
import com.voicealarm.nativeapp.network.VoiceProfile

@Composable
internal fun ChipGrid(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(3).forEach { rowOptions ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rowOptions.forEach { (value, label) ->
                    FilterChip(
                        selected = selected == value,
                        onClick = { onSelect(value) },
                        label = { Text(label) },
                    )
                }
            }
        }
    }
}

private val SnoozeIntervals = listOf(3, 5, 10, 15, 30)

private fun nextSnoozeInterval(current: Int): Int =
    SnoozeIntervals.firstOrNull { it > current } ?: SnoozeIntervals.last()

private fun previousSnoozeInterval(current: Int): Int =
    SnoozeIntervals.lastOrNull { it < current } ?: SnoozeIntervals.first()

@Composable
internal fun AlarmSettingsCard(
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    snoozeRepeatLimit: Int,
    vibrationPattern: String,
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
    onSnoozeEnabledChange: (Boolean) -> Unit,
    onSnoozeMinutesChange: (Int) -> Unit,
    onSnoozeRepeatLimitChange: (Int) -> Unit,
    onVibrationEnabledChange: (Boolean) -> Unit,
    onVibrationSelect: (String) -> Unit,
    onAlarmVolumeChange: (Int) -> Unit,
    onPickAlarmSound: () -> Unit,
    onUseDefaultAlarmSound: () -> Unit,
) {
    var detailDialog by remember { mutableStateOf<String?>(null) }
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    onClick = { detailDialog = "snooze" },
                    color = Color.Transparent,
                    modifier = Modifier.weight(1f),
                ) {
                    Column(modifier = Modifier.padding(vertical = 4.dp)) {
                        Text("다시 울림", fontWeight = FontWeight.SemiBold)
                        MutedText(if (snoozeEnabled) "${snoozeMinutes}분 · ${snoozeRepeatLabel(snoozeRepeatLimit)}" else "꺼짐")
                    }
                }
                VoiceAlarmSwitch(
                    checked = snoozeEnabled,
                    onCheckedChange = onSnoozeEnabledChange,
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    onClick = { detailDialog = "vibration" },
                    color = Color.Transparent,
                    modifier = Modifier.weight(1f),
                ) {
                    Column(modifier = Modifier.padding(vertical = 4.dp)) {
                        Text("진동", fontWeight = FontWeight.SemiBold)
                        MutedText(vibrationLabel(vibrationPattern))
                    }
                }
                VoiceAlarmSwitch(
                    checked = vibrationPattern != VibrationPatterns.NONE,
                    onCheckedChange = onVibrationEnabledChange,
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
            Surface(
                onClick = { detailDialog = "sound" },
                color = Color.Transparent,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(vertical = 4.dp)) {
                    Text("알람 소리", fontWeight = FontWeight.SemiBold)
                    MutedText("${alarmSoundLabel ?: "기본 알람음"} · ${alarmVolumeLabel(alarmVolumePercent)}")
                }
            }
        }
    }

    if (detailDialog == "snooze") {
        AlertDialog(
            onDismissRequest = { detailDialog = null },
            title = { Text("다시 울림") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(if (snoozeEnabled) "켜짐" else "꺼짐", fontWeight = FontWeight.SemiBold)
                        VoiceAlarmSwitch(
                            checked = snoozeEnabled,
                            onCheckedChange = onSnoozeEnabledChange,
                        )
                    }
                    StepperField(
                        label = "간격",
                        valueLabel = "${snoozeMinutes}분",
                        onDecrease = {
                            onSnoozeMinutesChange(previousSnoozeInterval(snoozeMinutes))
                        },
                        onIncrease = {
                            onSnoozeMinutesChange(nextSnoozeInterval(snoozeMinutes))
                        },
                    )
                    Text("반복", fontWeight = FontWeight.SemiBold)
                    OptionChips(
                        options = listOf(
                            SnoozeRepeatLimits.THREE.toString() to "3회",
                            SnoozeRepeatLimits.FIVE.toString() to "5회",
                            SnoozeRepeatLimits.FOREVER.toString() to "계속 반복",
                        ),
                        selected = snoozeRepeatLimit.toString(),
                        onSelect = { onSnoozeRepeatLimitChange(it.toInt()) },
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { detailDialog = null }) {
                    Text("완료")
                }
            },
        )
    }

    if (detailDialog == "vibration") {
        AlertDialog(
            onDismissRequest = { detailDialog = null },
            title = { Text("진동") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (vibrationPattern == VibrationPatterns.NONE) "꺼짐" else "켜짐",
                            fontWeight = FontWeight.SemiBold,
                        )
                        VoiceAlarmSwitch(
                            checked = vibrationPattern != VibrationPatterns.NONE,
                            onCheckedChange = onVibrationEnabledChange,
                        )
                    }
                    OptionChips(
                        options = listOf(
                            VibrationPatterns.DEFAULT to "기본",
                            VibrationPatterns.STRONG to "강하게",
                        ),
                        selected = if (vibrationPattern == VibrationPatterns.NONE) {
                            VibrationPatterns.DEFAULT
                        } else {
                            vibrationPattern
                        },
                        onSelect = {
                            onVibrationEnabledChange(true)
                            onVibrationSelect(it)
                        },
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { detailDialog = null }) {
                    Text("완료")
                }
            },
        )
    }

    if (detailDialog == "sound") {
        AlertDialog(
            onDismissRequest = { detailDialog = null },
            title = { Text("알람 소리") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("소리", fontWeight = FontWeight.SemiBold)
                        MutedText(alarmSoundLabel ?: "기본 알람음")
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = onPickAlarmSound,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("선택")
                        }
                        OutlinedButton(
                            onClick = onUseDefaultAlarmSound,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("기본")
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("볼륨 ${alarmVolumeLabel(alarmVolumePercent)}", fontWeight = FontWeight.SemiBold)
                        Slider(
                            value = alarmVolumePercent.toFloat(),
                            onValueChange = { onAlarmVolumeChange(it.toInt().coerceIn(0, 100)) },
                            valueRange = 0f..100f,
                            steps = 9,
                        )
                        MutedText("0%로 두면 소리 없이 진동 설정만 적용돼요.")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { detailDialog = null }) {
                    Text("완료")
                }
            },
        )
    }
}

private fun alarmVolumeLabel(value: Int): String =
    if (value <= 0) "무음" else "${value.coerceIn(0, 100)}%"

@Composable
internal fun EditorActionButtons(
    isEditing: Boolean,
    isSaving: Boolean,
    onCancel: () -> Unit,
    onSave: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OutlinedButton(
            onClick = onCancel,
            enabled = !isSaving,
            modifier = Modifier.weight(1f),
        ) {
            Text("취소")
        }
        Button(
            onClick = onSave,
            enabled = !isSaving,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(16.dp),
        ) {
            Icon(Icons.Outlined.Save, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    isSaving -> "저장 중"
                    isEditing -> "변경사항 저장"
                    else -> "알람 설정하기"
                },
            )
        }
    }
}
