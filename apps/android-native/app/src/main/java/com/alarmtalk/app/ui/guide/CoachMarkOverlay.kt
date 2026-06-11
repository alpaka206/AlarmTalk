package com.alarmtalk.app.ui.guide

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VectorConverter
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * 코치마크 한 단계 — [targetKey] 로 등록된 컨트롤 위치에 스포트라이트(구멍 뚫린
 * 스크림 + 하이라이트 보더)를 띄우고 그 옆에 설명 카드를 붙인다.
 */
data class CoachMarkStep(
    val targetKey: String,
    val title: String,
    val body: String,
    /** 대상이 LazyColumn 항목이면 그 index — 화면 밖(미컴포즈)이면 먼저 스크롤해 노출시킨다. */
    val lazyItemIndex: Int? = null,
)

/**
 * 코치마크 대상 위치 저장소. 화면의 대상 컴포저블이 [coachMarkTarget] 으로
 * 자기 위치(root 좌표)를 등록하고, [CoachMarkOverlay] 가 이를 읽어 그린다.
 */
class CoachMarkRegistry {
    internal val bounds = mutableStateMapOf<String, Rect>()
}

/** 이 컴포저블을 [key] 코치마크의 스포트라이트 대상으로 등록한다. */
fun Modifier.coachMarkTarget(registry: CoachMarkRegistry, key: String): Modifier =
    onGloballyPositioned { coordinates -> registry.bounds[key] = coordinates.boundsInRoot() }

/**
 * 위치 앵커형 첫 사용 가이드 오버레이.
 *
 * `UsageGuideOverlay`(중앙 카드 캐러셀)와 달리 실제 컨트롤 위치에 구멍을 뚫어
 * "이게 여기 있다"를 보여준다. 화면 전체를 덮는 부모(Box) 안에서 마지막 자식으로
 * 그려야 하며, 노출 이력은 호출자가 `UsageGuideStore` 로 관리한다.
 *
 * [listState] 를 주면 단계 진입 시 [CoachMarkStep.lazyItemIndex] 항목으로 먼저
 * 자동 스크롤해 화면 밖 대상도 비춘다.
 */
@Composable
fun CoachMarkOverlay(
    steps: List<CoachMarkStep>,
    registry: CoachMarkRegistry,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier,
    listState: LazyListState? = null,
) {
    if (steps.isEmpty()) return
    var index by remember { mutableStateOf(0) }
    val isLast = index >= steps.lastIndex
    val step = steps[index]

    LaunchedEffect(index) {
        val itemIndex = step.lazyItemIndex
        if (itemIndex != null && listState != null) {
            listState.animateScrollToItem(itemIndex)
        }
    }

    // 대상 좌표는 root 기준으로 등록되므로 오버레이 자신의 root 오프셋만큼 보정한다.
    var overlayOrigin by remember { mutableStateOf(Offset.Zero) }
    val rawTarget = registry.bounds[step.targetKey]
    val targetBounds = rawTarget?.translate(-overlayOrigin.x, -overlayOrigin.y)

    val density = LocalDensity.current
    val holePaddingPx = with(density) { 6.dp.toPx() }
    val holeCornerPx = with(density) { 16.dp.toPx() }
    val highlightColor = MaterialTheme.colorScheme.primary

    // 단계 전환 시 구멍이 이전 위치에서 새 위치로 미끄러지듯 이동.
    // 첫 등록 시에는 snap 해 (0,0) 에서 자라나는 아티팩트를 막는다.
    val holeAnim = remember { Animatable(Rect.Zero, Rect.VectorConverter) }
    val inflatedTarget = targetBounds?.inflate(holePaddingPx)
    LaunchedEffect(inflatedTarget) {
        if (inflatedTarget != null) {
            if (holeAnim.value == Rect.Zero) holeAnim.snapTo(inflatedTarget)
            else holeAnim.animateTo(inflatedTarget)
        }
    }
    val hole = if (inflatedTarget != null && holeAnim.value != Rect.Zero) holeAnim.value else null

    Box(
        modifier = modifier
            .fillMaxSize()
            .onGloballyPositioned { overlayOrigin = it.boundsInRoot().topLeft }
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
            ),
    ) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen),
        ) {
            drawRect(SCRIM_COLOR)
            if (hole != null) {
                drawRoundRect(
                    color = Color.Transparent,
                    topLeft = hole.topLeft,
                    size = hole.size,
                    cornerRadius = CornerRadius(holeCornerPx),
                    blendMode = BlendMode.Clear,
                )
                drawRoundRect(
                    color = highlightColor,
                    topLeft = hole.topLeft,
                    size = hole.size,
                    cornerRadius = CornerRadius(holeCornerPx),
                    style = Stroke(width = 2.dp.toPx()),
                )
            }
        }

        CoachMarkCard(
            step = step,
            stepIndex = index,
            stepCount = steps.size,
            hole = hole,
            isLast = isLast,
            onSkip = onFinish,
            onNext = { if (isLast) onFinish() else index += 1 },
        )
    }
}

/** 설명 카드 — 구멍 아래 공간이 충분하면 아래, 아니면 위에 붙인다. */
@Composable
private fun CoachMarkCard(
    step: CoachMarkStep,
    stepIndex: Int,
    stepCount: Int,
    hole: Rect?,
    isLast: Boolean,
    onSkip: () -> Unit,
    onNext: () -> Unit,
) {
    val density = LocalDensity.current
    val gapPx = with(density) { 12.dp.toPx() }
    var cardHeightPx by remember { mutableStateOf(0) }
    var overlayHeightPx by remember { mutableStateOf(0) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .onSizeChanged { overlayHeightPx = it.height },
    ) {
        val offsetY = if (hole == null) {
            // 대상 미등록 — 화면 중앙에 폴백.
            ((overlayHeightPx - cardHeightPx) / 2f).coerceAtLeast(0f)
        } else {
            val below = hole.bottom + gapPx
            if (below + cardHeightPx <= overlayHeightPx || hole.top - gapPx - cardHeightPx < 0f) {
                below.coerceAtMost((overlayHeightPx - cardHeightPx).coerceAtLeast(0).toFloat())
            } else {
                hole.top - gapPx - cardHeightPx
            }
        }

        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .offset { IntOffset(0, offsetY.roundToInt()) }
                .onSizeChanged { cardHeightPx = it.height }
                // 첫 프레임에 높이를 모른 채 그려지는 깜빡임을 숨긴다.
                .graphicsLayer { alpha = if (cardHeightPx == 0) 0f else 1f },
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 3.dp,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "가이드 ${stepIndex + 1} / $stepCount",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        repeat(stepCount) { dot ->
                            Box(
                                modifier = Modifier
                                    .size(if (dot == stepIndex) 7.dp else 5.dp)
                                    .background(
                                        if (dot == stepIndex) {
                                            MaterialTheme.colorScheme.primary
                                        } else {
                                            MaterialTheme.colorScheme.outlineVariant
                                        },
                                        CircleShape,
                                    ),
                            )
                        }
                    }
                }
                Text(
                    text = step.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = step.body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onSkip) {
                        Text("건너뛰기", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Button(onClick = onNext) {
                        Text(if (isLast) "시작하기" else "다음")
                    }
                }
            }
        }
    }
}

/** UsageGuideOverlay 의 코치마크 스크림과 같은 농도. */
private val SCRIM_COLOR = Color(0xBD05080E)
