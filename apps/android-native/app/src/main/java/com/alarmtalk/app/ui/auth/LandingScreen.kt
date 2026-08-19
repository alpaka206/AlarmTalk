package com.alarmtalk.app

import android.media.MediaPlayer
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.sin
import kotlinx.coroutines.delay

// ─────────────────────────────────────────────────────────────────────────────
// 랜딩 — "바다 위 일출" 풀블리드 일러스트(코드 드로잉) + 목소리 미리듣기 + 단일 CTA.
// 슬라이드 온보딩은 두지 않는다(가치 소개는 이 화면이, 사용법은 코치마크가 담당).
// 브랜드/히어로 비주얼은 "랜딩 브랜드 비주얼" 문서화 예외라 raw Color 를 여기서만 사용한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 장면 팔레트. skyStops 는 하늘 영역(0=화면 최상단, 1=수평선) 기준 비율. */
private data class ScenePalette(
    val skyStops: List<Pair<Float, Color>>,
    val seaTop: Color,
    val seaMid: Color,
    val seaBottom: Color,
    val sunCore: Color,
    val sunGlow: Color,
    val reflection: Color,
    val waveBack: Color,
    val waveMid: Color,
    val waveFront: Color,
    val crest: Color,
    val horizonFrac: Float,
    val sunXFrac: Float,
    /** 수평선 위로 태양 중심이 떠 있는 높이(화면 높이 비율). */
    val sunLiftFrac: Float,
    val sunRadiusFrac: Float,
)

/** 랜딩 장면 — 황금빛 아침 바다. 태양은 오른쪽(왼쪽에 두면 윤슬이 좌하단 헤드라인을 지나간다). */
private val LandingScene = ScenePalette(
    skyStops = listOf(
        0.00f to Color(0xFF2C4B86),
        0.50f to Color(0xFF6D89B8),
        0.80f to Color(0xFFC2A78F),
        1.00f to Color(0xFFF0BC83),
    ),
    seaTop = Color(0xFF547199),
    seaMid = Color(0xFF23406C),
    seaBottom = Color(0xFF0A1730),
    sunCore = Color(0xFFFFF8E6),
    sunGlow = Color(0xFFFFD494),
    reflection = Color(0xFFFFE0AA),
    waveBack = Color(0xFF2B4A78),
    waveMid = Color(0xFF16305A),
    waveFront = Color(0xFF0B1A36),
    crest = Color(0xFF7F9CC4),
    horizonFrac = 0.52f,
    sunXFrac = 0.68f,
    sunLiftFrac = 0.11f,
    sunRadiusFrac = 0.105f,
)

private val BrandCtaStart = Color(0xFF3D74FF)
private val BrandCtaEnd = Color(0xFF45B4F5)
private val GlassFill = Color(0x21FFFFFF)
private val GlassBorder = Color(0x2EFFFFFF)
internal val TextOnScene = Color(0xFFF8FAFF)
internal val TextOnSceneDim = Color(0xC8E8EEFA)

/** 랜딩 강조(키워드·플레이버튼·파형)용 브랜드 포인트 — 다크 테마 brand primary 와 동일.
 *  장면이 항상 어두운 고정 일러스트라 colorScheme 분기 없이 고정값 사용(라이트 테마
 *  primary #175FB0 은 어두운 바다 위에서 대비가 안 나온다). */
internal val BrandAccentOnScene = Color(0xFFA6D2FF)

/**
 * 첫 진입 랜딩 — 가치 제안(일출 장면 + 목소리 미리듣기)만 보여주고, 단일 "시작하기" 로
 * 로그인 폼으로 넘긴다.
 */
