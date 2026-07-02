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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import kotlin.random.Random
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ─────────────────────────────────────────────────────────────────────────────
// 랜딩 — "바다 위 일출" 풀블리드 일러스트(코드 드로잉) + 목소리 미리듣기 + 단일 CTA.
// 온보딩 3장(보랏빛 밤·황금 아침 변주)은 아직 시안: 우상단 임시 칩으로 미리 본다.
// 브랜드/히어로 비주얼은 "랜딩 브랜드 비주얼" 문서화 예외라 raw Color 를 여기서만 사용한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 장면 팔레트 — 랜딩(새벽)·온보딩 2(보랏빛 밤)·온보딩 3(황금 아침) 변주.
 *  skyStops 는 하늘 영역(0=화면 최상단, 1=수평선) 기준 비율. */
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
    val keyword: Color,
    val horizonFrac: Float = 0.52f,
    val sunXFrac: Float = 0.72f,
    /** 수평선 위로 태양 중심이 떠 있는 높이(화면 높이 비율). */
    val sunLiftFrac: Float = 0.05f,
    val sunRadiusFrac: Float = 0.105f,
    val crescentMoon: Boolean = false,
    val starDensity: Int = 46,
)

/** 새벽 — 랜딩 기본. 깊은 남색 하늘, 수평선 부근만 복숭아빛으로 밝아진다. */
private val DawnScene = ScenePalette(
    skyStops = listOf(
        0.00f to Color(0xFF0B1330),
        0.42f to Color(0xFF1F3560),
        0.68f to Color(0xFF46648F),
        0.86f to Color(0xFF8189A9),
        1.00f to Color(0xFFDBA97E),
    ),
    seaTop = Color(0xFF3C5E8C),
    seaMid = Color(0xFF16294C),
    seaBottom = Color(0xFF060D1D),
    sunCore = Color(0xFFFFF3DC),
    sunGlow = Color(0xFFFFC98F),
    reflection = Color(0xFFFFD9A0),
    waveBack = Color(0xFF1C3765),
    waveMid = Color(0xFF101F41),
    waveFront = Color(0xFF081226),
    crest = Color(0xFF6C8BB8),
    keyword = Color(0xFFFFD9A8),
)

/** 보랏빛 밤 — 온보딩 2. 초승달과 별, 조용한 바다. */
private val VioletScene = ScenePalette(
    skyStops = listOf(
        0.00f to Color(0xFF120D2C),
        0.45f to Color(0xFF2A2054),
        0.75f to Color(0xFF4A3878),
        1.00f to Color(0xFF7E5E93),
    ),
    seaTop = Color(0xFF4A4076),
    seaMid = Color(0xFF201A44),
    seaBottom = Color(0xFF0B081E),
    sunCore = Color(0xFFF6EDD8),
    sunGlow = Color(0xFFCBB2E8),
    reflection = Color(0xFFDCCBEC),
    waveBack = Color(0xFF352B60),
    waveMid = Color(0xFF1E1840),
    waveFront = Color(0xFF100C28),
    crest = Color(0xFF7A6BA8),
    keyword = Color(0xFFD9BEFF),
    sunXFrac = 0.68f,
    sunLiftFrac = 0.22f,
    sunRadiusFrac = 0.07f,
    crescentMoon = true,
    starDensity = 82,
)

/** 황금 아침 — 온보딩 3. 해가 좀 더 떠오른 따뜻한 아침 바다. */
private val GoldScene = ScenePalette(
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
    keyword = Color(0xFFFFDFA8),
    sunXFrac = 0.32f,
    sunLiftFrac = 0.11f,
    sunRadiusFrac = 0.12f,
    starDensity = 0,
)

private val BrandCtaStart = Color(0xFF3D74FF)
private val BrandCtaEnd = Color(0xFF45B4F5)
private val GlassFill = Color(0x21FFFFFF)
private val GlassBorder = Color(0x2EFFFFFF)
private val TextOnScene = Color(0xFFF8FAFF)
private val TextOnSceneDim = Color(0xC8E8EEFA)

/** 랜딩 장면 — 온보딩 3(황금 아침)과 같은 화풍, 태양만 살짝 작게.
 *  태양은 오른쪽으로 미러링: 왼쪽에 두면 윤슬이 좌하단 헤드라인 글자를 지나간다. */
private val LandingScene = GoldScene.copy(sunRadiusFrac = 0.105f, sunXFrac = 0.68f)

