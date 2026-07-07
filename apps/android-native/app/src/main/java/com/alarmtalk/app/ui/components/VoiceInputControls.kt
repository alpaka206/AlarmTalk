package com.alarmtalk.app

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloat
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerPillShape
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

internal data class AudioCropRange(
    val startMillis: Long,
    val endMillis: Long,
)

internal fun constrainedAudioCropRange(
    currentStartMillis: Long,
    currentEndMillis: Long,
    rawStartMillis: Long,
    rawEndMillis: Long,
    durationMillis: Long,
    minDurationMillis: Long,
    maxDurationMillis: Long,
): AudioCropRange {
    val safeDuration = durationMillis.coerceAtLeast(1L)
    val safeStart = currentStartMillis.coerceIn(0L, safeDuration)
    val safeEnd = currentEndMillis.coerceIn(safeStart, safeDuration)
    val rawStart = rawStartMillis.coerceIn(0L, safeDuration)
    val rawEnd = rawEndMillis.coerceIn(0L, safeDuration)
    val safeMinDuration = minDurationMillis.coerceAtLeast(0L).coerceAtMost(safeDuration)
    val safeMaxDuration = maxDurationMillis.coerceAtLeast(safeMinDuration).coerceAtMost(safeDuration)
    val movingEnd = abs(rawEnd - safeEnd) >= abs(rawStart - safeStart)

    return if (movingEnd) {
        val lowerBound = (safeStart + safeMinDuration).coerceAtMost(safeDuration)
        val upperBound = (safeStart + safeMaxDuration).coerceIn(lowerBound, safeDuration)
        AudioCropRange(safeStart, rawEnd.coerceIn(lowerBound, upperBound))
    } else {
        val lowerBound = (safeEnd - safeMaxDuration).coerceAtLeast(0L)
        val upperBound = (safeEnd - safeMinDuration).coerceAtLeast(lowerBound)
        AudioCropRange(rawStart.coerceIn(lowerBound, upperBound), safeEnd)
    }
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
            shape = WakerPillShape,
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
            shape = WakerPillShape,
        ) {
            Text(label)
        }
    }
}

/**
 * 녹음 컨트롤 — 시간·파형·마이크 버튼을 한 카드에 담는다.
 * [recordedDurationMillis] 가 있으면(녹음 완료) 완료 배지와 미리듣기 버튼을 함께 보여준다.
 * 알람 에디터(VoiceAudioCard)와 목소리 만들기(VoiceProfileManagementPanel)가 공용으로 쓴다.
 */
