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
 * 등록 미리듣기의 **목소리 다듬기** 카드 — 목소리 높이 슬라이더 하나(0.5 반음 눈금)와
 * '자동으로 맞추기'(추천값으로 되돌리기). 음량·굵기는 2026-10-07 에 뺐다(`VoiceTuning` 주석).
 *
 * 높이는 몸집을 두고 바꾸는 처리라 재생 중에 걸 수 없다 — 손을 떼면 [onAdjustFinished] 가 그 높이로
 * 사본을 굽고([rendering] 동안 진행 표시) 처음부터 다시 튼다. 저장은 등록 확정 때 한 번이다.
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
) {
    OutlinedCard(
        shape = WakerPanelShape,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.voices_tuning_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                val atSuggestion = suggestion != null && tuning.sameValuesAs(suggestion)
                if (analyzing || rendering) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    TextButton(
                        onClick = onAutoAdjust,
                        enabled = enabled && suggestion != null && !atSuggestion,
                    ) {
                        Text(
                            text = if (atSuggestion) {
                                stringResource(R.string.voices_tuning_auto_applied)
                            } else {
                                stringResource(R.string.voices_tuning_auto)
                            },
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                }
            }
            Text(
                text = if (analyzing) {
                    stringResource(R.string.voices_tuning_analyzing)
                } else if (rendering) {
                    stringResource(R.string.voices_tuning_rendering)
                } else {
                    stringResource(R.string.voices_tuning_desc)
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            VoiceTuningSliderRow(
                label = stringResource(R.string.voices_tuning_pitch),
                valueText = stringResource(R.string.voices_tuning_pitch_value, signedTuningValue(tuning.pitchSemitones)),
                value = tuning.pitchSemitones,
                range = VoiceTuning.PITCH_RANGE,
                enabled = enabled,
                onValueChange = {
                    onTuningChange(tuning.copy(pitchSemitones = it, source = VoiceTuning.SOURCE_MANUAL))
                },
                onValueChangeFinished = { onAdjustFinished() },
            )
        }
    }
}

@Composable
private fun VoiceTuningSliderRow(
    label: String,
    valueText: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    enabled: Boolean,
    onValueChange: (Float) -> Unit,
    onValueChangeFinished: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = valueText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.SemiBold,
            )
        }
        WakerStepSlider(
            value = value.coerceIn(range.start, range.endInclusive),
            onValueChange = { onValueChange(VoiceTuning.snapToStep(it, range)) },
            onValueChangeFinished = { onValueChangeFinished() },
            valueRange = range,
            stepSize = VoiceTuning.STEP,
            enabled = enabled,
        )
    }
}

/** "+3.5" / "−1.5" / "0" — 부호를 늘 보인다(0 기준 위·아래가 한눈에 보이게). */
private fun signedTuningValue(value: Float): String {
    if (value == 0f) return "0"
    val sign = if (value > 0f) "+" else "−"
    return sign + String.format(Locale.US, "%.1f", abs(value))
}