@Composable
internal fun LandingScreen(
    contentPadding: PaddingValues,
    onStart: () -> Unit,
) {
    SceneSystemBars(top = LandingScene.skyStops.first().second, bottom = LandingScene.seaBottom)
    Box(Modifier.fillMaxSize()) {
        SunriseScene(palette = LandingScene, modifier = Modifier.fillMaxSize())
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 22.dp)
                .padding(
                    top = contentPadding.calculateTopPadding() + 14.dp,
                    bottom = contentPadding.calculateBottomPadding() + 22.dp,
                ),
        ) {
            // 접근성 글꼴 확대/좁은 멀티윈도우에서 히어로+미리듣기 카드가 화면보다 커져도
            // '시작하기' CTA 는 아래에 고정으로 남도록, CTA 위 영역만 스크롤 가능하게 둔다.
            // 공간이 충분한 일반 화면에서는 heightIn(min=뷰포트) + SpaceBetween 이 기존과 동일한
            // '타이틀 상단·히어로 하단' 배치를 재현하고 스크롤도 생기지 않는다.
            BoxWithConstraints(Modifier.weight(1f)) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .heightIn(min = this.maxHeight),
                    verticalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = "AlarmTalk",
                        modifier = Modifier.padding(top = 18.dp),
                        style = MaterialTheme.typography.titleLarge,
                        color = TextOnScene.copy(alpha = 0.94f),
                        fontWeight = FontWeight.Bold,
                    )
                    Column {
                        Spacer(Modifier.height(16.dp))
                        Text(
                            text = buildAnnotatedString {
                                append(stringResource(R.string.auth_landing_headline_pre))
                                withStyle(SpanStyle(color = BrandAccentOnScene, fontWeight = FontWeight.Bold)) {
                                    append(stringResource(R.string.auth_landing_headline_keyword))
                                }
                                append(stringResource(R.string.auth_landing_headline_post))
                            },
                            style = MaterialTheme.typography.headlineLarge,
                            color = TextOnScene,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = stringResource(R.string.auth_landing_subcopy),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextOnSceneDim,
                        )
                        Spacer(Modifier.height(20.dp))
                        VoicePreviewCard(accent = BrandAccentOnScene)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            GradientCta(
                text = stringResource(R.string.auth_landing_get_started),
                onClick = onStart,
            )
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 장면 드로잉 — 바다 위 일출. 베지어 파도·글로우·윤슬(반짝이는 반사).
// ─────────────────────────────────────────────────────────────────────────────

@Composable
private fun SunriseScene(palette: ScenePalette, modifier: Modifier = Modifier) {
    // 아주 느린 위상 하나로 윤슬 반짝임 + 파도 일렁임을 함께 구동(6초 주기).
    val transition = rememberInfiniteTransition(label = "scene")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = (2 * PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 6000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "phase",
    )

    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val horizonY = h * palette.horizonFrac
        val sunCenter = Offset(w * palette.sunXFrac, horizonY - h * palette.sunLiftFrac)
        val sunRadius = w * palette.sunRadiusFrac

        // 1) 하늘 — 위 깊은 남색에서 수평선의 따뜻한 빛으로.
        drawRect(
            brush = Brush.verticalGradient(
                colorStops = palette.skyStops.toTypedArray(),
                startY = 0f,
                endY = horizonY,
            ),
            size = Size(w, horizonY),
        )

        // 2) 수평선 대기 글로우 — 태양 주변 하늘이 넓고 낮게 물든다(납작한 타원).
        scale(scaleX = 1f, scaleY = 0.30f, pivot = Offset(sunCenter.x, horizonY)) {
            drawCircle(
                brush = Brush.radialGradient(
                    0f to palette.sunGlow.copy(alpha = 0.42f),
                    0.6f to palette.sunGlow.copy(alpha = 0.12f),
                    1f to palette.sunGlow.copy(alpha = 0f),
                    center = Offset(sunCenter.x, horizonY),
                    radius = w * 0.52f,
                ),
                radius = w * 0.52f,
                center = Offset(sunCenter.x, horizonY),
            )
        }

        // 3) 태양 — 국소적인 글로우 + 또렷한 원반.
        drawCircle(
            brush = Brush.radialGradient(
                0f to palette.sunGlow.copy(alpha = 0.50f),
                0.55f to palette.sunGlow.copy(alpha = 0.14f),
                1f to palette.sunGlow.copy(alpha = 0f),
                center = sunCenter,
                radius = sunRadius * 2.4f,
            ),
            radius = sunRadius * 2.4f,
            center = sunCenter,
        )
        drawCircle(
            brush = Brush.radialGradient(
                0f to Color(0xFFFFFDF4),
                0.45f to palette.sunCore,
                0.85f to Color(0xFFFFE2AC),
                1f to palette.sunGlow.copy(alpha = 0.75f),
                center = sunCenter,
                radius = sunRadius,
            ),
            radius = sunRadius,
            center = sunCenter,
        )

        // 4) 새 두어 마리 — 태양 반대편 하늘에.
        val birdX = w * (1f - palette.sunXFrac)
        drawBird(Offset(birdX, horizonY - h * 0.16f), w * 0.024f)
        drawBird(Offset(birdX + w * 0.13f, horizonY - h * 0.21f), w * 0.017f)
        drawBird(Offset(birdX - w * 0.08f, horizonY - h * 0.24f), w * 0.012f)

        // 5) 바다.
        drawRect(
            brush = Brush.verticalGradient(
                0f to palette.seaTop,
                0.32f to palette.seaMid,
                1f to palette.seaBottom,
                startY = horizonY,
                endY = h,
            ),
            topLeft = Offset(0f, horizonY),
            size = Size(w, h - horizonY),
        )
        // 수평선 — 태양 아래쪽만 밝게 빛나는 라인.
        drawLine(
            brush = Brush.horizontalGradient(
                0f to Color.Transparent,
                0.5f to palette.reflection.copy(alpha = 0.9f),
                1f to Color.Transparent,
                startX = sunCenter.x - w * 0.34f,
                endX = sunCenter.x + w * 0.34f,
            ),
            start = Offset(0f, horizonY),
            end = Offset(w, horizonY),
            strokeWidth = 2f * density,
        )

        // 6) 윤슬 — 은은한 반사 기둥 위에, 아래로 갈수록 흩어지며 사라지는 빛 조각.
        val pillarDepth = (h - horizonY) * 0.52f
        clipRect(top = horizonY) {
            scale(scaleX = 0.26f, scaleY = 1f, pivot = Offset(sunCenter.x, horizonY)) {
                drawCircle(
                    brush = Brush.radialGradient(
                        0f to palette.reflection.copy(alpha = 0.30f),
                        0.6f to palette.reflection.copy(alpha = 0.10f),
                        1f to palette.reflection.copy(alpha = 0f),
                        center = Offset(sunCenter.x, horizonY),
                        radius = pillarDepth,
                    ),
                    radius = pillarDepth,
                    center = Offset(sunCenter.x, horizonY),
                )
            }
        }
        val glitterRows = 18
        val glitterDepth = (h - horizonY) * 0.46f
        val rowStep = glitterDepth / glitterRows
        for (i in 0 until glitterRows) {
            val t = i / (glitterRows - 1f)
            val y = horizonY + rowStep * (i + 0.55f)
            val spread = sunRadius * (0.30f + t * 1.5f)
            val alpha = 0.62f * (1f - t) * (1f - t) + 0.05f
            val wobble = sin(phase + i * 1.9f) * spread * 0.20f
            val segW = spread * (0.66f + 0.26f * sin(phase * 2f + i * 2.6f))
            val segH = (1.6f + 1.2f * (1f - t)) * density
            drawRoundRect(
                color = palette.reflection.copy(alpha = alpha),
                topLeft = Offset(sunCenter.x - segW / 2f + wobble, y - segH / 2f),
                size = Size(segW, segH),
                cornerRadius = CornerRadius(segH / 2f),
            )
            // 좌우로 흩어지는 잔조각.
            if (i % 2 == 0) {
                val sideW = segW * 0.28f
                drawRoundRect(
                    color = palette.reflection.copy(alpha = alpha * 0.5f),
                    topLeft = Offset(sunCenter.x + spread * 0.70f + wobble * 0.6f, y - segH / 2f),
                    size = Size(sideW, segH),
                    cornerRadius = CornerRadius(segH / 2f),
                )
                drawRoundRect(
                    color = palette.reflection.copy(alpha = alpha * 0.4f),
                    topLeft = Offset(sunCenter.x - spread * 0.70f - sideW - wobble * 0.6f, y - segH / 2f),
                    size = Size(sideW, segH),
                    cornerRadius = CornerRadius(segH / 2f),
                )
            }
        }

        // 7) 파도 실루엣 3겹 — 부드러운 베지어 곡선 + 빛 받은 물마루 하이라이트.
        drawWave(
            w, h,
            baseY = horizonY + (h - horizonY) * 0.26f,
            amp = h * 0.014f,
            phase = phase,
            color = palette.waveBack.copy(alpha = 0.9f),
            crest = palette.crest.copy(alpha = 0.35f),
        )
        drawWave(
            w, h,
            baseY = horizonY + (h - horizonY) * 0.46f,
            amp = h * 0.018f,
            phase = phase + 1.6f,
            color = palette.waveMid,
            crest = palette.crest.copy(alpha = 0.20f),
        )
        drawWave(
            w, h,
            baseY = horizonY + (h - horizonY) * 0.68f,
            amp = h * 0.022f,
            phase = phase + 3.4f,
            color = palette.waveFront,
            crest = null,
        )

        // 8) 하단 스크림 — 텍스트/버튼 가독성. 바다 밑색과 같은 계열로 자연스럽게.
        drawRect(
            brush = Brush.verticalGradient(
                0f to Color.Transparent,
                0.55f to palette.seaBottom.copy(alpha = 0.55f),
                1f to palette.seaBottom.copy(alpha = 0.96f),
                startY = h * 0.56f,
                endY = h,
            ),
            topLeft = Offset(0f, h * 0.56f),
            size = Size(w, h * 0.44f),
        )
    }
}

