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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerScrimColor
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
    /** 대상별 모서리 반경 — 스포트라이트 구멍이 대상과 동심(concentric)으로 떨어지도록 쓴다. */
    internal val radii = mutableStateMapOf<String, Dp>()
}

/**
 * 이 컴포저블을 [key] 코치마크의 스포트라이트 대상으로 등록한다.
 * [targetRadius] 는 대상의 모서리 반경 — 구멍 라운드를 대상과 평행하게 맞추는 데 쓴다.
 * 카드면 그 카드 shape 의 dp(예: 22), pill/원형이면 매우 큰 값(예: 999), 모르면 기본 16dp.
 */
fun Modifier.coachMarkTarget(
    registry: CoachMarkRegistry,
    key: String,
    targetRadius: Dp = 16.dp,
): Modifier = onGloballyPositioned { coordinates ->
    registry.bounds[key] = coordinates.boundsInRoot()
    registry.radii[key] = targetRadius
}

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
    val holePaddingDp = 6.dp
    val holePaddingPx = with(density) { holePaddingDp.toPx() }
    // 구멍은 대상보다 holePadding 만큼 부풀려 그리므로, 동심으로 보이려면 구멍 반경 =
    // 대상 반경 + holePadding 이어야 한다. 미등록 대상은 기존 동작(16dp)으로 폴백.
    val targetRadiusDp = registry.radii[step.targetKey] ?: 16.dp
    val holeCornerPx = with(density) { (targetRadiusDp + holePaddingDp).toPx() }
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
            drawRect(WakerScrimColor)
            if (hole != null) {
                // pill·원형·작은 타깃에서 사각이 깨지지 않도록 짧은 변의 절반으로 클램프.
                val cornerPx = holeCornerPx.coerceAtMost(minOf(hole.size.width, hole.size.height) / 2f)
                drawRoundRect(
                    color = Color.Transparent,
                    topLeft = hole.topLeft,
                    size = hole.size,
                    cornerRadius = CornerRadius(cornerPx),
                    blendMode = BlendMode.Clear,
                )
                drawRoundRect(
                    color = highlightColor,
                    topLeft = hole.topLeft,
                    size = hole.size,
                    cornerRadius = CornerRadius(cornerPx),
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
        // 카드가 상태바/내비게이션바 밑으로 깔려 화면을 벗어나지 않도록 안전 영역 안에 둔다.
        val topInsetPx = WindowInsets.systemBars.getTop(density).toFloat()
        val bottomInsetPx = WindowInsets.systemBars.getBottom(density).toFloat()
        val minY = topInsetPx
        val maxY = (overlayHeightPx - cardHeightPx - bottomInsetPx).coerceAtLeast(minY)
        val rawY = if (hole == null) {
            // 대상 미등록 — 화면 중앙에 폴백.
            (overlayHeightPx - cardHeightPx) / 2f
        } else {
            val below = hole.bottom + gapPx
            val above = hole.top - gapPx - cardHeightPx
            if (below + cardHeightPx <= overlayHeightPx - bottomInsetPx || above < minY) below else above
        }
        val offsetY = rawY.coerceIn(minY, maxY)

        Surface(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                // 태블릿/폴더블에서 카드가 화면 폭 전체로 늘어나지 않도록 최대 폭을 제한하고 가운데 정렬.
                .widthIn(max = 480.dp)
                .offset { IntOffset(0, offsetY.roundToInt()) }
                .onSizeChanged { cardHeightPx = it.height }
                // 첫 프레임에 높이를 모른 채 그려지는 깜빡임을 숨긴다.
                .graphicsLayer { alpha = if (cardHeightPx == 0) 0f else 1f },
            shape = WakerPanelShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 3.dp,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // 단계가 여럿일 때만 진행 표시(가이드 N / M). 한 단계뿐이면 점·카운터 모두 생략.
                if (stepCount > 1) {
                    Text(
                        text = stringResource(R.string.r3dlg_usage_guide_step_counter, stepIndex + 1, stepCount),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
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
                        Text(stringResource(R.string.r3dlg_usage_guide_skip), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Button(onClick = onNext) {
                        Text(if (isLast) stringResource(R.string.r3dlg_usage_guide_start) else stringResource(R.string.r3dlg_usage_guide_next))
                    }
                }
            }
        }
    }
}
