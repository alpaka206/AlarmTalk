package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.VoiceTuning
import java.util.Locale
import kotlin.math.abs

/**
 * 등록 미리듣기의 **톤 조절** 카드 — 제목 줄(`톤 조절` · 지금 값), 막대(0.5 반음 눈금), 카드 안 하단의 `원본 듣기`·`현재 톤 듣기`
 * 뿐이다(2026-10-08 사용자: 설명 글·'추천값'·'0으로' 를 뺐다 — 막대는 추천값에서 시작하고, 원본과 비교는 `원본 듣기` 가 한다.
 * 0 은 0.5 눈금이라 막대로 맞출 수 있다). 구성은 스펙 voice-and-message §4-3 그대로다 — iOS 는 `VoicePreviewConfirmView` 의
 * 톤 카드가 같은 스펙을 따른다.
 *
 * 높이는 몸집을 두고 바꾸는 처리라 재생 중에 걸 수 없다 — 손을 떼면 [onAdjustFinished] 가 그 높이로 메모리에서 굽고 처음부터
 * 다시 튼다(첫 청취 확인 전 재생 중이면 끝난 뒤). 두 버튼이 무엇을 하는지는 `tuningListenAction` 이 정한다. 고른 값은 등록
 * 확정 때 서버에 한 번 보내고, 서버가 이 목소리로 만드는 알람 소리에 굽는다.
 *
 * @param enabled 막대와 두 버튼을 함께 잠그고 푼다(`confirmStepLocks` 의 `toneEnabled`) — 서버에서 받는 동안에도 살아 있어서,
 *   진행 표시가 도는 버튼을 누르면 받은 뒤에 틀지 않고 다른 버튼을 누르면 받은 뒤에 그것을 튼다.
 * @param listenTarget 지금 트는(또는 준비하는) 버튼. null 이면 아무것도 틀지 않는다.
 * @param listenPreparing [listenTarget] 이 아직 소리를 내기 전이다(서버에서 받는 중·굽는 중) — 그 버튼에 진행 표시.
 */
@Composable
internal fun VoiceTuningCard(
    tuning: VoiceTuning,
    enabled: Boolean,
    listenTarget: TuningListenTarget?,
    listenPreparing: Boolean,
    onTuningChange: (VoiceTuning) -> Unit,
    onAdjustFinished: () -> Unit,
    onListen: (TuningListenTarget) -> Unit,
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
                    text = stringResource(R.string.voices_tuning_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = stringResource(R.string.voices_tuning_pitch_value, signedTuningValue(tuning.pitchSemitones)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
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
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TuningListenButton(
                    label = stringResource(R.string.voices_tuning_listen_original),
                    active = listenTarget == TuningListenTarget.Original,
                    preparing = listenPreparing,
                    enabled = enabled,
                    onClick = { onListen(TuningListenTarget.Original) },
                    modifier = Modifier.weight(1f),
                )
                TuningListenButton(
                    label = stringResource(R.string.voices_tuning_listen_current),
                    active = listenTarget == TuningListenTarget.Current,
                    preparing = listenPreparing,
                    enabled = enabled,
                    onClick = { onListen(TuningListenTarget.Current) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/**
 * 톤 카드의 듣기 버튼 하나. 트는 쪽은 테두리·글자가 강조색이고 아이콘이 정지로 바뀐다 — 준비 중(서버에서 받는 중·굽는 중)이면
 * 그 자리에 진행 표시(`VoicePreviewButtonIcon`). 라벨은 번역이 길면 두 줄로 흐른다(줄이지 않는다 — `fitToWidthScale` 주석의 기준).
 */
@Composable
private fun TuningListenButton(
    label: String,
    active: Boolean,
    preparing: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = MaterialTheme.colorScheme.primary
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = WakerControlHeight),
        shape = WakerButtonShape,
        border = if (active) BorderStroke(1.dp, accent) else wakerCardBorder(),
        colors = if (active) {
            ButtonDefaults.outlinedButtonColors(
                containerColor = accent.copy(alpha = 0.12f),
                contentColor = accent,
                disabledContainerColor = accent.copy(alpha = 0.12f),
                disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            wakerOutlinedButtonColors()
        },
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
    ) {
        VoicePreviewButtonIcon(active = active, preparing = active && preparing)
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            textAlign = TextAlign.Center,
        )
    }
}

/** "+3.5" / "−1.5" / "0" — 부호를 늘 보인다(0 기준 위·아래가 한눈에 보이게). */
private fun signedTuningValue(value: Float): String {
    if (value == 0f) return "0"
    val sign = if (value > 0f) "+" else "−"
    return sign + String.format(Locale.US, "%.1f", abs(value))
}