/** 갈매기 실루엣 — 완만한 두 곡선. */
private fun DrawScope.drawBird(center: Offset, wingSpan: Float) {
    val path = Path().apply {
        moveTo(center.x - wingSpan, center.y + wingSpan * 0.30f)
        quadraticBezierTo(center.x - wingSpan * 0.5f, center.y - wingSpan * 0.55f, center.x, center.y)
        quadraticBezierTo(center.x + wingSpan * 0.5f, center.y - wingSpan * 0.55f, center.x + wingSpan, center.y + wingSpan * 0.30f)
    }
    drawPath(
        path = path,
        color = Color(0xFF13233F).copy(alpha = 0.75f),
        style = Stroke(width = wingSpan * 0.14f, cap = StrokeCap.Round),
    )
}

/** 완만하게 일렁이는 파도 실루엣 한 겹(+선택적 물마루 하이라이트). */
private fun DrawScope.drawWave(
    w: Float,
    h: Float,
    baseY: Float,
    amp: Float,
    phase: Float,
    color: Color,
    crest: Color?,
) {
    val segments = 4
    val seg = w / segments
    val topEdge = Path().apply {
        moveTo(0f, baseY + amp * sin(phase))
        for (i in 0 until segments) {
            val crestY = baseY + amp * sin(phase + (i + 0.5f) * 1.8f) - amp * 0.8f
            val endY = baseY + amp * sin(phase + (i + 1f) * 1.8f)
            quadraticBezierTo(i * seg + seg / 2f, crestY, (i + 1f) * seg, endY)
        }
    }
    val fill = Path().apply {
        addPath(topEdge)
        lineTo(w, h)
        lineTo(0f, h)
        close()
    }
    drawPath(fill, color)
    if (crest != null) {
        drawPath(topEdge, crest, style = Stroke(width = 1.4f * density, cap = StrokeCap.Round))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 콘텐츠 컴포넌트 — 글라스 목소리 카드 + 그라데이션 CTA
// ─────────────────────────────────────────────────────────────────────────────

/** 경량 "목소리 미리듣기" 글라스 카드 — 어두운 장면 위에 얹는 반투명 버전. */
@Composable
private fun VoicePreviewCard(accent: Color) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val previewPlayer = remember(context) {
        MediaPlayer.create(context, R.raw.landing_voice_preview)
    }
    var isPlaying by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0f) }

    DisposableEffect(previewPlayer) {
        previewPlayer?.setOnCompletionListener { p ->
            isPlaying = false
            progress = 0f
            p.seekTo(0)
        }
        onDispose { previewPlayer?.release() }
    }
    LaunchedEffect(isPlaying, previewPlayer) {
        val duration = previewPlayer?.duration?.coerceAtLeast(1) ?: 1
        while (isPlaying && previewPlayer != null) {
            progress = (previewPlayer.currentPosition / duration.toFloat()).coerceIn(0f, 1f)
            delay(80)
        }
    }
    fun toggle() {
        val p = previewPlayer ?: return
        if (p.isPlaying) {
            p.pause(); isPlaying = false; return
        }
        if (progress >= 0.98f) {
            p.seekTo(0); progress = 0f
        }
        p.start(); isPlaying = true
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = GlassFill,
        border = BorderStroke(1.dp, GlassBorder),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Surface(
                onClick = ::toggle,
                modifier = Modifier.size(48.dp),
                shape = WakerPillShape,
                color = accent.copy(alpha = 0.18f),
                contentColor = accent,
                border = BorderStroke(1.dp, accent.copy(alpha = 0.45f)),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = if (isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (isPlaying) {
                            stringResource(R.string.auth_landing_preview_pause)
                        } else {
                            stringResource(R.string.auth_landing_preview_play)
                        },
                        modifier = Modifier.size(26.dp),
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = stringResource(R.string.auth_landing_sample_message),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = TextOnScene,
                    // 자막 = 실제 미리듣기 음성 대사 3문장(인사·날씨·당부) 전문. 줄 수 제한 없음 —
                    // 카드가 커지는 극단 케이스(접근성 확대 등)는 랜딩 콘텐츠 영역 스크롤이 흡수하고
                    // '시작하기' CTA 는 스크롤 밖에 고정이라 항상 도달 가능하다.
                )
                MiniWaveform(progress = progress, accent = accent)
            }
        }
    }
}

