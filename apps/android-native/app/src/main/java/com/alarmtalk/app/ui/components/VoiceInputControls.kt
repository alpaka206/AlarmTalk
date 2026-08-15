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
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
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
        // 끝 썸을 최대 구간(max)보다 더 오른쪽으로 끌면 막지 않고 창 전체를 오른쪽으로
        // 민다 — 시작 썸이 따라와 선택 길이는 max로 유지된다(파일 끝을 넘지는 못함).
        // min 아래로 줄어들 때만 시작을 고정한 채 끝을 min 지점에 붙인다.
        val newEnd = rawEnd.coerceIn(
            (safeStart + safeMinDuration).coerceAtMost(safeDuration),
            safeDuration,
        )
        val newStart = (newEnd - safeMaxDuration).coerceAtLeast(safeStart)
        AudioCropRange(newStart, newEnd)
    } else {
        // 시작 썸도 대칭 — max보다 더 왼쪽으로 끌면 창 전체를 왼쪽으로 밀어 끝 썸이 따라온다.
        val newStart = rawStart.coerceIn(
            0L,
            (safeEnd - safeMinDuration).coerceAtLeast(0L),
        )
        val newEnd = (newStart + safeMaxDuration).coerceAtMost(safeEnd)
        AudioCropRange(newStart, newEnd)
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
        // 목소리 탭 목록과 같은 전용 벡터(ic_voice_listen/stop_24) — 미리듣기 버튼이
        // 화면마다 다른 아이콘을 쓰지 않게 한 벌로 통일한다. 이 토글은 실제로 '정지'다
        // (다시 누르면 처음부터 재생) — 그래서 일시정지가 아니라 정지 모양을 쓴다.
        Icon(
            painter = painterResource(
                if (active) R.drawable.ic_voice_stop_24 else R.drawable.ic_voice_listen_24,
            ),
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
 * 녹음 컨트롤 — [마이크 버튼 | 상태 | 경과 시간] 한 줄 카드.
 * 녹음이 끝나면 상태 줄이 "녹음 완료 · 길이"로 바뀌고 우측이 미리듣기 버튼이 된다.
 * [notice] 는 상태 아래 보조 안내(없으면 상태 한 줄만 노출).
 * 알람 에디터(VoiceAudioCard)와 목소리 만들기(VoiceProfileManagementPanel)가 공용으로 쓴다.
 */
@Composable
internal fun VoiceRecordControls(
    isRecording: Boolean,
    elapsedMillis: Long,
    maxDurationMillis: Long,
    level: Float,
    enabled: Boolean,
    notice: String? = null,
    // 대기 상태의 "눌러서 녹음 시작" 대신 보여줄 문구 — 마이크 버튼이 행동을 이미
    // 설명하므로, 흐름별 핵심 제약(예: 최소 녹음 길이)을 담을 때 쓴다.
    idleStatusText: String? = null,
    onRecordClick: () -> Unit,
    recordedDurationMillis: Long? = null,
    isRecordedPreviewActive: Boolean = false,
    isRecordedPreviewPreparing: Boolean = false,
    onPreviewRecording: (() -> Unit)? = null,
    /** 녹음물을 비우고 대기 상태로 되돌린다. 주면 '다시 녹음' 버튼이 붙는다. */
    onRedoRecording: (() -> Unit)? = null,
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
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 왼쪽: 지금 무슨 상태인지 + 시간. 오른쪽: 지금 할 수 있는 동작.
            // (2026-08-16 지시로 iOS 녹음 카드와 같은 배치로 맞췄다 — 예전에는 마이크가
            // 왼쪽, 시간이 오른쪽이라 같은 기능이 두 앱에서 반대로 놓여 있었다.)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = when {
                        isRecording -> stringResource(R.string.common_voice_record_status_recording)
                        recordedDurationMillis != null -> stringResource(R.string.voices_record_done)
                        else -> idleStatusText
                            ?: stringResource(R.string.common_voice_record_status_idle)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // 시간은 **항상** 같은 자리에 있다. 예전에는 녹음이 끝나면 이 자리가
                    // 재생 버튼으로 바뀌어 시간이 사라졌다.
                    Text(
                        text = buildAnnotatedString {
                            withStyle(
                                SpanStyle(
                                    color = if (isRecording) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                                ),
                            ) {
                                append(audioTimeLabel(recordedDurationMillis ?: elapsedMillis))
                            }
                            withStyle(SpanStyle(color = MaterialTheme.colorScheme.onSurfaceVariant)) {
                                append(" / ${audioTimeLabel(maxDurationMillis)}")
                            }
                        },
                        style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                    )
                    // 실제 마이크 진폭 — 애니메이션만으로는 마이크가 죽어 있어도 티가 안 난다.
                    if (isRecording) {
                        RecordingLevelBars(level = level)
                    }
                }
                if (!notice.isNullOrBlank() && !recordingDone) {
                    MutedText(notice)
                }
            }
            if (recordingDone) {
                if (onPreviewRecording != null) {
                    VoiceRecordCircleButton(
                        onClick = onPreviewRecording,
                        enabled = enabled,
                        filled = true,
                        contentDescription = stringResource(R.string.common_voice_record_preview),
                    ) {
                        VoicePreviewButtonIcon(
                            active = isRecordedPreviewActive,
                            preparing = isRecordedPreviewPreparing,
                        )
                    }
                }
                if (onRedoRecording != null) {
                    VoiceRecordCircleButton(
                        onClick = onRedoRecording,
                        enabled = enabled,
                        filled = false,
                        contentDescription = stringResource(R.string.common_voice_record_again),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Refresh,
                            contentDescription = null,
                            modifier = Modifier.size(26.dp),
                        )
                    }
                }
            } else {
                Box(contentAlignment = Alignment.Center) {
                    RecordPulseRing(active = isRecording)
                    VoiceRecordCircleButton(
                        onClick = onRecordClick,
                        enabled = enabled,
                        filled = true,
                        contentDescription = if (isRecording) {
                            stringResource(R.string.common_voice_record_stop)
                        } else {
                            stringResource(R.string.common_voice_record_start)
                        },
                    ) {
                        Icon(
                            // ⚠ 마이크는 하단바 '목소리' 탭과 같은 글리프다(`ic_tab_mic_fill`).
                            painter = if (isRecording) {
                                rememberVectorPainter(Icons.Filled.Stop)
                            } else {
                                painterResource(R.drawable.ic_tab_mic_fill)
                            },
                            contentDescription = null,
                            modifier = Modifier.size(26.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * 녹음 카드의 원형 버튼 — **크기를 여기서만 정한다**(48dp 원 · 글리프 26dp).
 * iOS `RecordingCircleButton` 과 짝이다(거긴 44pt · 20pt — 플랫폼 최소 터치 타깃이 다르다).
 */
@Composable
private fun VoiceRecordCircleButton(
    onClick: () -> Unit,
    enabled: Boolean,
    filled: Boolean,
    contentDescription: String,
    content: @Composable () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(48.dp).semantics { this.contentDescription = contentDescription },
        shape = CircleShape,
        // 기본 ContentPadding(좌우 24dp)은 원형 버튼 안 아이콘을 짓눌러 아주 작게 그린다.
        contentPadding = PaddingValues(0.dp),
        colors = if (filled) {
            ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                contentColor = MaterialTheme.colorScheme.primary,
            )
        },
    ) {
        content()
    }
}

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
            .size(48.dp)
            .graphicsLayer {
                val scale = 1f + progress * 0.45f
                scaleX = scale
                scaleY = scale
                alpha = (1f - progress) * 0.32f
            }
            .background(ringColor, CircleShape),
    )
}

/** 업로드 존의 아이콘 — 빈 상태(드롭존 중앙)와 선택 후(행 선행) 공용. 배경 없이 글리프만. */
@Composable
private fun UploadIcon() {
    Icon(
        imageVector = Icons.Outlined.UploadFile,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(28.dp),
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
            if (durationMillis == null) {
                // 빈 상태: 드롭존 스타일 — 아이콘을 위에 얹고 텍스트까지 가운데 정렬해
                // "여기에 올리는 곳"임을 한눈에 보여준다.
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 22.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    UploadIcon()
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            text = uploadLabel,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center,
                        )
                        if (uploadSubtitle != null) {
                            MutedText(uploadSubtitle)
                        }
                    }
                }
            } else {
                // 파일 선택 후: 아래로 자르기/분리 카드가 이어지므로 업로드 존은 작은
                // "재업로드" 스트립으로 줄인다(아이콘+라벨 한 줄, 가운데).
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.UploadFile,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = stringResource(R.string.voices_reupload),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
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

/** 자르기 슬라이더 썸 위치에 붙는 선택 구간 시간 라벨. */
@Composable
private fun CropThumbLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
        textAlign = TextAlign.Center,
        maxLines = 1,
        softWrap = false,
    )
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
            // 선택 구간의 시작·끝 시간을 슬라이더 썸 위치를 따라 붙여 보여준다 —
            // 썸이 가까워 라벨이 겹치면 하나로 합쳐 구간 가운데에 표시.
            BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                val labelWidth = 48.dp
                // 극단적으로 좁은 창에서 상한이 음수가 되지 않게 0 이상으로 클램프.
                val maxLabelX = (maxWidth - labelWidth).coerceAtLeast(0.dp)
                val startX = (maxWidth * (safeStart.toFloat() / safeDuration) - labelWidth / 2)
                    .coerceIn(0.dp, maxLabelX)
                val endX = (maxWidth * (safeEnd.toFloat() / safeDuration) - labelWidth / 2)
                    .coerceIn(0.dp, maxLabelX)
                if (endX - startX < labelWidth) {
                    val combinedWidth = labelWidth * 2
                    val centerX = ((startX + endX) / 2 + labelWidth / 2 - combinedWidth / 2)
                        .coerceIn(0.dp, (maxWidth - combinedWidth).coerceAtLeast(0.dp))
                    CropThumbLabel(
                        text = "${audioTimeLabel(safeStart)}–${audioTimeLabel(safeEnd)}",
                        modifier = Modifier
                            .offset(x = centerX)
                            .width(combinedWidth),
                    )
                } else {
                    CropThumbLabel(
                        text = audioTimeLabel(safeStart),
                        modifier = Modifier
                            .offset(x = startX)
                            .width(labelWidth),
                    )
                    CropThumbLabel(
                        text = audioTimeLabel(safeEnd),
                        modifier = Modifier
                            .offset(x = endX)
                            .width(labelWidth),
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
            // 파일 전체 타임라인은 0:00 ~ 총 길이로 고정 — 선택 값은 위 썸 라벨이 담당한다.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                MutedText(audioTimeLabel(0L))
                MutedText(audioTimeLabel(safeDuration))
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

