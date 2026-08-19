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

/**
 * 굴러가는 감속 곡선.
 *
 * ⚠ **초기 기울기를 다시 세우지 말 것**(2026-08-15). 예전 값 `(0.16, 1, 0.3, 1)` 은 시작
 * 기울기가 `1/0.16 = 6.25` 라, **한 프레임에 숫자 서너 개가 지나갔다** — 사용자에게는
 * "21 이었다가 34 로 갑자기 가 있는" 것으로 보인다.
 *
 * 곡선 탓이 아니라 **프레임 예산 탓**이다. 같은 곡선이라도 아이폰(120Hz, 8.3ms)은 두 번째
 * 프레임이 1칸을 지나 제대로 굴러 보이는데, A32(디버그 빌드 실측 25~30ms)는 같은 시점에
 * 3칸 이상을 지난다. 그래서 **안드로이드만** 기울기를 `0.6/0.3 = 2.0` 으로 낮춰 27ms 프레임
 * 하나가 대략 한 칸을 지나게 맞췄다. 끝은 그대로 부드럽게 선다(제어점 `(0.3, 1)`).
 *
 * ⚠ **iOS `TimeWheelSettle.easing` 에 이 숫자를 옮기지 말 것** — 거기선 원래 곡선이 맞다.
 */
private val TimeWheelEasing = CubicBezierEasing(0.3f, 0.6f, 0.3f, 1f)

/** 초당 한 칸 높이만큼의 속도가 몇 칸을 더 굴리는가(`flingStepsFor` 주석의 실측표 참조). */
private const val FlingStepsPerItemVelocity = 0.09f

