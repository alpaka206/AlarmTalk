package com.alarmtalk.app.ringing

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.animation.core.Animatable
import androidx.compose.ui.graphics.graphicsLayer
import com.alarmtalk.app.AlarmTalkDarkColorScheme
import com.alarmtalk.app.R
import com.alarmtalk.app.stripDeliveryTags
import com.alarmtalk.app.fitToWidthScale
import com.alarmtalk.app.alarm.AlarmContract.EXTRA_ALARM_ID
import com.alarmtalk.app.alarm.RingingService
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.bucketClipTexts
import com.alarmtalk.app.data.SnoozeRepeatLimits
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import com.alarmtalk.app.HomeGradientDark
import com.alarmtalk.app.WakerPillShape

class RingingActivity : ComponentActivity() {
    private var alarmId by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureLockScreen()
        blockBackNavigation()
        alarmId = intent.getStringExtra(EXTRA_ALARM_ID)
        ensureRingingServiceStarted()

        setContent {
            var uiState by remember { mutableStateOf(RingingUiState()) }
            val currentAlarmId = alarmId
            val appContext = applicationContext
            LaunchedEffect(currentAlarmId) {
                uiState = currentAlarmId?.let { id ->
                    withContext(Dispatchers.IO) {
                        val repository = AlarmAppContainer.repository(appContext)
                        repository.getAlarm(id)?.let { alarm ->
                            val playbackVariantIndex = repository.resolveBucketClipSelection(alarm)?.variantIndex
                            alarm.toRingingUiState(appContext, playbackVariantIndex)
                        }
                    }
                } ?: defaultRingingUiState(appContext)
            }
            RingingRoute(
                uiState = uiState,
                onDismiss = {
                    currentAlarmId?.let { RingingService.dismiss(this, it) }
                    finishAndRemoveTask()
                },
                onSnooze = {
                    currentAlarmId?.let { RingingService.snooze(this, it) }
                    finishAndRemoveTask()
                },
            )
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        alarmId = intent.getStringExtra(EXTRA_ALARM_ID)
        ensureRingingServiceStarted()
    }

    /**
     * FGS 시작이 막혀(Android 12+) 풀스크린 알림 폴백으로 이 화면이 떴을 때, 울림 서비스(소리·진동)가
     * 아직 안 돌고 있으면 여기서 시작한다. 가시 액티비티에서의 FGS 시작은 허용된다. 이미 같은 알람을
     * 울리는 중이면 건너뛰어 중복 시작과 서비스→액티비티 재오픈 루프를 막는다.
     */
    private fun ensureRingingServiceStarted() {
        val id = alarmId ?: return
        if (RingingService.activeRingingAlarmId != id) {
            RingingService.start(this, id)
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        hideSystemBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun blockBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    hideSystemBars()
                }
            },
        )
    }

    private fun configureLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
            )
        }

        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
        )
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}

/**
 * 울림 화면 (2026-09-06 다시 그림).
 *
 * 자다 깬 사람이 3초 안에 알아야 할 것은 **몇 시인가**와 **무엇이 울리는가** 둘이다. 그래서
 * 시계가 가장 크고, 문구는 카드 없이 시계 아래에 바로 놓는다. 색은 여기서 새로 짓지 않는다 —
 * 잠금화면 위라 앱 테마를 상속하지는 않지만 값은 전부 `AlarmTalkDarkColorScheme` 과 홈 탭
 * 그라데이션(`HomeGradientDark`)에서 온다. 예전에는 이 파일에만 있는 고정색 8종이었고, 잠금화면에서
 * 앱으로 넘어가면 다른 앱처럼 보였다.
 *
 * 끄기와 다시 알림은 **비대칭**이다(탭 = 다시 알림, 밀기 = 끄기). 다시 알림은 가벼운 캡슐로,
 * 끄기는 채운 손잡이의 슬라이더로 그려 어느 쪽이 되돌릴 수 없는지 보이게 한다.
 * ⚠ 슬라이더에 관성·플릭 판정을 넣지 말 것 — 잠결에 한 번 튕기면 알람이 영구 종료된다
 *   (`docs/spec/alarm-ringing.md`). 마찰이 이 컨트롤의 존재 이유다.
 */
