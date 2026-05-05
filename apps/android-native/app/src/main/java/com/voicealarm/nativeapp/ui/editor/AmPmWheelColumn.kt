package com.voicealarm.nativeapp

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
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
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

@Composable
internal fun AmPmWheelColumn(
    hour: Int,
    itemHeight: androidx.compose.ui.unit.Dp,
    selectedTextColor: Color,
    unselectedTextColor: Color,
    onStep: (Int) -> Unit,
) {
    val amPmIndex = if (hour >= 12) 1 else 0
    val isPm = amPmIndex == 1
    val scope = rememberCoroutineScope()
    val itemHeightPx = with(LocalDensity.current) { itemHeight.toPx() }
    var dragOffsetPx by remember { mutableStateOf(0f) }
    val minOffset = if (isPm) -itemHeightPx * 0.22f else -itemHeightPx * 0.72f
    val maxOffset = if (isPm) itemHeightPx * 0.72f else itemHeightPx * 0.22f
    val rows = if (isPm) {
        listOf(-1 to "오전", 0 to "오후", null to "")
    } else {
        listOf(null to "", 0 to "오전", 1 to "오후")
    }
    val draggableState = rememberDraggableState { delta ->
        dragOffsetPx = (dragOffsetPx + delta).coerceIn(minOffset, maxOffset)
    }

    Box(
        modifier = Modifier
            .width(96.dp)
            .height(itemHeight * 3)
            .clipToBounds()
            .draggable(
                state = draggableState,
                orientation = Orientation.Vertical,
                onDragStopped = { velocity ->
                    val minFlingVelocity = itemHeightPx * 3.5f
                    val requestedStep = when {
                        !isPm && (dragOffsetPx <= -itemHeightPx * 0.38f || velocity < -minFlingVelocity) -> 1
                        isPm && (dragOffsetPx >= itemHeightPx * 0.38f || velocity > minFlingVelocity) -> -1
                        else -> 0
                    }
                    val startOffset = dragOffsetPx
                    scope.launch {
                        animateWheelSettle(
                            startOffsetPx = startOffset,
                            steps = requestedStep,
                            itemHeightPx = itemHeightPx,
                            onStep = onStep,
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
                    onClick = {
                        if (step != null && step != 0) {
                            scope.launch {
                                animateWheelSettle(
                                    startOffsetPx = 0f,
                                    steps = step,
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
                            text = label,
                            fontSize = if (selected) 38.sp else 32.sp,
                            lineHeight = if (selected) 42.sp else 36.sp,
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
