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
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.roundToLong

internal enum class VoiceCaptureMode {
    Record,
    File,
}

internal fun audioTimeLabel(millis: Long): String {
    val totalSeconds = (millis / 1000).coerceAtLeast(0L)
    return "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
}

@Composable
internal fun VoiceCaptureModeSelector(
    selected: VoiceCaptureMode,
    onSelect: (VoiceCaptureMode) -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        VoiceInputModeButton(
            label = "녹음",
            selected = selected == VoiceCaptureMode.Record,
            enabled = enabled,
            onClick = { onSelect(VoiceCaptureMode.Record) },
            modifier = Modifier.weight(1f),
        )
        VoiceInputModeButton(
            label = "파일",
            selected = selected == VoiceCaptureMode.File,
            enabled = enabled,
            onClick = { onSelect(VoiceCaptureMode.File) },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
internal fun VoiceInputModeButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    if (selected) {
        Button(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier,
            shape = RoundedCornerShape(999.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.secondary,
                contentColor = MaterialTheme.colorScheme.onSecondary,
            ),
        ) {
            Text(label)
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier,
            shape = RoundedCornerShape(999.dp),
        ) {
            Text(label)
        }
    }
}

@Composable
internal fun VoiceRecordControls(
    isRecording: Boolean,
    elapsedMillis: Long,
    maxDurationMillis: Long,
    levels: List<Float>,
    enabled: Boolean,
    notice: String,
    onRecordClick: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        MutedText(notice)
        Button(
            onClick = onRecordClick,
            enabled = enabled,
            modifier = Modifier.size(92.dp),
            shape = CircleShape,
            contentPadding = ButtonDefaults.ContentPadding,
            colors = ButtonDefaults.buttonColors(
                containerColor = if (isRecording) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.secondary
                },
            ),
        ) {
            Icon(
                imageVector = Icons.Outlined.Mic,
                contentDescription = if (isRecording) "녹음 종료" else "녹음",
                modifier = Modifier.size(34.dp),
            )
        }
        Text(
            text = "${audioTimeLabel(elapsedMillis)} / ${audioTimeLabel(maxDurationMillis)}",
            style = MaterialTheme.typography.titleMedium,
            color = if (isRecording) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            fontWeight = FontWeight.SemiBold,
        )
        VoiceLevelBars(levels = levels, active = isRecording)
        RecordingProgressBar(
            progress = (elapsedMillis.toFloat() / maxDurationMillis.toFloat()).coerceIn(0f, 1f),
            active = isRecording,
        )
    }
}

@Composable
internal fun VoiceFileControls(
    durationMillis: Long?,
    cropStartMillis: Long,
    cropEndMillis: Long,
    minDurationMillis: Long,
    maxDurationMillis: Long,
    enabled: Boolean,
    uploadLabel: String,
    notice: String,
    onPickFile: () -> Unit,
    onCropChange: (Long, Long) -> Unit,
    onPreviewCrop: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        MutedText(notice)
        Button(
            onClick = onPickFile,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
        ) {
            Icon(Icons.Outlined.UploadFile, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(uploadLabel)
        }
        durationMillis?.let { duration ->
            AudioCropRangeSelector(
                durationMillis = duration,
                cropStartMillis = cropStartMillis,
                cropEndMillis = cropEndMillis,
                minDurationMillis = minDurationMillis,
                maxDurationMillis = maxDurationMillis,
                onCropChange = onCropChange,
                onPreviewCrop = onPreviewCrop,
            )
        }
    }
}

@Composable
internal fun AudioCropRangeSelector(
    durationMillis: Long,
    cropStartMillis: Long,
    cropEndMillis: Long,
    minDurationMillis: Long,
    maxDurationMillis: Long,
    onCropChange: (Long, Long) -> Unit,
    onPreviewCrop: () -> Unit,
) {
    val safeDuration = durationMillis.coerceAtLeast(1L)
    val safeStart = cropStartMillis.coerceIn(0L, safeDuration)
    val safeEnd = cropEndMillis.coerceIn(safeStart, safeDuration)
    val selectedDuration = (safeEnd - safeStart).coerceAtLeast(0L)
    val waveform = remember(safeDuration) {
        List(40) { index ->
            0.18f + ((index * 17) % 31) / 40f
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(
                    text = "${audioTimeLabel(safeStart)} - ${audioTimeLabel(safeEnd)}",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText("선택 ${audioTimeLabel(selectedDuration)} / 전체 ${audioTimeLabel(safeDuration)}")
            }
            OutlinedButton(onClick = onPreviewCrop, enabled = selectedDuration > 0L) {
                Icon(Icons.Outlined.PlayArrow, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("듣기")
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp))
                .padding(horizontal = 8.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            waveform.forEachIndexed { index, level ->
                val point = safeDuration * index / waveform.lastIndex.coerceAtLeast(1)
                val selected = point in safeStart..safeEnd
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height((12 + level * 34).dp)
                        .background(
                            if (selected) {
                                MaterialTheme.colorScheme.secondary
                            } else {
                                MaterialTheme.colorScheme.outline
                            },
                            RoundedCornerShape(999.dp),
                        ),
                )
            }
        }
        RangeSlider(
            value = safeStart.toFloat()..safeEnd.toFloat(),
            onValueChange = { range ->
                val rawStart = range.start.roundToLong().coerceIn(0L, safeDuration)
                val rawEnd = range.endInclusive.roundToLong().coerceIn(0L, safeDuration)
                val movingEnd = abs(rawEnd - safeEnd) >= abs(rawStart - safeStart)
                var nextStart = rawStart.coerceAtMost(rawEnd)
                var nextEnd = rawEnd.coerceAtLeast(nextStart)
                val selected = nextEnd - nextStart
                if (selected > maxDurationMillis) {
                    if (movingEnd) {
                        nextStart = (nextEnd - maxDurationMillis).coerceAtLeast(0L)
                    } else {
                        nextEnd = (nextStart + maxDurationMillis).coerceAtMost(safeDuration)
                    }
                }
                if (nextEnd - nextStart < minDurationMillis) {
                    if (movingEnd) {
                        nextStart = (nextEnd - minDurationMillis).coerceAtLeast(0L)
                        if (nextEnd - nextStart < minDurationMillis) {
                            nextEnd = (nextStart + minDurationMillis).coerceAtMost(safeDuration)
                        }
                    } else {
                        nextEnd = (nextStart + minDurationMillis).coerceAtMost(safeDuration)
                        if (nextEnd - nextStart < minDurationMillis) {
                            nextStart = (nextEnd - minDurationMillis).coerceAtLeast(0L)
                        }
                    }
                }
                onCropChange(nextStart, nextEnd)
            },
            valueRange = 0f..safeDuration.toFloat(),
        )
    }
}

@Composable
internal fun VoiceLevelBars(
    levels: List<Float>,
    active: Boolean,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val resolvedLevel = if (active) level else 0.1f + (index % 4) * 0.04f
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height((10 + resolvedLevel * 34).dp)
                    .background(
                        if (active) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.outlineVariant
                        },
                        RoundedCornerShape(999.dp),
                    ),
            )
        }
    }
}

@Composable
private fun RecordingProgressBar(
    progress: Float,
    active: Boolean,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(6.dp)
            .background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(999.dp)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(progress)
                .height(6.dp)
                .background(
                    if (active) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary,
                    RoundedCornerShape(999.dp),
                ),
        )
    }
}
