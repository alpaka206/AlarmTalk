package com.alarmtalk.app

import android.content.Context
import android.media.MediaPlayer
import androidx.annotation.RawRes
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

// ─────────────────────────────────────────────────────────────────────────────
// 랜딩 — "바다 위 일출" 풀블리드 그림 + 기본 목소리 미리듣기 칩 + 단일 CTA.
// 슬라이드 온보딩은 두지 않는다(가치 소개는 이 화면이, 사용법은 코치마크가 담당).
// 브랜드/히어로 비주얼은 "랜딩 브랜드 비주얼" 문서화 예외라 raw Color 를 여기서만 사용한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 상태바·내비게이션 바 색 — 배경 그림(`landing_background`)의 맨 위·맨 아래 색이다. */
private val LandingSkyTop = Color(0xFF0A2968)
private val LandingSeaBottom = Color(0xFF031236)

private val BrandCtaStart = Color(0xFF3D74FF)
private val BrandCtaEnd = Color(0xFF45B4F5)
private val GlassFill = Color(0x21FFFFFF)
private val GlassBorder = Color(0x2EFFFFFF)
internal val TextOnScene = Color(0xFFF8FAFF)
internal val TextOnSceneDim = Color(0xC8E8EEFA)

/** 랜딩 강조(키워드·재생 표시)용 브랜드 포인트 — 다크 테마 brand primary 와 동일.
 *  배경이 항상 어두운 고정 그림이라 colorScheme 분기 없이 고정값 사용(라이트 테마
 *  primary #175FB0 은 어두운 바다 위에서 대비가 안 나온다). */
internal val BrandAccentOnScene = Color(0xFFA6D2FF)

/**
 * 첫 진입 랜딩 — 가치 제안(일출 그림 + 목소리 미리듣기)만 보여주고, 단일 "시작하기" 로
 * 로그인 폼으로 넘긴다.
 */
