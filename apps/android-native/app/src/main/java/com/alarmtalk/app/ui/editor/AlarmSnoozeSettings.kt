package com.alarmtalk.app

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatternLibrary
import com.alarmtalk.app.data.VibrationPatterns

// AlarmFortuneSettings 에서 분리: 음성번역/알람 설정 row/스누즈 설정.

@Composable
internal fun VoiceTranslationSettingsPane(
    voiceLanguage: String,
    onDismiss: () -> Unit,
    onLanguageChange: (String) -> Unit,
) {
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
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "번역 언어",
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
                SnoozeOptionSection(title = "언어") {
                    TtsTranslationLanguages.forEachIndexed { index, (language, label) ->
                        SnoozeRadioRow(
                            label = label,
                            selected = voiceLanguage == language,
                            onClick = { onLanguageChange(language) },
                        )
                        if (index != TtsTranslationLanguages.lastIndex) SnoozeOptionDivider()
                    }
                }
            }
        }
    }
}

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
    vibrator.vibrate(VibrationEffect.createWaveform(VibrationPatternLibrary.waveform(patternName), -1), attributes)
}

@Composable
internal fun AlarmSettingRow(
    title: String,
    subtitle: String,
    icon: ImageVector,
    onClick: () -> Unit,
    trailing: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(38.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.72f),
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(end = 12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
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
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
internal fun AlarmSettingDivider() {
    Box(
        modifier = Modifier
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
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "다시 울림",
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
                            text = if (snoozeEnabled) "사용 중" else "사용 안 함",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (snoozeEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        AlarmTalkSwitch(
                            checked = snoozeEnabled,
                            onCheckedChange = onSnoozeEnabledChange,
                        )
                    }
                }

                SnoozeOptionSection(title = "간격") {
                    SnoozeIntervals.forEachIndexed { index, minutes ->
                        SnoozeRadioRow(
                            label = "${minutes}분",
                            selected = snoozeMinutes == minutes,
                            onClick = { onSnoozeMinutesChange(minutes) },
                        )
                        if (index != SnoozeIntervals.lastIndex) SnoozeOptionDivider()
                    }
                    SnoozeOptionDivider()
                    SnoozeRadioRow(
                        label = if (snoozeMinutes in SnoozeIntervals) {
                            "직접 설정"
                        } else {
                            "직접 설정 · ${snoozeMinutes}분"
                        },
                        selected = snoozeMinutes !in SnoozeIntervals,
                        onClick = {
                            customMinutesText = snoozeMinutes.toString()
                            customIntervalDialogOpen = true
                        },
                    )
                }

                SnoozeOptionSection(title = "반복") {
                    val repeatOptions = listOf(
                        SnoozeRepeatLimits.THREE to "3회",
                        SnoozeRepeatLimits.FIVE to "5회",
                        SnoozeRepeatLimits.FOREVER to "계속 반복",
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
        AlertDialog(
            onDismissRequest = { customIntervalDialogOpen = false },
            title = {
                ModalDialogTitle(
                    title = "간격 직접 설정",
                    onDismiss = { customIntervalDialogOpen = false },
                )
            },
            text = {
                OutlinedTextField(
                    value = customMinutesText,
                    onValueChange = { value ->
                        customMinutesText = value.filter { it.isDigit() }.take(2)
                    },
                    label = { Text("분") },
                    singleLine = true,
                    isError = customMinutesText.isNotBlank() && customMinutes !in 1..60,
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                )
            },
            confirmButton = {
                TextButton(
                    enabled = customMinutes in 1..60,
                    onClick = {
                        onSnoozeMinutesChange(requireNotNull(customMinutes))
                        customIntervalDialogOpen = false
                    },
                ) {
                    Text("적용")
                }
            },
        )
    }
}

@Composable
internal fun SnoozeOptionSection(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 4.dp),
        )
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface,
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
    Surface(
        onClick = onClick,
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CompactSelectionDot(
                selected = selected,
            )
            Spacer(Modifier.width(9.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
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
    Box(
        modifier = Modifier
            .padding(start = 39.dp)
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
internal fun EditorActionButtons(
    isEditing: Boolean,
    isSaving: Boolean,
    canSave: Boolean,
    onSave: () -> Unit,
) {
    Button(
        onClick = onSave,
        enabled = canSave && !isSaving,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerButtonShape,
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