@Composable
private fun RingingRoute(
    uiState: RingingUiState,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit,
) {
    // 잠금화면 위에서는 항상 다크로 떠야 하므로 앱 테마를 상속하지 않는다. 값은 단일 출처 그대로.
    MaterialTheme(colorScheme = AlarmTalkDarkColorScheme) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(HomeGradientDark)
                .systemBarsPadding()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(54.dp))
            // 날짜 줄에 알람 이름을 합친다 — 카드 한 장을 줄인다.
            Text(
                text = listOfNotNull(uiState.dateText.takeIf { it.isNotBlank() }, uiState.label)
                    .joinToString(" · "),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(6.dp))
            RingingClock(ampm = uiState.ampm, time = uiState.timeText)

            Spacer(Modifier.height(34.dp))
            val voice = uiState.voiceText
            if (voice != null) {
                RingingMessage(voice)
            } else {
                // 문구가 없는 알람은 빈 카드를 그리지 않는다 — 무엇이 울리는지 칩 하나로 말한다.
                RingingToneChip()
            }

            Spacer(Modifier.weight(1f))

            if (uiState.snoozeEnabled) {
                RingingSnoozeButton(
                    minutes = uiState.snoozeMinutes,
                    onSnooze = onSnooze,
                )
                Spacer(Modifier.height(16.dp))
            }
            RingingSlideToDismiss(onDismiss = onDismiss)
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * 울림 화면의 시계.
 *
 * ⚠ **폭에 맞춰 줄인다.** 104sp 를 고정으로 두면 좁은 화면(갤럭시 폴드 커버 화면 등)이나
 * 큰 글꼴에서 '오전' 과 시각이 서로 **겹쳐 보인다**(실제 제보). 이 화면은 자다 깬 사람이
 * 몇 시인지 확인하는 곳이라 시각이 읽히지 않으면 화면 자체가 쓸모없다.
 *
 * 배율은 [가용 폭] ÷ ([기준 폭] × [글꼴 배율]) 이다 — 글꼴 배율을 나누는 이유는, 폭은
 * dp 라 사용자가 글꼴을 키워도 그대로지만 글자만 커져 넘치기 때문이다. 알람 편집기의
 * `AlarmTimePicker` 도 같은 방식으로 줄인다.
 */