@Composable
internal fun DraggableTimeWheelColumn(
    itemHeight: androidx.compose.ui.unit.Dp,
    selectedTextColor: Color,
    unselectedTextColor: Color,
    itemLabel: (Int) -> String,
    maxStepsPerGesture: Int,
    onStep: (Int) -> Unit,
    /**
     * 이 제스처가 **최종적으로 옮길 칸 수**. 손을 뗀 순간(또는 이웃 숫자를 탭한 순간)
     * 곧바로 불린다 — 굴러가는 애니메이션이 끝나기를 기다리지 않는다.
     *
     * ⚠ **`onStep` 과 역할이 다르다.** `onStep` 은 **보이는 숫자**를 한 칸씩 굴리는 것이고,
     * 이쪽은 **값을 확정**하는 것이다. 예전에는 둘이 한 몸이라 한 칸 굴릴 때마다 편집기
     * 상태가 통째로 갱신됐고, 그 갱신이 **칸이 바뀌는 바로 그 프레임**에 얹혀 A32 에서
     * 눈에 띄게 툭툭 끊겼다(2026-08-15 실측: 자키 프레임 60%, p90 53ms).
     *
     * ⚠ **애니메이션이 끝난 뒤로 미루지 말 것.** 굴러가는 데 최대 0.72초가 걸리는데, 그
     * 사이에 저장을 누르면 **화면과 다른 시각이 저장된다.** 손을 떼는 순간이 곧 확정이다.
     */
    onSettle: (Int) -> Unit = {},
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
    /**
     * 지금 치고 있는 숫자. **부모가 들고 있다**(`AlarmTimePickerCard`).
     *
     * ⚠ **칼럼 안으로 되돌리지 말 것**(2026-08-15). 예전에는 칼럼이 제 draft 를 들고
     * **포커스를 잃을 때** 부모로 올렸는데, 시를 치다 분을 누르면 순서가 이렇게 났다 —
     * 탭 → `editingColumn` 이 분으로 바뀌어 시의 입력창이 사라짐 → **시가 옛 값으로
     * 다시 그려짐** → 46ms 뒤 포커스가 빠지며 그제야 친 값이 반영. 실측으로 옛 값이
     * **134ms** 동안 보였다(로그: `render center=6` → `render center=9`).
     * 부모가 들고 있으면 '칼럼 전환' 과 '친 값 확정' 이 **한 번의 상태 변경**이라 그 틈이 없다.
     */
    draft: String = "",
    onDraftChange: (String) -> Unit = {},
    /** 이 칼럼의 입력이 끝났다(바깥 탭·완료). 친 값은 부모가 이미 갖고 있다. */
    onEndEdit: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }
    // ⚠ **`onFocusChanged` 는 첫 배치에서 '포커스 없음'으로 한 번 불린다.** 그걸 그대로
    // "포커스를 잃었다" 로 읽으면 입력창이 **뜨자마자 스스로 닫힌다** — 실기에서 숫자를
    // 눌러도 아무 일이 없었다(2026-08-11). 한 번이라도 포커스를 **가진 뒤**부터 센다.
    var hadFocus by remember(isEditing) { mutableStateOf(false) }

    // 편집이 열리면 키보드를 올린다. 빈 칸으로 비우는 것은 부모가 한다(`beginEdit`).
    LaunchedEffect(isEditing) {
        if (isEditing) focusRequester.requestFocus()
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

    /**
     * 튕겼을 때 **더 굴러갈 칸 수**. 손가락이 끈 만큼(1:1)에 얹히는 관성분이다.
     *
     * 계수 `FlingStepsPerItemVelocity` 는 2026-08-15 에 0.12 → 0.09 로 낮췄다
     * ("너무 많이 넘어가져"). A32 실측(한 칸 257px):
     *
     * | 제스처 | 속도 px/s | 드래그 칸 | 튕김 칸 0.12 → 0.09 |
     * | --- | --- | --- | --- |
     * | 느린 드래그 | 663 | 1 | 0 → 0 |
     * | 빠른 튕김 | 3,973 | 1 | 2 → 1 |
     * | 아주 빠른 튕김 | 8,497 | 2 | 4 → 3 |
     *
     * ⚠ **0 으로 만들지 말 것**(= 한 번에 한 칸). 그게 예전 iOS 의 "휠이 잘 안 돌아간다" 였다 —
     * 7시에서 11시로 가려면 한 칸씩 네 번을 끌어야 했다.
     *
     * ⚠ **iOS 와 숫자가 다른 건 의도다.** iOS 는 px/s 가 아니라 `predictedEndTranslation -
     * translation`(남은 이동 거리)을 받아 `TimeWheelPicker.snapStep` 이 제 계수로 환산한다.
     * 한쪽 숫자를 다른 쪽에 그대로 옮기지 말 것 — 들어오는 양이 서로 다른 값이다.
     */
    fun flingStepsFor(velocity: Float): Int {
        val minFlingVelocity = itemHeightPx * 4.2f
        if (abs(velocity) < minFlingVelocity) return 0
        val rawSteps = ((abs(velocity) / itemHeightPx) * FlingStepsPerItemVelocity)
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
                    // 값은 **여기서** 확정된다(위 `onSettle` 주석 참조). 아래 애니메이션은
                    // 보이는 숫자를 굴리기만 한다.
                    onSettle(stepsToSettle)
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
                                onDraftChange(next.filter { it.isDigit() }.take(2))
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
                            keyboardActions = KeyboardActions(onDone = { onEndEdit() }),
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
                                        // ⚠ **여기서 키보드를 내리지 말 것.** 시를 치다 분을
                                        // 누르면 시가 포커스를 잃으며 이리로 들어오는데, 그때
                                        // 내리면 분이 방금 올린 키패드가 도로 닫힌다 — 옮겨
                                        // 가려던 사용자에겐 '입력이 꺼진' 것으로 보인다
                                        // (2026-08-15 지적). 내리는 판단은 어느 칼럼도 편집
                                        // 중이 아닐 때로, 두 칼럼을 다 보는 부모가 한다.
                                        onEndEdit()
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
                            val tapSteps = offset.coerceIn(-maxStepsPerGesture, maxStepsPerGesture)
                            onSettle(tapSteps)
                            settleJob?.cancel()
                            settleJob = scope.launch {
                                animateWheelSettle(
                                    startOffsetPx = 0f,
                                    steps = tapSteps,
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
