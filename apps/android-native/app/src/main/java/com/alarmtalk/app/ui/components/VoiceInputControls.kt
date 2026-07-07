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
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
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
 * 녹음 컨트롤 — [마이크 버튼 | 상태 2줄 | 경과 시간] 한 줄 카드.
 * 녹음이 끝나면 상태 줄이 "녹음 완료 · 길이"로 바뀌고 우측이 미리듣기 버튼이 된다.
 * 알람 에디터(VoiceAudioCard)와 목소리 만들기(VoiceProfileManagementPanel)가 공용으로 쓴다.
 */
@Composable
internal fun VoiceRecordControls(
    isRecording: Boolean,
    elapsedMillis: Long,
    maxDurationMillis: Long,
    level: Float,
    enabled: Boolean,
    notice: String,
    onRecordClick: () -> Unit,
    recordedDurationMillis: Long? = null,
    isRecordedPreviewActive: Boolean = false,
    isRecordedPreviewPreparing: Boolean = false,
    onPreviewRecording: (() -> Unit)? = null,
) {
    val recordingDone = recordedDurationMillis != null && !isRecording
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerCardShape,
        color = MaterialTheme.colorScheme.surface,
        border = wakerCardBorder(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(contentAlignment = Alignment.Center) {
                RecordPulseRing(active = isRecording)
                Button(
                    onClick = onRecordClick,
                    enabled = enabled,
                    modifier = Modifier.size(56.dp),
                    shape = CircleShape,
                    contentPadding = ButtonDefaults.ContentPadding,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                ) {
                    Icon(
                        imageVector = if (isRecording) Icons.Outlined.Stop else Icons.Outlined.Mic,
                        contentDescription = if (isRecording) {
                            stringResource(R.string.common_voice_record_stop)
                        } else {
                            stringResource(R.string.common_voice_record_start)
                        },
                        modifier = Modifier.size(26.dp),
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = when {
                            isRecording -> stringResource(R.string.common_voice_record_status_recording)
                            recordedDurationMillis != null -> stringResource(
                                R.string.voices_record_done_duration,
                                audioTimeLabel(recordedDurationMillis),
                            )
                            else -> stringResource(R.string.common_voice_record_status_idle)
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    // 실제 마이크 진폭 표시 — 애니메이션만으로는 마이크가 죽어 있어도
                    // 티가 안 나므로, 입력이 들어오는지 여기서 바로 확인할 수 있게 한다.
                    if (isRecording) {
                        RecordingLevelBars(level = level)
                    }
                }
                MutedText(
                    if (recordingDone) {
                        stringResource(R.string.common_voice_record_again_hint)
                    } else {
                        notice
                    },
                )
            }
            if (recordingDone && onPreviewRecording != null) {
                IconButton(
                    onClick = onPreviewRecording,
                    modifier = Modifier.size(44.dp),
                ) {
                    VoicePreviewButtonIcon(
                        active = isRecordedPreviewActive,
                        preparing = isRecordedPreviewPreparing,
                    )
                }
            } else {
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = audioTimeLabel(elapsedMillis),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = if (isRecording) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    Text(
                        text = "/ ${audioTimeLabel(maxDurationMillis)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** 실제 마이크 입력 진폭을 따라 움직이는 미니 레벨 바 — 녹음 상태 텍스트 옆에 붙는다. */
@Composable
private fun RecordingLevelBars(level: Float) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        listOf(0.55f, 1f, 0.75f, 0.4f).forEachIndexed { index, scale ->
            // 250ms 마다 갱신되는 진폭을 부드럽게 이어 붙인다.
            val animatedLevel by animateFloatAsState(
                targetValue = (level * scale).coerceIn(0.1f, 1f),
                animationSpec = tween(durationMillis = 220),
                label = "recordingLevelBar$index",
            )
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height((3 + animatedLevel * 11).dp)
                    .background(MaterialTheme.colorScheme.primary, WakerPillShape),
            )
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
    val ringColor = MaterialTheme.colorScheme.primary
    Box(
        modifier = Modifier
            .size(56.dp)
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
                // 선행 아이콘 배지 없이 [제목/설명 … 길이 배지] — 리스트 행 미니멀 규칙과 동일.
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
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

