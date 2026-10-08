package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.VoiceTuning
import java.util.Locale
import kotlin.math.abs

/**
 * 등록 미리듣기의 **목소리 높이** 카드 — 제목 줄(목소리 높이 · 값), 설명, 막대(0.5 반음 눈금), '추천값'·'0으로'.
 * 구성은 iOS `VoicePreviewConfirmView.tuningCard` 와 같다(2026-10-07 사용자: 이 카드는 아이폰 구성에 맞춘다).
 * 음량·굵기는 같은 날 뺐다(`VoiceTuning` 주석).
 *
 * 높이는 몸집을 두고 바꾸는 처리라 재생 중에 걸 수 없다 — 손을 떼면 [onAdjustFinished] 가 그 높이로 미리듣기를
 * 메모리에서 굽고([rendering] 동안 진행 표시) 처음부터 다시 튼다. 고른 값은 등록 확정 때 서버에 한 번 보내고,
 * 서버가 이 목소리로 만드는 알람 소리에 굽는다(스펙 voice-and-message §4-3).
 *
 * @param suggestion 자동 추천값. null 이면 아직 계산 중이다([analyzing]).
 */
@Composable
internal fun VoiceTuningCard(
    tuning: VoiceTuning,
    suggestion: VoiceTuning?,
    analyzing: Boolean,
    rendering: Boolean,
    enabled: Boolean,
    onTuningChange: (VoiceTuning) -> Unit,
    onAdjustFinished: () -> Unit,
    onAutoAdjust: () -> Unit,
    onReset: () -> Unit,
) {
    OutlinedCard(
        shape = WakerPanelShape,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = stringResource(R.string.voices_tuning_pitch),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (analyzing || rendering) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                    )
                }
                Text(
                    text = stringResource(R.string.voices_tuning_pitch_value, signedTuningValue(tuning.pitchSemitones)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Text(
                text = when {
                    analyzing -> stringResource(R.string.voices_tuning_analyzing)
                    rendering -> stringResource(R.string.voices_tuning_rendering)
                    else -> stringResource(R.string.voices_tuning_desc)
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            WakerStepSlider(
                value = tuning.pitchSemitones.coerceIn(VoiceTuning.PITCH_RANGE.start, VoiceTuning.PITCH_RANGE.endInclusive),
                onValueChange = {
                    val snapped = VoiceTuning.snapToStep(it, VoiceTuning.PITCH_RANGE)
                    onTuningChange(tuning.copy(pitchSemitones = snapped, source = VoiceTuning.SOURCE_MANUAL))
                },
                onValueChangeFinished = { onAdjustFinished() },
                valueRange = VoiceTuning.PITCH_RANGE,
                stepSize = VoiceTuning.STEP,
                enabled = enabled,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(
                    onClick = onAutoAdjust,
                    enabled = enabled && suggestion != null && !tuning.sameValuesAs(suggestion),
                ) {
                    Text(
                        text = stringResource(R.string.voices_tuning_suggested),
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                // 0 으로 되돌리기 — 막대를 정확히 0 에 맞추기 어렵다.
                TextButton(
                    onClick = onReset,
                    enabled = enabled && !tuning.isNeutral,
                ) {
                    Text(
                        text = stringResource(R.string.voices_tuning_reset),
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
        }
    }
}

/** "+3.5" / "−1.5" / "0" — 부호를 늘 보인다(0 기준 위·아래가 한눈에 보이게). */
private fun signedTuningValue(value: Float): String {
    if (value == 0f) return "0"
    val sign = if (value > 0f) "+" else "−"
    return sign + String.format(Locale.US, "%.1f", abs(value))
}