@Composable
internal fun VoiceRecordControls(
    isRecording: Boolean,
    elapsedMillis: Long,
    maxDurationMillis: Long,
    levels: List<Float>,
    enabled: Boolean,
    notice: String,
    onRecordClick: () -> Unit,
    recordedDurationMillis: Long? = null,
    isRecordedPreviewActive: Boolean = false,
    isRecordedPreviewPreparing: Boolean = false,
    onPreviewRecording: (() -> Unit)? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerCardShape,
        color = MaterialTheme.colorScheme.surface,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            MutedText(notice)
            Row {
                Text(
                    text = audioTimeLabel(elapsedMillis),
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = if (isRecording) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    modifier = Modifier.alignByBaseline(),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = "/ ${audioTimeLabel(maxDurationMillis)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.alignByBaseline(),
                )
            }
            VoiceLevelBars(levels = levels, active = isRecording)
            Box(contentAlignment = Alignment.Center) {
                RecordPulseRing(active = isRecording)
                Button(
                    onClick = onRecordClick,
                    enabled = enabled,
                    modifier = Modifier.size(84.dp),
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
                        imageVector = if (isRecording) Icons.Outlined.Stop else Icons.Outlined.Mic,
                        contentDescription = if (isRecording) {
                            stringResource(R.string.common_voice_record_stop)
                        } else {
                            stringResource(R.string.common_voice_record_start)
                        },
                        modifier = Modifier.size(32.dp),
                    )
                }
            }
            if (recordedDurationMillis != null && !isRecording) {
                Surface(
                    shape = WakerPillShape,
                    color = MaterialTheme.colorScheme.secondaryContainer,
                ) {
                    Row(
                        modifier = Modifier.padding(
                            start = 14.dp,
                            end = if (onPreviewRecording != null) 4.dp else 14.dp,
                        ),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.CheckCircle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            text = stringResource(
                                R.string.voices_record_done_duration,
                                audioTimeLabel(recordedDurationMillis),
                            ),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.padding(vertical = 9.dp),
                        )
                        if (onPreviewRecording != null) {
                            IconButton(
                                onClick = onPreviewRecording,
                                modifier = Modifier.size(34.dp),
                            ) {
                                VoicePreviewButtonIcon(
                                    active = isRecordedPreviewActive,
                                    preparing = isRecordedPreviewPreparing,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 녹음 중 마이크 버튼 뒤에서 퍼져 나가는 링 애니메이션. */
@Composable
private fun RecordPulseRing(active: Boolean) {
    if (!active) return
    val transition = rememberInfiniteTransition(label = "recordPulse")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 1400, easing = LinearEasing)),
        label = "recordPulseProgress",
    )
    val ringColor = MaterialTheme.colorScheme.error
    Box(
        modifier = Modifier
            .size(84.dp)
            .graphicsLayer {
                val scale = 1f + progress * 0.45f
                scaleX = scale
                scaleY = scale
                alpha = (1f - progress) * 0.32f
            }
            .background(ringColor, CircleShape),
    )
}

/**
 * 파일 업로드 컨트롤 — 업로드 존(파일 선택 전/후 상태 표시)과 자르기 카드.
 * [uploadSubtitle] 은 파일 선택 전 업로드 존에 보일 보조 설명(없으면 생략).
 */
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
    uploadSubtitle: String? = null,
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
        Surface(
            onClick = onPickFile,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth(),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            border = wakerCardBorder(),
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(52.dp)
                        .background(MaterialTheme.colorScheme.secondaryContainer, WakerTileShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = if (durationMillis == null) {
                            Icons.Outlined.UploadFile
                        } else {
                            Icons.Outlined.AudioFile
                        },
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.size(28.dp),
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        text = if (durationMillis == null) {
                            uploadLabel
                        } else {
                            stringResource(R.string.voices_file_selected)
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    val subtitle = if (durationMillis == null) {
                        uploadSubtitle
                    } else {
                        stringResource(R.string.voices_upload_change_hint)
                    }
                    if (subtitle != null) {
                        MutedText(subtitle)
                    }
                }
                if (durationMillis != null) {
                    Surface(
                        shape = WakerPillShape,
                        color = MaterialTheme.colorScheme.secondaryContainer,
                    ) {
                        Text(
                            text = audioTimeLabel(durationMillis),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                        )
                    }
                }
            }
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

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.38f),
        border = wakerCardBorder(0.7f),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.voices_crop_section_title),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                Surface(
                    shape = WakerPillShape,
                    color = MaterialTheme.colorScheme.secondaryContainer,
                ) {
                    Text(
                        text = audioTimeLabel(selectedDuration),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
            RangeSlider(
                value = safeStart.toFloat()..safeEnd.toFloat(),
                onValueChange = { range ->
                    val cropRange = constrainedAudioCropRange(
                        currentStartMillis = safeStart,
                        currentEndMillis = safeEnd,
                        rawStartMillis = range.start.roundToLong(),
                        rawEndMillis = range.endInclusive.roundToLong(),
                        durationMillis = safeDuration,
                        minDurationMillis = minDurationMillis,
                        maxDurationMillis = maxDurationMillis,
                    )
                    onCropChange(cropRange.startMillis, cropRange.endMillis)
                },
                valueRange = 0f..safeDuration.toFloat(),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                MutedText(audioTimeLabel(safeStart))
                MutedText(audioTimeLabel(safeEnd))
            }
            OutlinedButton(
                onClick = onPreviewCrop,
                enabled = selectedDuration > 0L,
                modifier = Modifier.fillMaxWidth(),
                shape = WakerButtonShape,
                border = wakerCardBorder(),
                colors = wakerOutlinedButtonColors(),
            ) {
                VoicePreviewButtonIcon(
                    active = isPreviewActive,
                    preparing = isPreviewPreparing,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (isPreviewActive) {
                        stringResource(R.string.voicesr_pause)
                    } else {
                        stringResource(R.string.voicesr_preview)
                    },
                )
            }
        }
    }
}

@Composable
internal fun VoiceLevelBars(
    levels: List<Float>,
    active: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth(0.78f)
            .height(52.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val target = if (active) level else 0.1f + (index % 4) * 0.04f
            // 250ms 마다 갱신되는 레벨을 부드럽게 이어 붙인다.
            val animatedLevel by animateFloatAsState(
                targetValue = target,
                animationSpec = tween(durationMillis = 220),
                label = "voiceLevelBar$index",
            )
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height((6 + animatedLevel * 40).dp)
                    .background(
                        if (active) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.outlineVariant
                        },
                        WakerPillShape,
                    ),
            )
        }
    }
}
