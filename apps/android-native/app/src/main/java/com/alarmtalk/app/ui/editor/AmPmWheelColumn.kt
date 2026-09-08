package com.alarmtalk.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

private val AmPmWheelEasing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

@Composable
internal fun AmPmWheelColumn(
    hour: Int,
    itemHeight: androidx.compose.ui.unit.Dp,
    selectedTextColor: Color,
    unselectedTextColor: Color,
    onStep: (Int) -> Unit,
    // 좁은 화면에서 컬럼 고정폭·글자를 함께 줄이는 배율(1f = 그대로).
    textScale: Float,
    /// dp 치수용 배율 — `textScale` 을 dp 에 곱하면 글꼴 배율만큼 상자가 좁아져 글자가 잘린다.
    boxScale: Float = 1f,
) {
    val amPmIndex = if (hour >= 12) 1 else 0
    val isPm = amPmIndex == 1
    val scope = rememberCoroutineScope()
    val itemHeightPx = with(LocalDensity.current) { itemHeight.toPx() }
    // ⚠ **시·분 휠과 같은 톡**(`DraggableTimeWheelColumn` 의 `stepWithTick` 주석).
    // 오전/오후는 한 칸뿐이라 더 잘 느껴진다 — 여기만 무감각하면 같은 컨트롤인데
    // 위아래로 손을 옮길 때 감각이 끊긴다.
    val view = LocalView.current
    fun stepWithTick(step: Int) {
        view.performWheelTick()
        onStep(step)
    }
    var dragOffsetPx by remember { mutableStateOf(0f) }
    var previousAmPmIndex by remember { mutableIntStateOf(amPmIndex) }
    var suppressNextAutoAnimation by remember { mutableStateOf(false) }
    // 정착(굴러가서 멎기) 잡. **손을 다시 대거나 탭하면 취소한다** — 숫자 칼럼
    // (`DraggableTimeWheelColumn`)과 같은 패턴이다. 없으면 정착 두 개가 `dragOffsetPx` 를
    // 놓고 싸워 떨리고, 부모 `onStep` 이 홀짝 토글이라 **두 번 넘겨 제자리**로 돌아온다
    // (탭을 빠르게 두 번 눌러도 같았다). 스펙 §1-1 「굴러가는 중에 손을 대면 그 자리에서 잡힌다」.
    var settleJob by remember { mutableStateOf<Job?>(null) }
    val minOffset = if (isPm) -itemHeightPx * 0.22f else -itemHeightPx * 0.72f
    val maxOffset = if (isPm) itemHeightPx * 0.72f else itemHeightPx * 0.22f
    val amLabel = stringResource(R.string.r3ed_ampm_wheel_am)
    val pmLabel = stringResource(R.string.r3ed_ampm_wheel_pm)
    val rows = if (isPm) {
        listOf(-1 to amLabel, 0 to pmLabel, null to "")
    } else {
        listOf(null to "", 0 to amLabel, 1 to pmLabel)
    }
    val draggableState = rememberDraggableState { delta ->
        dragOffsetPx = (dragOffsetPx + delta).coerceIn(minOffset, maxOffset)
    }

    LaunchedEffect(amPmIndex, itemHeightPx) {
        if (previousAmPmIndex == amPmIndex) return@LaunchedEffect
        previousAmPmIndex = amPmIndex
        if (suppressNextAutoAnimation) {
            suppressNextAutoAnimation = false
            dragOffsetPx = 0f
            return@LaunchedEffect
        }
        val startOffset = if (amPmIndex == 1) itemHeightPx else -itemHeightPx
        Animatable(startOffset).animateTo(
            targetValue = 0f,
            animationSpec = tween(durationMillis = 155, easing = AmPmWheelEasing),
        ) {
            dragOffsetPx = value
        }
        dragOffsetPx = 0f
    }

    Box(
        modifier = Modifier
            .width(96.dp * boxScale)
            .height(itemHeight * 3)
            .clipToBounds()
            .draggable(
                state = draggableState,
                orientation = Orientation.Vertical,
                onDragStarted = { settleJob?.cancel() },
                onDragStopped = { velocity ->
                    val minFlingVelocity = itemHeightPx * 3.5f
                    val requestedStep = when {
                        !isPm && (dragOffsetPx <= -itemHeightPx * 0.38f || velocity < -minFlingVelocity) -> 1
                        isPm && (dragOffsetPx >= itemHeightPx * 0.38f || velocity > minFlingVelocity) -> -1
                        else -> 0
                    }
                    val startOffset = dragOffsetPx
                    settleJob?.cancel()
                    settleJob = scope.launch {
                        animateWheelSettle(
                            startOffsetPx = startOffset,
                            steps = requestedStep,
                            itemHeightPx = itemHeightPx,
                            onStep = { step ->
                                suppressNextAutoAnimation = true
                                stepWithTick(step)
                            },
                            onOffsetChange = { dragOffsetPx = it },
                        )
                    }
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.offset { IntOffset(0, dragOffsetPx.roundToInt()) },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            rows.forEach { (step, label) ->
                val selected = step == 0
                Surface(
                    color = Color.Transparent,
                    shape = WakerTileShape,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(itemHeight)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) {
                            if (step != null && step != 0) {
                                settleJob?.cancel()
                                settleJob = scope.launch {
                                    animateWheelSettle(
                                        // 굴러가던 중이면 그 자리에서 이어 간다 — 0 으로 되감지 않는다.
                                        startOffsetPx = dragOffsetPx,
                                        steps = step,
                                        itemHeightPx = itemHeightPx,
                                        onStep = { selectedStep ->
                                            suppressNextAutoAnimation = true
                                            stepWithTick(selectedStep)
                                        },
                                        onOffsetChange = { dragOffsetPx = it },
                                    )
                                }
                            }
                        },
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = label,
                            fontSize = (if (selected) 38.sp else 32.sp) * textScale,
                            lineHeight = (if (selected) 42.sp else 36.sp) * textScale,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                            color = if (selected) {
                                selectedTextColor
                            } else {
                                unselectedTextColor.copy(alpha = 0.18f)
                            },
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            softWrap = false,
                        )
                    }
                }
            }
        }
    }
}
