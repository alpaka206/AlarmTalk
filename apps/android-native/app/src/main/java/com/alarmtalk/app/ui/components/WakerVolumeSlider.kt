package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp

/**
 * 음량 슬라이더 — **목소리 크기와 알람음 볼륨이 함께 쓴다.**
 *
 * ⚠ **머티리얼 기본 `Slider` 를 그대로 쓰지 말 것**(2026-08-16 지시 "아이폰처럼").
 * M3 기본형은 `steps` 를 주면 트랙 위에 **눈금 점**을 찍고 손잡이가 **세로 막대(pill)** 다.
 * iOS 슬라이더는 얇은 트랙 + 원형 손잡이뿐이라, 같은 값을 고르는 컨트롤이 두 앱에서
 * 전혀 다른 물건으로 보였다. 눈금은 **동작에는 그대로 살아 있고**(`steps` 인자) 그리지만
 * 않는다 — 10단위로 딱딱 끊기는 감각은 유지된다.
 *
 * ⚠ **눈금을 다시 그리지 말 것.** 값은 옆에 숫자(`100%`)로 이미 나와 있어서, 점을 찍으면
 * 같은 정보를 두 번 말하면서 트랙만 시끄러워진다.
 *
 * 크기는 iOS 기준이다 — 트랙 4dp, 손잡이 20dp(iOS `Slider` 의 knob 이 27pt 지만 그건
 * 그림자를 포함한 지름이고, 눈으로 같은 크기가 20dp 다).
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
internal fun WakerVolumeSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    valueRange: ClosedFloatingPointRange<Float>,
    /**
     * 값이 끊기는 단위(예: 10 → 10·20·…·100). **마디 '개수' 가 아니다.**
     *
     * ⚠ **컴포즈 `Slider(steps=)` 에 이 값을 그대로 넘기지 말 것.** 거긴 양 끝을 뺀
     * **사이 마디 수**라, 10~100 을 10단위로 끊으려면 8 이다(9 를 주면 간격이 9 가 되어
     * 19·28·37… 이 나온다). 실기기에서 슬라이더 가운데를 눌러 **45%** 가 찍히는 것으로
     * 확인했다 — 주석은 "10단위" 라고 적혀 있었지만 실제 값은 그렇지 않았다.
     * iOS 는 `step: 10` 이라 진짜 10단위였고, 그래서 같은 알람이 두 기기에서 다른 숫자로
     * 보였다.
     */
    stepSize: Int,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val span = valueRange.endInclusive - valueRange.start
    val intervals = (span / stepSize).toInt().coerceAtLeast(1)
    // 사이 마디 = 구간 수 - 1.
    val steps = (intervals - 1).coerceAtLeast(0)
    val active = MaterialTheme.colorScheme.primary
    val inactive = MaterialTheme.colorScheme.surfaceVariant
    Slider(
        value = value,
        // ⚠ **반올림해서 올려보낸다.** 호출부가 `toInt()` 로 자르면 46 이 45 로 떨어진다
        // (부동소수 오차). 값이 눈금과 어긋나면 옆 숫자와 슬라이더 위치가 서로 다른 말을 한다.
        onValueChange = { raw ->
            val snapped = valueRange.start +
                (((raw - valueRange.start) / stepSize).let { Math.round(it) } * stepSize)
            onValueChange(snapped.coerceIn(valueRange.start, valueRange.endInclusive))
        },
        valueRange = valueRange,
        steps = steps,
        enabled = enabled,
        interactionSource = interactionSource,
        modifier = modifier,
        thumb = {
            Surface(
                modifier = Modifier.size(20.dp),
                shape = CircleShape,
                // ⚠ **손잡이는 흰색이다** — `onPrimary` 는 다크 테마에서 진네이비라
                // 트랙 위에서 '꺼진 점' 처럼 보인다. 스위치 손잡이도 같은 이유로 흰색이다
                // (`AlarmTalkSwitch` 주석 — iOS 시스템 컨트롤에 맞춘 규약).
                color = androidx.compose.ui.graphics.Color.White,
                shadowElevation = 2.dp,
                border = null,
                content = {},
            )
        },
        track = { state ->
            val fraction = if (state.valueRange.endInclusive > state.valueRange.start) {
                (state.value - state.valueRange.start) /
                    (state.valueRange.endInclusive - state.valueRange.start)
            } else {
                0f
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(CircleShape)
                    .background(inactive),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(fraction.coerceIn(0f, 1f))
                        .height(4.dp)
                        .clip(CircleShape)
                        .background(active)
                        .align(Alignment.CenterStart),
                )
            }
        },
        colors = SliderDefaults.colors(
            activeTrackColor = active,
            inactiveTrackColor = inactive,
        ),
    )
}
