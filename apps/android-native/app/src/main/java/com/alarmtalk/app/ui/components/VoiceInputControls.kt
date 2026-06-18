package com.alarmtalk.app

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
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import com.alarmtalk.app.R
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

internal fun voicePreviewContentDescription(
    context: android.content.Context,
    active: Boolean,
    preparing: Boolean,
): String = when {
    preparing -> context.getString(R.string.misc2_voice_preview_preparing)
    active -> context.getString(R.string.misc2_voice_preview_pause)
    else -> context.getString(R.string.misc2_voice_preview_play)
}

@Composable
internal fun VoicePreviewButtonIcon(
    active: Boolean,
    preparing: Boolean,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    if (preparing) {
        CircularProgressIndicator(
            modifier = modifier
                .size(20.dp)
                .semantics {
                    contentDescription = voicePreviewContentDescription(context, active = active, preparing = true)
                },
            strokeWidth = 2.dp,
        )
    } else {
        Icon(
            imageVector = if (active) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
            contentDescription = voicePreviewContentDescription(context, active = active, preparing = false),
            modifier = modifier.size(22.dp),
        )
    }
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
            label = stringResource(R.string.common_voice_capture_mode_record),
            selected = selected == VoiceCaptureMode.Record,
            enabled = enabled,
            onClick = { onSelect(VoiceCaptureMode.Record) },
            modifier = Modifier.weight(1f),
        )
        VoiceInputModeButton(
            label = stringResource(R.string.common_voice_capture_mode_file),
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
                contentDescription = if (isRecording) {
                    stringResource(R.string.common_voice_record_stop)
                } else {
                    stringResource(R.string.common_voice_record_start)
                },
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
    noticeAfterUpload: Boolean = false,
    isPreviewActive: Boolean = false,
    isPreviewPreparing: Boolean = false,
    onPickFile: () -> Unit,
    onCropChange: (Long, Long) -> Unit,
    onPreviewCrop: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // 업로드 후에만 의미 있는 안내(자를 구간 선택 등)는 파일 선택 전까지 숨긴다.
        if (!noticeAfterUpload) {
            MutedText(notice)
        }
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
            if (noticeAfterUpload) {
                MutedText(notice)
            }
            AudioCropRangeSelector(
                durationMillis = duration,
                cropStartMillis = cropStartMillis,
                cropEndMillis = cropEndMillis,
                minDurationMillis = minDurationMillis,
                maxDurationMillis = maxDurationMillis,
                isPreviewActive = isPreviewActive,
                isPreviewPreparing = isPreviewPreparing,
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
    isPreviewActive: Boolean = false,
    isPreviewPreparing: Boolean = false,
    onCropChange: (Long, Long) -> Unit,
    onPreviewCrop: () -> Unit,
) {
    val safeDuration = durationMillis.coerceAtLeast(1L)
    val safeStart = cropStartMillis.coerceIn(0L, safeDuration)
    val safeEnd = cropEndMillis.coerceIn(safeStart, safeDuration)
    val selectedDuration = (safeEnd - safeStart).coerceAtLeast(0L)

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
                MutedText(
                    stringResource(
                        R.string.common_voice_crop_selected_total,
                        audioTimeLabel(selectedDuration),
                        audioTimeLabel(safeDuration),
                    ),
                )
            }
            OutlinedButton(
                onClick = onPreviewCrop,
                enabled = selectedDuration > 0L,
            ) {
                VoicePreviewButtonIcon(
                    active = isPreviewActive,
                    preparing = isPreviewPreparing,
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
        modifier = Modifier
            .fillMaxWidth(0.72f)
            .height(48.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val resolvedLevel = if (active) level else 0.1f + (index % 4) * 0.04f
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height((8 + resolvedLevel * 36).dp)
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
