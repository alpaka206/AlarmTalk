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
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.VoiceTuning
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 등록 미리듣기의 **톤 조절** 카드(시안 A '말로 쓴 막대' — 2026-11-15 오너 "톤 조절은 a로 해도 돼").
 *  - 제목 줄: `톤 조절`(2026-10-08 오너가 정한 이름 그대로 — 시안의 '목소리 높이' 는 그전 이름이라 따르지 않았다) · 지금 값을
 *    **말로**(`조금 높게` 등 — [pitchWordRes]) · 추천값 그대로면 작은 `추천`.
 *    예전에는 `톤 조절` · `+1.5 반음` 이었다 — '반음' 은 낯설고 높아진 건지 바로 읽히지 않았다. 숫자는 읽어 주기에만 남는다.
 *  - 막대: '원래(0)' 에서 손잡이까지만 채우고 그 자리에 눈금(`WakerStepSlider` 의 `fillOrigin`), 아래 한 줄에 `낮게 · 원래 · 높게`.
 *  - 카드 안 하단의 `원래 목소리`·`바꾼 목소리`(예전 `원본 듣기`·`현재 톤 듣기`).
 * (2026-10-08 에 뺀 '추천값'·'0으로' 버튼은 되살리지 않는다 — 시안 A 의 작은 `추천` 글자만 둔다. 키도 옛 것(`voices_tuning_suggested`)과
 * 다른 `voices_tuning_suggested_tag` 다 — `VoiceRegistrationCopyTest` 가 옛 키를 막는다.) 구성은 스펙
 * voice-and-message §4-3 이다 — iOS 는 `VoicePreviewConfirmView` 의 톤 카드가 같은 스펙을 따른다.
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
    // 서버 녹음과 미리듣기로 잰 추천값 — 지금 값이 이것이면 제목 줄에 `추천` 을 단다. 아직 못 쟀으면 null.
    suggestedPitch: Float?,
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
            val words = stringResource(pitchWordRes(tuning.pitchSemitones))
            val spokenValue = stringResource(R.string.voices_tuning_pitch_value, signedTuningValue(tuning.pitchSemitones))
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
                    text = words,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
                if (suggestedPitch != null && suggestedPitch == tuning.pitchSemitones) {
                    Text(
                        text = stringResource(R.string.voices_tuning_suggested_tag),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
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
                    // '원래(0)' 에서 손잡이까지만 채운다 — 높아졌는지 낮아졌는지가 채움 방향으로 보인다.
                    fillOrigin = 0f,
                    // 읽어 주기는 말과 숫자를 함께 — "조금 높게, +1.5 반음".
                    modifier = Modifier.semantics { stateDescription = "$words, $spokenValue" },
                )
                TuningScaleLabels(
                    originFraction = (0f - VoiceTuning.PITCH_RANGE.start) /
                        (VoiceTuning.PITCH_RANGE.endInclusive - VoiceTuning.PITCH_RANGE.start),
                )
            }
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

/**
 * 막대 아래 한 줄 — 왼쪽 끝 `낮게`, '원래(0)' 눈금 바로 아래 `원래`, 오른쪽 끝 `높게`. `원래` 의 가로 자리는 막대가 손잡이
 * 반지름(10)만큼 들여 그리는 트랙 위의 같은 비율이다(`WakerStepSlider` 의 손잡이 20).
 */
@Composable
private fun TuningScaleLabels(originFraction: Float) {
    val style = MaterialTheme.typography.labelSmall
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    Layout(
        content = {
            Text(text = stringResource(R.string.voices_tuning_word_lower), style = style, color = color)
            Text(text = stringResource(R.string.voices_tuning_origin), style = style, color = color)
            Text(text = stringResource(R.string.voices_tuning_word_higher), style = style, color = color)
        },
        modifier = Modifier.fillMaxWidth(),
    ) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0)
        val placed = measurables.map { it.measure(loose) }
        val low = placed[0]
        val origin = placed[1]
        val high = placed[2]
        val width = constraints.maxWidth
        val inset = 10.dp.roundToPx()
        val center = inset + ((width - inset * 2) * originFraction).roundToInt()
        val originX = (center - origin.width / 2)
            .coerceIn(low.width + 4.dp.roundToPx(), (width - high.width - origin.width - 4.dp.roundToPx()).coerceAtLeast(0))
        layout(width, maxOf(low.height, origin.height, high.height)) {
            low.place(0, 0)
            origin.place(originX, 0)
            high.place(width - high.width, 0)
        }
    }
}

/**
 * 높이를 **말로** — 0 은 `원래 높이`, ±2 까지 `조금`, ±4 까지 그냥, 그 너머는 `많이`(두 앱 같은 경계 — iOS
 * `VoicePreviewConfirmView.pitchWord`).
 */
internal fun pitchWordRes(value: Float): Int = when {
    value == 0f -> R.string.voices_tuning_word_original
    value > 0f && value <= 2f -> R.string.voices_tuning_word_slightly_higher
    value > 0f && value <= 4f -> R.string.voices_tuning_word_higher
    value > 0f -> R.string.voices_tuning_word_much_higher
    value >= -2f -> R.string.voices_tuning_word_slightly_lower
    value >= -4f -> R.string.voices_tuning_word_lower
    else -> R.string.voices_tuning_word_much_lower
}