@Composable
private fun RingingClock(ampm: String, time: String) {
    // '오전' + 104sp 시각이 여유롭게 들어가는 폭. 이보다 넓으면 줄이지 않는다.
    val referenceWidth = 320.dp
    BoxWithConstraints {
        val scale = fitToWidthScale(maxWidth, referenceWidth)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(10.dp * scale),
        ) {
            if (ampm.isNotBlank()) {
                Text(
                    text = ampm,
                    modifier = Modifier.padding(bottom = 18.dp * scale),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 26.sp * scale,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    softWrap = false,
                )
            }
            Text(
                text = time,
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 104.sp * scale,
                fontWeight = FontWeight.Bold,
                // 큰 숫자는 자간을 조인다(-0.03em) — 기본 자간이면 흩어져 보인다.
                letterSpacing = (-3).sp * scale,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

/**
 * 울리는 문구. 카드 없이 시계 아래에 바로 — 카드는 시계와 겨루는 두 번째 상자였다.
 * 긴 문구가 컨트롤을 화면 밖으로 밀지 않도록 세 줄에서 자른다(전문은 목소리가 읽는다).
 */
@Composable
private fun RingingMessage(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 440.dp),
        color = MaterialTheme.colorScheme.onSurface,
        fontSize = 23.sp,
        lineHeight = 33.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = (-0.3).sp,
        textAlign = TextAlign.Center,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun RingingToneChip() {
    Surface(
        shape = WakerPillShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.Notifications,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = stringResource(R.string.rd_tone_only),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/** 다시 알림 — 가벼운 캡슐. 끄기 슬라이더보다 눈에 띄지 않아야 어느 쪽이 되돌릴 수 없는지 보인다. */
@Composable
private fun RingingSnoozeButton(minutes: Int, onSnooze: () -> Unit) {
    Surface(
        onClick = onSnooze,
        modifier = Modifier
            .height(52.dp)
            .widthIn(min = 160.dp),
        shape = WakerPillShape,
        color = Color.Transparent,
        // 테두리가 이 버튼의 유일한 경계다 — outline(#4C587E)은 바닥 위 2.4:1 이라 비텍스트 기준(3:1)에
        // 못 미친다. onSurfaceVariant 60% 면 3.7:1.
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .padding(horizontal = 26.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = stringResource(R.string.rd_snooze_button_minutes, minutes),
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.86f),
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * 밀어서 끄기.
 *
 * - 손잡이는 **누르는 순간** 눌린다(0.94, 튕기지 않는 스프링) — 놓을 때가 아니라.
 * - 70% 문턱을 **넘는 순간** 햅틱 한 번 — 손을 떼면 끝난다는 신호. 되돌아오면 다시 무장한다.
 * - 밀기밖에 없는 탈출구는 TalkBack·스위치 사용자에게 없는 것과 같다 — 접근성 커스텀 액션
 *   '끄기' 를 붙인다. 길게 누르기는 일부러 두지 않는다(잠결에 손을 얹기만 해도 꺼진다).
 * - 관성·플릭 판정은 없다. 끝까지 밀어야 한다.
 */
@Composable
private fun RingingSlideToDismiss(onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val view = LocalView.current
    val knobSizePx = with(density) { 60.dp.toPx() }
    val edgePadPx = with(density) { 6.dp.toPx() }

    var trackWidthPx by remember { mutableStateOf(0) }
    val offsetX = remember { Animatable(0f) }
    val maxOffset = (trackWidthPx - knobSizePx - edgePadPx * 2).coerceAtLeast(0f)
    val threshold = maxOffset * 0.7f

    var pressed by remember { mutableStateOf(false) }
    val knobScale by animateFloatAsState(
        targetValue = if (pressed) 0.94f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "knobPress",
    )

    // 라벨은 노브가 이동할수록 서서히 사라진다.
    val labelAlpha = if (maxOffset <= 0f) 1f else (1f - offsetX.value / maxOffset).coerceIn(0f, 1f)
    val dismissLabel = stringResource(R.string.rd_slide_to_dismiss)
    val dismissAction = stringResource(R.string.rd_dismiss_action)
    val hintColor = MaterialTheme.colorScheme.onSurfaceVariant

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .onSizeChanged { trackWidthPx = it.width }
            .clip(WakerPillShape)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.35f), WakerPillShape)
            .semantics {
                customActions = listOf(
                    CustomAccessibilityAction(dismissAction) {
                        onDismiss()
                        true
                    },
                )
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text = dismissLabel,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 60.dp, end = 24.dp)
                .graphicsLayer { alpha = labelAlpha },
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )

        SlideHintArrows(
            color = hintColor,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 22.dp)
                .graphicsLayer { alpha = labelAlpha },
        )

        Box(
            modifier = Modifier
                .padding(start = 6.dp)
                .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                .size(60.dp)
                .graphicsLayer {
                    scaleX = knobScale
                    scaleY = knobScale
                }
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
                .pointerInput(maxOffset) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        pressed = true
                        var latest = offsetX.value
                        var crossed = false
                        fun moveBy(delta: Float) {
                            latest = (latest + delta).coerceIn(0f, maxOffset)
                            val target = latest
                            scope.launch { offsetX.snapTo(target) }
                            if (maxOffset > 0f) {
                                if (!crossed && latest >= threshold) {
                                    crossed = true
                                    view.performThresholdHaptic()
                                } else if (crossed && latest < threshold) {
                                    crossed = false
                                }
                            }
                        }
                        val dragStart = awaitHorizontalTouchSlopOrCancellation(down.id) { change, overSlop ->
                            change.consume()
                            moveBy(overSlop)
                        }
                        if (dragStart != null) {
                            horizontalDrag(dragStart.id) { change ->
                                val delta = change.positionChange().x
                                change.consume()
                                moveBy(delta)
                            }
                        }
                        pressed = false
                        if (maxOffset > 0f && latest >= threshold) {
                            scope.launch {
                                offsetX.animateTo(maxOffset)
                                onDismiss()
                            }
                        } else {
                            scope.launch { offsetX.animateTo(0f) }
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                contentDescription = dismissLabel,
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(24.dp),
            )
        }
    }
}

/** 문턱을 넘는 순간의 햅틱. CONFIRM 은 API 30 부터라 그 아래는 키 탭으로 대신한다. */
private fun View.performThresholdHaptic() {
    val constant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        HapticFeedbackConstants.CONFIRM
    } else {
        HapticFeedbackConstants.KEYBOARD_TAP
    }
    performHapticFeedback(constant)
}

@Composable
private fun SlideHintArrows(color: Color, modifier: Modifier = Modifier) {
    // 시스템 애니메이터 배율(축소 동작)은 Compose 가 MotionDurationScale 로 그대로 먹는다.
    val transition = rememberInfiniteTransition(label = "slideHint")
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        repeat(3) { index ->
            val alpha by transition.animateFloat(
                initialValue = 0.25f,
                targetValue = 0.9f,
                animationSpec = infiniteRepeatable(
                    animation = tween(durationMillis = 750, delayMillis = index * 180, easing = LinearEasing),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "arrow$index",
            )
            Canvas(modifier = Modifier.size(11.dp)) {
                val w = 2.4.dp.toPx()
                val c = color.copy(alpha = alpha)
                // 오른쪽을 가리키는 셰브론.
                drawLine(c, Offset(size.width * 0.3f, size.height * 0.2f), Offset(size.width * 0.75f, size.height * 0.5f), strokeWidth = w)
                drawLine(c, Offset(size.width * 0.75f, size.height * 0.5f), Offset(size.width * 0.3f, size.height * 0.8f), strokeWidth = w)
            }
        }
    }
}

private data class RingingUiState(
    /** 사용자가 지은 알람 이름 — 없으면 카드에 라벨 줄을 그리지 않는다. */
    val label: String? = null,
    val voiceText: String? = null,
    val snoozeEnabled: Boolean = true,
    val snoozeMinutes: Int = 5,
    val dateText: String = "",
    val ampm: String = "",
    val timeText: String = "",
)

/** 알람을 아직 불러오지 못했을 때(빈 상태) 표시할 기본 UI 상태. */
private fun defaultRingingUiState(context: android.content.Context): RingingUiState {
    val now = java.time.LocalTime.now()
    return RingingUiState(
        dateText = todayDateLabel(context),
        ampm = if (now.hour < 12) {
            context.getString(R.string.rd2_am)
        } else {
            context.getString(R.string.rd2_pm)
        },
        timeText = alarmClockLabel(now.hour, now.minute),
    )
}

private fun AlarmEntity.toRingingUiState(
    context: android.content.Context,
    playbackVariantIndex: Int?,
): RingingUiState {
    val customTitle = label.trim()
        .takeIf { it.isNotBlank() && it != context.getString(R.string.rd_default_alarm_label) }
    // 표시 텍스트: 버킷 알람이면 발사 시 고른 variant 의 문구를 쓴다(오디오와 같은 bucketVariantIndex).
    // 그래야 날씨/운세 매칭 버킷에서 음성('비 와요')과 잠금화면 문구가 어긋나지 않는다. 버킷이 아니면
    // 기존 voiceText. 서버가 delivery 태그를 이미 제거하지만 과거분/회귀 대비 한 번 더 벗긴다 —
    // 단 **기계가 만든 문구일 때만**이다. 버킷 클립은 우리가 만든 스톡 문구라 항상 대상이고,
    // 그 외에는 랜덤/프리셋일 때만 벗긴다. 직접 입력 문구의 대괄호는 사용자 것이라 손대지
    // 않는다 — 태그와 같은 단어를 사용자가 쓸 수 있다(`[calm] 약 먹기`, Codex #660).
    // 빈/공백 문구는 null 로 취급해 대표 voiceText 로 폴백한다(Elvis 는 null 에만 걸려, "" 면 잠금화면
    // 문구가 통째로 사라진다). 한 variant 의 text 가 비어도 대표 문구는 보인다.
    val bucketText = if (bucketId != null && playbackVariantIndex != null) {
        bucketClipTexts().getOrNull(playbackVariantIndex)?.takeIf { it.isNotBlank() }
    } else {
        null
    }
    val displayedVoiceText = bucketText ?: voiceText
    val voiceMessage = displayedVoiceText
        ?.let { raw -> raw.stripDeliveryTags(generated = bucketText != null || voiceRandomPrompt) }
        ?.takeIf { it.isNotBlank() && playMode != AlarmPlayModes.ALARM_ONLY }
    val snoozeAvailable = snoozeEnabled &&
        (
            snoozeRepeatLimit == SnoozeRepeatLimits.FOREVER ||
                snoozeCount < snoozeRepeatLimit
            )

    return RingingUiState(
        label = customTitle,
        voiceText = voiceMessage,
        snoozeEnabled = snoozeAvailable,
        snoozeMinutes = snoozeMinutes,
        dateText = todayDateLabel(context),
        ampm = if (hour < 12) {
            context.getString(R.string.rd2_am)
        } else {
            context.getString(R.string.rd2_pm)
        },
        timeText = alarmClockLabel(hour, minute),
    )
}

private fun todayDateLabel(context: android.content.Context): String {
    val today = LocalDate.now()
    val weekday = today.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault())
    return context.getString(
        R.string.rd2_ringing_date,
        today.monthValue,
        today.dayOfMonth,
        weekday,
    )
}

/** "6:30" 형태(12시간제, 분 0패딩) — 큰 시계 표시용. */
private fun alarmClockLabel(hour: Int, minute: Int): String {
    val hour12 = hour % 12
    val displayHour = if (hour12 == 0) 12 else hour12
    return "$displayHour:${"%02d".format(minute)}"
}