@Composable
internal fun LandingScreen(
    contentPadding: PaddingValues,
    onStart: () -> Unit,
) {
    SceneSystemBars(top = LandingSkyTop, bottom = LandingSeaBottom)
    Box(Modifier.fillMaxSize()) {
        // 배경은 그림 한 장이다(2026-11-14 오너 — 코드로 그리던 일출 장면은 갈매기가 선 세 개라 단조로웠다).
        // 화면 비율이 달라도 꽉 채우고 가운데를 기준으로 남는 쪽을 자른다 — 해·갈매기는 그림 가로 가운데 70% 안에 있다.
        // iOS `Views/Auth/AuthBackdrop.swift` 의 `SunriseBackdrop` 도 같은 그림이다.
        Image(
            painter = painterResource(R.drawable.landing_background),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop,
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 22.dp)
                .padding(
                    top = contentPadding.calculateTopPadding() + 14.dp,
                    bottom = contentPadding.calculateBottomPadding() + 22.dp,
                ),
        ) {
            // 접근성 글꼴 확대/좁은 멀티윈도우에서 히어로+미리듣기가 화면보다 커져도
            // '시작하기' CTA 는 아래에 고정으로 남도록, CTA 위 영역만 스크롤 가능하게 둔다.
            BoxWithConstraints(Modifier.weight(1f)) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .heightIn(min = this.maxHeight),
                    // 위의 'AlarmTalk' 워드마크는 없앴다(2026-11-14 오너 — 방금 누르고 들어온 아이콘 이름을 한 번 더
                    // 보여 줄 뿐이다). 남은 덩어리는 아래에 붙여 하늘을 비운다.
                    verticalArrangement = Arrangement.Bottom,
                ) {
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
                    LandingVoicePreview()
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
// 목소리 미리듣기 — 상자 하나에서 기본 목소리 4종을 차례로 들려준다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 랜딩 미리듣기 한 칸 — 목소리 이름(화면에는 쓰지 않고 TalkBack 만 읽는다)·그 목소리의 한마디
 * (`res/raw/landing_preview_<목소리>.mp3`)·그 소리의 파형(실제 크기 변화를 30칸으로 줄인 것).
 */
private data class LandingVoice(@StringRes val name: Int, @RawRes val clip: Int, val levels: List<Float>)

/** 순서는 앱의 기본 목소리 순서(시우·미나·도현·애니 — `data/SystemVoices.kt`). iOS `LandingPreviewVoice.all` 과 같다. */
private val LandingVoices = listOf(
    LandingVoice(
        R.string.system_voice_name_siwoo, R.raw.landing_preview_siwoo,
        listOf(
            0.80f, 0.68f, 0.67f, 0.17f, 0.12f, 0.49f, 0.77f, 0.67f, 0.51f, 0.50f, 0.71f, 0.65f, 0.64f, 0.52f, 0.30f,
            0.13f, 0.12f, 0.43f, 0.63f, 0.50f, 0.72f, 0.35f, 0.46f, 0.61f, 0.70f, 0.34f, 0.12f, 0.65f, 0.71f, 0.20f,
        ),
    ),
    LandingVoice(
        R.string.system_voice_name_mina, R.raw.landing_preview_mina,
        listOf(
            0.40f, 0.64f, 0.38f, 0.51f, 0.80f, 0.45f, 0.53f, 0.39f, 0.13f, 0.56f, 0.72f, 0.61f, 0.53f, 0.67f, 0.42f,
            0.15f, 0.14f, 0.53f, 0.42f, 0.39f, 0.44f, 0.61f, 0.21f, 0.57f, 0.55f, 0.40f, 0.49f, 0.54f, 0.39f, 0.21f,
        ),
    ),
    LandingVoice(
        R.string.system_voice_name_dohyun, R.raw.landing_preview_dohyun,
        listOf(
            0.52f, 0.55f, 0.57f, 0.40f, 0.12f, 0.12f, 0.67f, 0.65f, 0.52f, 0.61f, 0.52f, 0.39f, 0.45f, 0.53f, 0.49f,
            0.23f, 0.12f, 0.51f, 0.60f, 0.63f, 0.53f, 0.47f, 0.43f, 0.12f, 0.17f, 0.80f, 0.71f, 0.70f, 0.57f, 0.13f,
        ),
    ),
    LandingVoice(
        R.string.system_voice_name_aeni, R.raw.landing_preview_narin,
        listOf(
            0.43f, 0.75f, 0.79f, 0.23f, 0.35f, 0.75f, 0.80f, 0.24f, 0.13f, 0.32f, 0.57f, 0.44f, 0.31f, 0.61f, 0.29f,
            0.26f, 0.12f, 0.12f, 0.28f, 0.39f, 0.43f, 0.21f, 0.23f, 0.56f, 0.30f, 0.17f, 0.12f, 0.33f, 0.37f, 0.21f,
        ),
    ),
)

/** 한 번에 하나만 튼다. 같은 클립을 멈춰 둔 것이면 이어서, 다른 클립이면 앞의 것을 버리고 처음부터. */
private class LandingPreviewPlayer {
    private var player: MediaPlayer? = null
    @RawRes private var clip: Int? = null

    fun stop() {
        player?.release()
        player = null
        clip = null
    }

    fun pause() {
        player?.takeIf { it.isPlaying }?.pause()
    }

    /** 끝까지 들으면 [onEnd]. 플레이어를 만들지 못하면 `false`. */
    fun play(context: Context, @RawRes clip: Int, onEnd: () -> Unit): Boolean {
        val current = player
        if (current != null && this.clip == clip) {
            current.start()
            return true
        }
        stop()
        val created = MediaPlayer.create(context, clip) ?: return false
        created.setOnCompletionListener {
            stop()
            onEnd()
        }
        player = created
        this.clip = clip
        created.start()
        return true
    }

    fun progress(): Float {
        val current = player ?: return 0f
        return (current.currentPosition / current.duration.coerceAtLeast(1).toFloat()).coerceIn(0f, 1f)
    }
}

/**
 * 로그인 전 미리듣기 — 상자 하나에서 기본 목소리 4종을 차례로 들려준다(2026-11-14 오너, 11-09 의 '미나 3문장 하나만'
 * 을 대신한다).
 *
 * - 처음엔 가족(할아버지) 샘플 하나와 그 3문장 자막이었다. 실제로는 연인이나 좋아하는 사람 같은 목소리를 찾는 사람이
 *   많아, 목소리마다 다른 한마디(날씨·응원·안부·기상)를 들려준다. **글자는 쓰지 않는다** — 문장도 목소리 이름도.
 *   보이는 것은 재생 표시·그 소리의 파형과 상자 아래 가운데의 점(몇 번째인지)뿐이다. 상자는 둔다 — 없으면 다른 글자와
 *   구분이 안 된다.
 * - **누르면 지금 목소리부터 차례로 이어서 튼다.** 끝까지 들으면 다음 목소리로 넘어가고, 마지막 뒤에는 멈추고 처음으로
 *   돌아간다. 다시 누르면 일시정지, 또 누르면 그 자리에서 잇는다.
 * - **옆으로 밀면 목소리를 바꾼다**(왼쪽 = 다음, 끝에서 처음으로 돈다). 트는 중이면 바꾼 목소리를 곧바로 튼다.
 *   무작위로 돌리지 않는다 — 같은 목소리가 연달아 나오고, 밀어서 고르는 순서와 어긋난다.
 * - TalkBack 은 상자 하나를 '미리듣기'(트는 중이면 '일시정지')로 읽고 '<이름> 목소리, n/4' 를 붙이며, 다음·이전 목소리는
 *   사용자 지정 동작으로 고른다.
 * - iOS `Views/Auth/LandingView.swift` 의 `LandingVoicePreview`.
 */
@Composable
private fun LandingVoicePreview() {
    val context = LocalContext.current
    val preview = remember { LandingPreviewPlayer() }
    var index by remember { mutableIntStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var direction by remember { mutableIntStateOf(1) }
    DisposableEffect(preview) {
        onDispose { preview.stop() }
    }
    LaunchedEffect(playing) {
        // 안드로이드 MediaPlayer 는 진행 콜백이 없어 80ms 마다 위치를 읽는다(예전 카드와 같다).
        while (playing) {
            progress = preview.progress()
            delay(80)
        }
    }

    fun playFrom(target: Int) {
        index = target
        val started = preview.play(context, LandingVoices[target].clip) {
            progress = 0f
            if (target < LandingVoices.lastIndex) {
                direction = 1
                playFrom(target + 1)
            } else {
                playing = false
                direction = -1
                index = 0
            }
        }
        playing = started
    }

    fun step(delta: Int) {
        direction = if (delta >= 0) 1 else -1
        val next = (index + delta + LandingVoices.size) % LandingVoices.size
        preview.stop()
        progress = 0f
        if (playing) playFrom(next) else index = next
    }

    val position = stringResource(
        R.string.auth_landing_voice_position,
        stringResource(LandingVoices[index].name),
        index + 1,
        LandingVoices.size,
    )
    val actionLabel = stringResource(if (playing) R.string.auth_landing_voice_pause else R.string.auth_landing_voice_play)
    val nextLabel = stringResource(R.string.auth_landing_voice_next)
    val previousLabel = stringResource(R.string.auth_landing_voice_previous)
    val interaction = remember { MutableInteractionSource() }
    val swipeThreshold = with(LocalDensity.current) { 36.dp.toPx() }
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Surface(
            // 람다로 넘긴다 — 지역 함수 참조는 캡처가 달라도 같은 값으로 보여 Compose 가 건너뛴다(CLAUDE.md 「Compose 콜백에 지역 함수 참조」).
            onClick = {
                if (playing) {
                    preview.pause()
                    playing = false
                } else {
                    playFrom(index)
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .wakerPressScale(interaction)
                .pointerInput(Unit) {
                    var dragged = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { dragged = 0f },
                        onDragEnd = {
                            if (dragged <= -swipeThreshold) step(1) else if (dragged >= swipeThreshold) step(-1)
                        },
                    ) { change, amount ->
                        change.consume()
                        dragged += amount
                    }
                }
                .semantics {
                    contentDescription = actionLabel
                    stateDescription = position
                    customActions = listOf(
                        CustomAccessibilityAction(nextLabel) { step(1); true },
                        CustomAccessibilityAction(previousLabel) { step(-1); true },
                    )
                },
            shape = WakerPanelShape,
            color = GlassFill,
            border = BorderStroke(1.dp, GlassBorder),
            interactionSource = interaction,
        ) {
            Row(
                modifier = Modifier.padding(start = 10.dp, top = 10.dp, end = 16.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .background(BrandAccentOnScene.copy(alpha = 0.18f), WakerPillShape)
                        .border(1.dp, BrandAccentOnScene.copy(alpha = 0.45f), WakerPillShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                        tint = BrandAccentOnScene,
                    )
                }
                AnimatedContent(
                    targetState = index,
                    modifier = Modifier
                        .weight(1f)
                        .clipToBounds(),
                    transitionSpec = {
                        // 들어오는 쪽이 더 길다 — 퇴장이 빨라야 한다(CLAUDE.md 「동작 원칙」).
                        val sign = direction
                        (slideInHorizontally(tween(220)) { width -> width * sign } + fadeIn(tween(220))) togetherWith
                            (slideOutHorizontally(tween(160)) { width -> -width * sign } + fadeOut(tween(160)))
                    },
                ) { shown ->
                    MiniWaveform(levels = LandingVoices[shown].levels, progress = if (shown == index) progress else 0f)
                }
            }
        }
        // 몇 번째 목소리인지 — 상자 아래 가운데에 둔다(넘겨 보는 목록의 흔한 자리라 밀 수 있다는 게 보인다,
        // 2026-11-14 오너). TalkBack 은 상자의 'n/4' 로 이미 읽으므로 점은 읽지 않는다(의미 없는 Box 다).
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(LandingVoices.size) { dot ->
                Box(
                    Modifier
                        .size(6.dp)
                        .background(
                            color = if (dot == index) BrandAccentOnScene else Color.White.copy(alpha = 0.30f),
                            shape = CircleShape,
                        ),
                )
            }
        }
    }
}

/** 30칸 파형 — 들은 만큼 왼쪽부터 강조색으로 찬다. */
@Composable
private fun MiniWaveform(levels: List<Float>, progress: Float) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(26.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { bar, level ->
            val played = progress > 0f && bar / levels.lastIndex.toFloat() <= progress
            Box(
                modifier = Modifier
                    .width(1.5.dp)
                    .height((4 + level * 20).dp)
                    .background(
                        color = if (played) BrandAccentOnScene else Color.White.copy(alpha = 0.30f),
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