/** 랜딩 강조(키워드·플레이버튼·파형)용 브랜드 포인트 — 다크 테마 brand primary 와 동일.
 *  장면이 항상 어두운 고정 일러스트라 colorScheme 분기 없이 고정값 사용(라이트 테마
 *  primary #175FB0 은 어두운 바다 위에서 대비가 안 나온다). */
private val BrandAccentOnScene = Color(0xFFA6D2FF)

/**
 * 첫 진입 랜딩 — 가치 제안(일출 장면 + 목소리 미리듣기)만 보여주고, 단일 "시작하기" 로
 * 로그인 폼으로 넘긴다. 우상단 칩은 온보딩 시안 미리보기용 dev 전용 토글.
 */
@Composable
internal fun LandingScreen(
    contentPadding: PaddingValues,
    onStart: () -> Unit,
) {
    var showOnboarding by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        if (showOnboarding) {
            OnboardingPreview(contentPadding = contentPadding, onDone = onStart)
        } else {
            LandingContent(contentPadding = contentPadding, onStart = onStart)
        }
        // 온보딩 시안 미리보기 칩 — 개발 빌드 전용(온보딩 정식 편입 여부 결정까지 유지).
        if (BuildConfig.DEBUG) {
            Surface(
                onClick = { showOnboarding = !showOnboarding },
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(contentPadding)
                    .padding(top = 10.dp, end = 18.dp),
                shape = WakerPillShape,
                color = Color(0xFF000000).copy(alpha = 0.35f),
                contentColor = Color(0xFFF7F4EE),
                border = BorderStroke(1.dp, Color(0xFFFFFFFF).copy(alpha = 0.18f)),
            ) {
                Text(
                    text = if (showOnboarding) "랜딩 보기" else "온보딩 시안 보기",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                )
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 랜딩 본문 — 풀블리드 장면 위에 콘텐츠 오버레이
// ─────────────────────────────────────────────────────────────────────────────

@Composable
private fun LandingContent(
    contentPadding: PaddingValues,
    onStart: () -> Unit,
) {
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
            Text(
                text = "AlarmTalk",
                style = MaterialTheme.typography.titleLarge,
                color = TextOnScene.copy(alpha = 0.94f),
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.weight(1f))
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
            Spacer(Modifier.height(18.dp))
            GradientCta(
                text = stringResource(R.string.auth_landing_get_started),
                onClick = onStart,
            )
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 온보딩 시안 — 시안(Onboarding1~3) 구조를 우리 앱 카피/화풍으로
// ─────────────────────────────────────────────────────────────────────────────

private data class OnboardPage(
    val palette: ScenePalette,
    val keyword: String,
    val headlineBefore: String,
    val headlineAfter: String,
    val description: String,
)

private val OnboardPages = listOf(
    OnboardPage(
        palette = DawnScene,
        keyword = "좋아하는 목소리",
        headlineBefore = "",
        headlineAfter = "로\n깨어나는 아침",
        description = "당신이 고른 목소리가 이름을 부르며 하루의 시작을 함께해요.",
    ),
    OnboardPage(
        palette = VioletScene,
        keyword = "새로운 한마디",
        headlineBefore = "매일 밤 준비되는\n",
        headlineAfter = "",
        description = "똑같은 알람음 대신, 들을 때마다 다른 응원의 메시지가 도착해요.",
    ),
    OnboardPage(
        palette = GoldScene,
        keyword = "아침 습관",
        headlineBefore = "기분 좋은\n",
        headlineAfter = "이 자라나요",
        description = "기상 알람도, 약 챙기는 일도 목소리가 다정하게 챙겨드려요.",
    ),
)

@Composable
private fun OnboardingPreview(
    contentPadding: PaddingValues,
    onDone: () -> Unit,
) {
    val pagerState = rememberPagerState(pageCount = { OnboardPages.size })
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize()) {
        HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { pageIndex ->
            val page = OnboardPages[pageIndex]
            Box(Modifier.fillMaxSize()) {
                SunriseScene(palette = page.palette, modifier = Modifier.fillMaxSize())
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 22.dp)
                        .padding(
                            top = contentPadding.calculateTopPadding() + 14.dp,
                            bottom = contentPadding.calculateBottomPadding() + 22.dp,
                        ),
                ) {
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = buildAnnotatedString {
                            append(page.headlineBefore)
                            withStyle(
                                SpanStyle(color = page.palette.keyword, fontWeight = FontWeight.Bold),
                            ) { append(page.keyword) }
                            append(page.headlineAfter)
                        },
                        style = MaterialTheme.typography.headlineLarge,
                        color = TextOnScene,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = page.description,
                        style = MaterialTheme.typography.bodyLarge,
                        color = TextOnSceneDim,
                    )
                    // 하단 컨트롤(도트+버튼) 높이만큼 자리 확보.
                    Spacer(Modifier.height(118.dp))
                }
            }
        }
        // 도트 + CTA 는 페이지 위에 고정.
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(horizontal = 22.dp)
                .padding(bottom = contentPadding.calculateBottomPadding() + 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                repeat(OnboardPages.size) { i ->
                    val active = pagerState.currentPage == i
                    Box(
                        Modifier
                            .size(width = if (active) 22.dp else 7.dp, height = 7.dp)
                            .background(
                                color = if (active) {
                                    OnboardPages[pagerState.currentPage].palette.keyword
                                } else {
                                    Color(0x55FFFFFF)
                                },
                                shape = WakerPillShape,
                            ),
                    )
                }
            }
            Spacer(Modifier.height(18.dp))
            val lastPage = pagerState.currentPage == OnboardPages.lastIndex
            GradientCta(
                text = stringResource(
                    if (lastPage) R.string.auth_onboarding_start else R.string.auth_onboarding_next,
                ),
                onClick = {
                    if (lastPage) {
                        onDone()
                    } else {
                        scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                    }
                },
            )
        }
        // Skip — 좌상단(우상단은 임시 토글 칩 자리).
        Text(
            text = stringResource(R.string.auth_onboarding_skip),
            style = MaterialTheme.typography.labelLarge,
            color = TextOnScene.copy(alpha = 0.75f),
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(contentPadding)
                .padding(top = 14.dp, start = 22.dp)
                .clickable(onClick = onDone),
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 장면 드로잉 — 바다 위 일출/달밤. 베지어 파도·글로우·윤슬(반짝이는 반사)·별.
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
    // 별 배치는 화면마다 고정(결정적 난수).
    val stars = remember(palette.starDensity) {
        val rng = Random(42)
        List(palette.starDensity) {
            Triple(rng.nextFloat(), rng.nextFloat() * 0.5f, 0.4f + rng.nextFloat() * 0.8f)
        }
    }

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

        // 2) 별 — 하늘 위쪽에만, 수평선에 가까울수록 옅게.
        stars.forEach { (fx, fy, scale) ->
            val y = fy * horizonY
            val fade = (1f - fy * 1.5f).coerceIn(0f, 1f)
            drawCircle(
                color = Color.White.copy(alpha = 0.30f * fade * scale),
                radius = 1.1f * scale * density,
                center = Offset(fx * w, y),
            )
        }

        // 3) 수평선 대기 글로우 — 태양 주변 하늘이 넓고 낮게 물든다(납작한 타원).
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

        // 4) 태양(또는 달) — 국소적인 글로우 + 또렷한 원반.
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
        if (palette.crescentMoon) {
            // 보름달 — 창백한 원반(깎기 방식은 글로우 위에서 티가 나서 사용하지 않는다).
            drawCircle(
                brush = Brush.radialGradient(
                    0f to Color(0xFFFFFCF0),
                    0.55f to palette.sunCore,
                    1f to Color(0xFFE4D6BC),
                    center = sunCenter,
                    radius = sunRadius,
                ),
                radius = sunRadius,
                center = sunCenter,
            )
        } else {
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
        }

        // 5) 새 두어 마리 — 태양 반대편 하늘에.
        if (!palette.crescentMoon) {
            val birdX = w * (1f - palette.sunXFrac)
            drawBird(Offset(birdX, horizonY - h * 0.16f), w * 0.024f)
            drawBird(Offset(birdX + w * 0.13f, horizonY - h * 0.21f), w * 0.017f)
            drawBird(Offset(birdX - w * 0.08f, horizonY - h * 0.24f), w * 0.012f)
        }

        // 6) 바다.
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

        // 7) 윤슬 — 은은한 반사 기둥 위에, 아래로 갈수록 흩어지며 사라지는 빛 조각.
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

        // 8) 파도 실루엣 3겹 — 부드러운 베지어 곡선 + 달빛 받은 물마루 하이라이트.
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

        // 9) 하단 스크림 — 텍스트/버튼 가독성. 바다 밑색과 같은 계열로 자연스럽게.
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
                        imageVector = if (isPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
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
                    maxLines = 2,
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

/** 블루 그라데이션 CTA(랜딩 브랜드 비주얼 예외). */
@Composable
private fun GradientCta(text: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        shape = WakerButtonShape,
        color = Color.Transparent,
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Brush.horizontalGradient(listOf(BrandCtaStart, BrandCtaEnd))),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.titleMedium,
                color = Color(0xFFFFFFFF),
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
