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
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Snooze
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
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
import com.alarmtalk.app.WakerCardShape
import com.alarmtalk.app.WakerDialogShape
import com.alarmtalk.app.WakerPillShape
import com.alarmtalk.app.alarm.AlarmContract.EXTRA_ALARM_ID
import com.alarmtalk.app.alarm.RingingService
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.SnoozeRepeatLimits
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

class RingingActivity : ComponentActivity() {
    private var alarmId by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureLockScreen()
        blockBackNavigation()
        alarmId = intent.getStringExtra(EXTRA_ALARM_ID)

        setContent {
            var uiState by remember { mutableStateOf(RingingUiState()) }
            val currentAlarmId = alarmId
            val appContext = applicationContext
            LaunchedEffect(currentAlarmId) {
                uiState = currentAlarmId?.let { id ->
                    withContext(Dispatchers.IO) {
                        AlarmAppContainer.repository(appContext)
                            .getAlarm(id)
                            ?.toRingingUiState(appContext)
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

// 가이드 .ring 디자인의 다크 블루→블랙 그라데이션 배경.
private val RingingBackground = Brush.verticalGradient(
    listOf(Color(0xFF11355A), Color(0xFF0A1726), Color(0xFF06080E)),
)

@Composable
private fun RingingRoute(
    uiState: RingingUiState,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit,
) {
    // 잠금화면 위에서는 항상 다크로 떠야 하므로 앱 테마를 상속하지 않고
    // 단일 출처인 AlarmTalkDarkColorScheme(브랜드 블루 primary 계열)에서 시작한다.
    // 의도적으로 다른 부분만 override: 살몬 secondary(따뜻한 대비 강조)와 표면 톤.
    MaterialTheme(
        colorScheme = AlarmTalkDarkColorScheme.copy(
            secondary = Color(0xFFF0B8AF),
            onSecondary = Color(0xFF351210),
            secondaryContainer = Color(0xFF4F2824),
            onSecondaryContainer = Color(0xFFFFDED9),
            surface = Color(0xFF131821),
            surfaceVariant = Color(0xFF202833),
            onSurfaceVariant = Color(0xFFB6BEC9),
            outlineVariant = Color(0xFF303A46),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(RingingBackground)
                .systemBarsPadding()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(54.dp))
            Text(
                text = uiState.dateText,
                color = Color(0xFFA6BDDA),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(6.dp))
            RingingClock(ampm = uiState.ampm, time = uiState.timeText)

            Spacer(Modifier.height(30.dp))
            RingingVoiceCard(uiState)

            Spacer(Modifier.weight(1f))

            if (uiState.snoozeEnabled) {
                RingingSnoozeButton(
                    minutes = uiState.snoozeMinutes,
                    onSnooze = onSnooze,
                )
                Spacer(Modifier.height(14.dp))
            }
            RingingSlideToDismiss(onDismiss = onDismiss)
            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable
private fun RingingClock(ampm: String, time: String) {
    Row(
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (ampm.isNotBlank()) {
            Text(
                text = ampm,
                modifier = Modifier.padding(bottom = 18.dp),
                color = Color(0xFFA6BDDA),
                fontSize = 26.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Text(
            text = time,
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 104.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-3).sp,
        )
    }
}

@Composable
private fun RingingVoiceCard(uiState: RingingUiState) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 440.dp),
        shape = WakerDialogShape,
        color = Color(0xFF122034).copy(alpha = 0.66f),
        border = BorderStroke(1.dp, Color(0x24FFFFFF)),
    ) {
        Column(modifier = Modifier.padding(22.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    modifier = Modifier.size(46.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        val initial = uiState.avatarLabel
                        if (initial != null) {
                            Text(
                                text = initial,
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Outlined.Alarm,
                                contentDescription = null,
                                modifier = Modifier.size(24.dp),
                            )
                        }
                    }
                }
                Spacer(Modifier.width(13.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = uiState.title,
                        color = MaterialTheme.colorScheme.onSurface,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = uiState.subtitle,
                        color = Color(0xFFA6BDDA),
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            RingingVoiceWaveform()
            uiState.voiceText?.let { voiceText ->
                Spacer(Modifier.height(16.dp))
                Text(
                    text = stringResource(R.string.rd_voice_text_quoted, voiceText),
                    color = Color(0xFFDBE7F6),
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun RingingSnoozeButton(minutes: Int, onSnooze: () -> Unit) {
    Surface(
        onClick = onSnooze,
        modifier = Modifier
            .fillMaxWidth()
            .height(62.dp),
        shape = WakerCardShape,
        color = Color.White.copy(alpha = 0.07f),
        border = BorderStroke(1.dp, Color(0x24FFFFFF)),
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.Snooze,
                contentDescription = null,
                tint = Color(0xFFCFDDEE),
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(9.dp))
            Text(
                text = stringResource(R.string.rd_snooze_button_minutes, minutes),
                color = Color(0xFFCFDDEE),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

private val SlideTrackBrush = Brush.verticalGradient(
    listOf(Color(0x2E8FC4FF), Color(0x0F8FC4FF)),
)
private val SlideKnobBrush = Brush.verticalGradient(
    listOf(Color(0xFFBFE0FF), Color(0xFF8FC4FF)),
)

@Composable
private fun RingingSlideToDismiss(onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val density = androidx.compose.ui.platform.LocalDensity.current
    val knobSizePx = with(density) { 64.dp.toPx() }
    val edgePadPx = with(density) { 6.dp.toPx() }

    var trackWidthPx by remember { mutableStateOf(0) }
    val offsetX = remember { Animatable(0f) }
    val maxOffset = (trackWidthPx - knobSizePx - edgePadPx * 2).coerceAtLeast(0f)

    // 라벨은 노브가 이동할수록 서서히 사라진다.
    val labelAlpha = if (maxOffset <= 0f) 1f else (1f - offsetX.value / maxOffset).coerceIn(0f, 1f)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(76.dp)
            .onSizeChanged { trackWidthPx = it.width }
            .clip(RoundedCornerShape(26.dp))
            .background(SlideTrackBrush)
            .background(Color.Transparent),
        contentAlignment = Alignment.CenterStart,
    ) {
        // 1dp 라이트블루 보더.
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 1.dp.toPx()
            drawRoundRect(
                color = Color(0x4D8FC4FF),
                topLeft = Offset(stroke / 2f, stroke / 2f),
                size = androidx.compose.ui.geometry.Size(
                    size.width - stroke,
                    size.height - stroke,
                ),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(26.dp.toPx()),
                style = Stroke(width = stroke),
            )
        }

        Text(
            text = stringResource(R.string.rd_slide_to_dismiss),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 60.dp, end = 24.dp)
                .graphicsLayer { alpha = labelAlpha },
            color = Color(0xFFDCECFF),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )

        SlideHintArrows(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 22.dp)
                .graphicsLayer { alpha = labelAlpha },
        )

        Box(
            modifier = Modifier
                .padding(start = 6.dp)
                .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                .size(64.dp)
                .clip(RoundedCornerShape(21.dp))
                .background(SlideKnobBrush)
                .pointerInput(maxOffset) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (maxOffset > 0f && offsetX.value >= maxOffset * 0.7f) {
                                scope.launch {
                                    offsetX.animateTo(maxOffset)
                                    onDismiss()
                                }
                            } else {
                                scope.launch { offsetX.animateTo(0f) }
                            }
                        },
                    ) { change, dragAmount ->
                        change.consume()
                        scope.launch {
                            val next = (offsetX.value + dragAmount).coerceIn(0f, maxOffset)
                            offsetX.snapTo(next)
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.Alarm,
                contentDescription = stringResource(R.string.rd_slide_to_dismiss),
                tint = Color(0xFF06243E),
                modifier = Modifier.size(24.dp),
            )
        }
    }
}

@Composable
private fun SlideHintArrows(modifier: Modifier = Modifier) {
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
                val color = Color(0xFFDCECFF).copy(alpha = alpha)
                // 오른쪽을 가리키는 셰브론.
                drawLine(color, Offset(size.width * 0.3f, size.height * 0.2f), Offset(size.width * 0.75f, size.height * 0.5f), strokeWidth = w)
                drawLine(color, Offset(size.width * 0.75f, size.height * 0.5f), Offset(size.width * 0.3f, size.height * 0.8f), strokeWidth = w)
            }
        }
    }
}

@Composable
private fun RingingVoiceWaveform() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(40.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val levels = listOf(
            0.16f, 0.28f, 0.22f, 0.42f, 0.30f, 0.64f, 0.44f, 0.86f,
            0.52f, 0.72f, 0.38f, 0.58f, 0.34f, 0.66f, 0.42f, 0.78f,
            0.36f, 0.54f, 0.24f, 0.40f, 0.20f,
        )
        levels.forEachIndexed { index, level ->
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height((8 + level * 30).dp)
                    .background(
                        color = when (index) {
                            in 5..14 -> MaterialTheme.colorScheme.primary
                            15, 16, 17 -> MaterialTheme.colorScheme.secondary
                            else -> MaterialTheme.colorScheme.tertiary.copy(alpha = 0.52f)
                        },
                        shape = WakerPillShape,
                    ),
            )
        }
    }
}

private data class RingingUiState(
    val title: String = "",
    val subtitle: String = "",
    val voiceText: String? = null,
    val snoozeEnabled: Boolean = true,
    val snoozeMinutes: Int = 5,
    val dateText: String = "",
    val ampm: String = "",
    val timeText: String = "",
    /** 보이스 카드 아바타에 표시할 라벨 첫 글자 — null 이면 알람 아이콘. */
    val avatarLabel: String? = null,
)

/** 알람을 아직 불러오지 못했을 때(빈 상태) 표시할 기본 UI 상태. */
private fun defaultRingingUiState(context: android.content.Context): RingingUiState {
    val now = java.time.LocalTime.now()
    return RingingUiState(
        title = context.getString(R.string.rd2_ringing_title_default),
        subtitle = context.getString(R.string.rd2_ringing_subtitle_now),
        dateText = todayDateLabel(context),
        ampm = if (now.hour < 12) {
            context.getString(R.string.rd2_am)
        } else {
            context.getString(R.string.rd2_pm)
        },
        timeText = alarmClockLabel(now.hour, now.minute),
    )
}

private fun AlarmEntity.toRingingUiState(context: android.content.Context): RingingUiState {
    val customTitle = label.trim()
        .takeIf { it.isNotBlank() && it != context.getString(R.string.rd_default_alarm_label) }
    val voiceMessage = voiceText
        ?.trim()
        ?.takeIf { it.isNotBlank() && playMode != AlarmPlayModes.ALARM_ONLY }
    val snoozeAvailable = snoozeEnabled &&
        (
            snoozeRepeatLimit == SnoozeRepeatLimits.FOREVER ||
                snoozeCount < snoozeRepeatLimit
            )

    return RingingUiState(
        title = customTitle ?: context.getString(R.string.rd2_ringing_title_default),
        subtitle = if (customTitle != null) {
            ringingModeLabel(context, playMode, voiceMessage != null)
        } else {
            context.getString(R.string.rd2_ringing_subtitle_now)
        },
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
        avatarLabel = customTitle?.take(1),
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

private fun ringingModeLabel(
    context: android.content.Context,
    playMode: String,
    hasVoiceText: Boolean,
): String = when {
    hasVoiceText -> context.getString(R.string.rd2_ringing_mode_voice_alarm)
    playMode == AlarmPlayModes.VOICE_ONLY -> context.getString(R.string.rd2_ringing_mode_voice_only)
    playMode == AlarmPlayModes.ALARM_VOICE -> context.getString(R.string.rd2_ringing_mode_alarm_voice)
    else -> context.getString(R.string.rd2_ringing_title_default)
}
