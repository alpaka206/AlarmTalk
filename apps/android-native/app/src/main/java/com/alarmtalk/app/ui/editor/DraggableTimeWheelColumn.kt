package com.alarmtalk.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

private val TimeWheelEasing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

@Composable
internal fun DraggableTimeWheelColumn(
    itemHeight: androidx.compose.ui.unit.Dp,
    selectedTextColor: Color,
    unselectedTextColor: Color,
    itemLabel: (Int) -> String,
    maxStepsPerGesture: Int,
    onStep: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val itemHeightPx = with(LocalDensity.current) { itemHeight.toPx() }
    var dragOffsetPx by remember { mutableStateOf(0f) }
    var gestureSteps by remember { mutableIntStateOf(0) }
    var settleJob by remember { mutableStateOf<Job?>(null) }

    fun remainingStepsFor(nextSteps: Int): Int {
        return if (nextSteps > 0) {
            nextSteps.coerceAtMost(maxStepsPerGesture - gestureSteps)
        } else {
            nextSteps.coerceAtLeast(-maxStepsPerGesture - gestureSteps)
        }
    }

    fun flingStepsFor(velocity: Float): Int {
        val minFlingVelocity = itemHeightPx * 4.2f
        if (abs(velocity) < minFlingVelocity) return 0
        val rawSteps = ((abs(velocity) / itemHeightPx) * 0.12f)
            .roundToInt()
            .coerceAtLeast(1)
        return if (velocity < 0f) rawSteps else -rawSteps
    }

    val draggableState = rememberDraggableState { delta ->
        dragOffsetPx += delta
        while (dragOffsetPx <= -itemHeightPx && gestureSteps < maxStepsPerGesture) {
            dragOffsetPx += itemHeightPx
            gestureSteps += 1
            onStep(1)
        }
        while (dragOffsetPx >= itemHeightPx && gestureSteps > -maxStepsPerGesture) {
            dragOffsetPx -= itemHeightPx
            gestureSteps -= 1
            onStep(-1)
        }
        if (gestureSteps >= maxStepsPerGesture && dragOffsetPx < -itemHeightPx * 0.6f) {
            dragOffsetPx = -itemHeightPx * 0.6f
        }
        if (gestureSteps <= -maxStepsPerGesture && dragOffsetPx > itemHeightPx * 0.6f) {
            dragOffsetPx = itemHeightPx * 0.6f
        }
    }

    Box(
        modifier = modifier
            .height(itemHeight * 3)
            .clipToBounds()
            .draggable(
                state = draggableState,
                orientation = Orientation.Vertical,
                onDragStarted = {
                    settleJob?.cancel()
                    gestureSteps = 0
                },
                onDragStopped = { velocity ->
                    val startOffset = dragOffsetPx
                    val snapStep = when {
                        startOffset <= -itemHeightPx * 0.45f -> 1
                        startOffset >= itemHeightPx * 0.45f -> -1
                        else -> 0
                    }
                    val velocitySteps = flingStepsFor(velocity)
                    val requestedSteps = if (velocitySteps != 0) velocitySteps else snapStep
                    val stepsToSettle = remainingStepsFor(requestedSteps)
                    settleJob?.cancel()
                    settleJob = scope.launch {
                        animateWheelSettle(
                            startOffsetPx = startOffset,
                            steps = stepsToSettle,
                            itemHeightPx = itemHeightPx,
                            onStep = onStep,
                            onOffsetChange = { dragOffsetPx = it },
                        )
                        gestureSteps = 0
                    }
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.offset { IntOffset(0, dragOffsetPx.roundToInt()) },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            (-1..1).forEach { offset ->
                val distance = abs(offset)
                val alpha = when (distance) {
                    0 -> 1f
                    1 -> 0.18f
                    else -> 0.08f
                }
                val style = if (distance == 0) {
                    MaterialTheme.typography.displayLarge
                } else {
                    MaterialTheme.typography.displayMedium
                }
                Surface(
                    onClick = {
                        if (offset != 0) {
                            settleJob?.cancel()
                            settleJob = scope.launch {
                                animateWheelSettle(
                                    startOffsetPx = 0f,
                                    steps = offset.coerceIn(-maxStepsPerGesture, maxStepsPerGesture),
                                    itemHeightPx = itemHeightPx,
                                    onStep = onStep,
                                    onOffsetChange = { dragOffsetPx = it },
                                )
                            }
                        }
                    },
                    color = Color.Transparent,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(itemHeight),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = itemLabel(offset),
                            style = style,
                            fontWeight = FontWeight.Bold,
                            color = if (distance == 0) {
                                selectedTextColor
                            } else {
                                unselectedTextColor.copy(alpha = alpha)
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

internal suspend fun animateWheelSettle(
    startOffsetPx: Float,
    steps: Int,
    itemHeightPx: Float,
    onStep: (Int) -> Unit,
    onOffsetChange: (Float) -> Unit,
) {
    if (steps == 0) {
        Animatable(startOffsetPx).animateTo(
            targetValue = 0f,
            animationSpec = tween(durationMillis = 170, easing = TimeWheelEasing),
        ) {
            onOffsetChange(value)
        }
        return
    }

    val direction = if (steps > 0) 1 else -1
    var consumedSteps = 0
    val totalSteps = abs(steps)
    val targetOffset = -steps * itemHeightPx
    val durationMillis = (190 + totalSteps * 42).coerceIn(230, 720)

    Animatable(startOffsetPx).animateTo(
        targetValue = targetOffset,
        animationSpec = tween(durationMillis = durationMillis, easing = TimeWheelEasing),
    ) {
        while (direction > 0 && value <= -(consumedSteps + 1) * itemHeightPx) {
            consumedSteps += 1
            onStep(1)
        }
        while (direction < 0 && value >= (consumedSteps + 1) * itemHeightPx) {
            consumedSteps += 1
            onStep(-1)
        }
        val residualOffset = if (direction > 0) {
            value + consumedSteps * itemHeightPx
        } else {
            value - consumedSteps * itemHeightPx
        }
        onOffsetChange(residualOffset)
    }
    while (consumedSteps < totalSteps) {
        consumedSteps += 1
        onStep(direction)
    }
    onOffsetChange(0f)
}

internal fun floorMod(value: Int, divisor: Int): Int = ((value % divisor) + divisor) % divisor