@Composable
private fun MiniWaveform(progress: Float, accent: Color) {
    val levels = listOf(
        0.18f, 0.30f, 0.22f, 0.46f, 0.28f, 0.58f, 0.36f, 0.68f, 0.44f, 0.60f,
        0.32f, 0.52f, 0.40f, 0.72f, 0.48f, 0.62f, 0.34f, 0.54f, 0.26f, 0.44f,
        0.30f, 0.50f, 0.22f, 0.38f, 0.28f, 0.46f, 0.20f, 0.34f, 0.16f, 0.26f,
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(26.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val barProgress = index / levels.lastIndex.toFloat()
            val played = progress > 0f && barProgress <= progress
            Box(
                modifier = Modifier
                    .width(1.5.dp)
                    .height((4 + level * 20).dp)
                    .background(
                        color = if (played) accent else Color.White.copy(alpha = 0.30f),
                        shape = WakerPillShape,
                    ),
            )
        }
    }
}

/** 블루 그라데이션 CTA(랜딩 브랜드 비주얼 예외). 랜딩·인증 플로우 공용. */
@Composable
internal fun GradientCta(text: String, onClick: () -> Unit, enabled: Boolean = true) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            // ⚠ 0.45 는 흰 글자까지 함께 흐려져 대비 3.4:1 이었다 — 0.6 으로 올린다
            // (2026-08-17). iOS `GradientCta` 도 같은 값이다.
            .alpha(if (enabled) 1f else 0.6f),
        shape = WakerButtonShape,
        color = Color.Transparent,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                // ⚠ **`fillMaxSize()` 를 쓰지 말 것 — 버튼이 화면을 통째로 덮는다.**
                //
                // 높이 상한을 없앤 것(`height(56.dp)` → `heightIn(min = 56.dp)`)은 큰 글꼴에서
                // 라벨이 잘리지 않게 하려던 것이라 의도는 맞다. 문제는 **안쪽이 부모가 주는
                // 최대 높이까지 늘어난다**는 것이다: Column 은 weight 없는 자식을 **먼저**
                // 들어온 최대 제약으로 재므로, 여기서 `fillMaxSize()` 를 하면 CTA 가 화면
                // 전체를 가져가고 `weight(1f)` 로 잡아 둔 히어로 영역에 **0 이 남는다.**
                // 실제로 랜딩이 파란 버튼 하나만 남고 제목·문구·미리듣기 카드가 전부
                // 사라졌다(2026-08-10 S23 Ultra 실기기 재현, 뷰 트리에 텍스트 노드가
                // '시작하기' 하나뿐이었다).
                //
                // 그래서 **최소 높이는 여기서만** 정하고 세로는 내용에 맞춘다 — 한 줄이면
                // 56dp, 글꼴이 커져 두 줄이 되면 그만큼만 자란다.
                .heightIn(min = 56.dp)
                .background(Brush.horizontalGradient(listOf(BrandCtaStart, BrandCtaEnd))),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = text,
                // 자랐을 때 글자가 위아래에 닿지 않도록.
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                style = MaterialTheme.typography.titleMedium,
                color = Color(0xFFFFFFFF),
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
