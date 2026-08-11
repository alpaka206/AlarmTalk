package com.alarmtalk.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
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
    // 좁은 화면에서 숫자가 컬럼 폭을 넘지 않게 타이포를 함께 줄이는 배율(1f = 그대로).
    textScale: Float = 1f,
    /** 가운데 숫자를 눌러 **그 자리에서** 고쳐 쓸 수 있는 칼럼인가. */
    editable: Boolean = false,
    /** 지금 이 칼럼을 고쳐 쓰는 중인가. */
    isEditing: Boolean = false,
    /**
     * 시·분 중 **어느 쪽이든** 고쳐 쓰는 중인가. 그동안은 위아래 회색 숫자를 숨긴다
     * (2026-08-11 요청) — 큰 입력 글자 옆에 흐린 숫자가 남으면 지금 치는 값이 어느 것인지
     * 헷갈리고 커서가 그 사이에 끼어 보인다.
     */
    anyEditing: Boolean = false,
    onBeginEdit: () -> Unit = {},
    /** 다 친 값. 아무것도 안 쳤으면 null 이 온다(그 경우 값은 그대로 둔다). */
    onCommitEdit: (Int?) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var draft by remember { mutableStateOf("") }
    // ⚠ **`onFocusChanged` 는 첫 배치에서 '포커스 없음'으로 한 번 불린다.** 그걸 그대로
    // "포커스를 잃었다" 로 읽으면 입력창이 **뜨자마자 스스로 닫힌다** — 실기에서 숫자를
    // 눌러도 아무 일이 없었다(2026-08-11). 한 번이라도 포커스를 **가진 뒤**부터 센다.
    var hadFocus by remember(isEditing) { mutableStateOf(false) }

    // 편집이 열리면 빈 칸에서 시작하고 키보드를 올린다.
    LaunchedEffect(isEditing) {
        if (isEditing) {
            draft = ""
            focusRequester.requestFocus()
        }
    }

    fun commitDraft() {
        val typed = draft.toIntOrNull()
        draft = ""
        keyboard?.hide()
        onCommitEdit(typed)
    }
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
                // 고쳐 쓰는 동안에는 휠이 끌리지 않는다 — 입력창을 누르다 휠이 같이 돈다.
                enabled = !anyEditing,
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
                // 고쳐 쓰는 동안에는 위아래 회색 숫자를 숨긴다(위 `anyEditing` 주석 참조).
                if (anyEditing && offset != 0) return@forEach
                val distance = abs(offset)
                val alpha = when (distance) {
                    0 -> 1f
                    1 -> 0.18f
                    else -> 0.08f
                }
                val style = if (distance == 0) {
                    MaterialTheme.typography.displayLarge.scaledBy(textScale)
                } else {
                    MaterialTheme.typography.displayMedium.scaledBy(textScale)
                }
                if (offset == 0 && isEditing) {
                    // ⚠ **다이얼로그로 되돌리지 말 것**(2026-08-11 요청). 고치려는 숫자가
                    // 모달에 가리고 확인까지 두 번을 더 눌러야 한다. 누르고, 치고, 완료다.
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(itemHeight),
                        contentAlignment = Alignment.Center,
                    ) {
                        BasicTextField(
                            value = draft,
                            // 두 자리까지만 — 세 자리를 받아 봐야 어차피 잘린다.
                            onValueChange = { next ->
                                draft = next.filter { it.isDigit() }.take(2)
                            },
                            textStyle = style.copy(
                                color = selectedTextColor,
                                fontWeight = FontWeight.Bold,
                                textAlign = TextAlign.Center,
                            ),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Number,
                                imeAction = ImeAction.Done,
                            ),
                            keyboardActions = KeyboardActions(onDone = { commitDraft() }),
                            singleLine = true,
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(focusRequester)
                                // 포커스를 잃으면(다른 칼럼·바깥 탭) 그때까지 친 값을 넣는다 —
                                // 취소 버튼이 없으므로 여기서 안 받으면 친 게 조용히 사라진다.
                                .onFocusChanged { state ->
                                    if (state.isFocused) {
                                        hadFocus = true
                                    } else if (hadFocus && isEditing) {
                                        commitDraft()
                                    }
                                },
                            decorationBox = { inner ->
                                Box(contentAlignment = Alignment.Center) {
                                    // 비어 있으면 지금 값을 흐리게 깔아 둔다(치면 대체된다) —
                                    // 큰 글자 자리가 텅 비면 무엇을 치는 자리인지 알 수 없다.
                                    if (draft.isEmpty()) {
                                        Text(
                                            text = itemLabel(0),
                                            style = style,
                                            fontWeight = FontWeight.Bold,
                                            color = selectedTextColor.copy(alpha = 0.28f),
                                            textAlign = TextAlign.Center,
                                            maxLines = 1,
                                            softWrap = false,
                                        )
                                    }
                                    inner()
                                }
                            },
                        )
                    }
                    return@forEach
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
                        } else if (editable) {
                            settleJob?.cancel()
                            onBeginEdit()
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
