package com.voicealarm.nativeapp.ringing

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.alarm.AlarmContract.EXTRA_ALARM_ID
import com.voicealarm.nativeapp.alarm.RingingService
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.SnoozeRepeatLimits
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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
            LaunchedEffect(currentAlarmId) {
                uiState = currentAlarmId?.let { id ->
                    withContext(Dispatchers.IO) {
                        AlarmAppContainer.repository(applicationContext)
                            .getAlarm(id)
                            ?.toRingingUiState()
                    }
                } ?: RingingUiState()
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

@Composable
private fun RingingRoute(
    uiState: RingingUiState,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit,
) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFFA8D4FF),
            onPrimary = Color(0xFF08243C),
            primaryContainer = Color(0xFF1E4263),
            onPrimaryContainer = Color(0xFFD9ECFF),
            secondary = Color(0xFFF0B8AF),
            onSecondary = Color(0xFF351210),
            secondaryContainer = Color(0xFF4F2824),
            onSecondaryContainer = Color(0xFFFFDED9),
            tertiary = Color(0xFFC7E5D6),
            onTertiary = Color(0xFF123226),
            background = Color(0xFF090A0F),
            surface = Color(0xFF131821),
            surfaceVariant = Color(0xFF202833),
            onSurface = Color(0xFFF7F7FA),
            onSurfaceVariant = Color(0xFFB6BEC9),
            outlineVariant = Color(0xFF303A46),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(horizontal = 24.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            RingingStatusPill()
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Surface(
                    modifier = Modifier.size(112.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Outlined.Alarm,
                            contentDescription = null,
                            modifier = Modifier.size(58.dp),
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
                Text(
                    text = uiState.title,
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = uiState.subtitle,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                uiState.voiceText?.let { voiceText ->
                    Spacer(Modifier.height(22.dp))
                    RingingVoiceText(voiceText)
                }
                Spacer(Modifier.height(24.dp))
                RingingVoiceWaveform()
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (uiState.snoozeEnabled) {
                    OutlinedButton(
                        onClick = onSnooze,
                        modifier = Modifier
                            .weight(1f)
                            .height(58.dp),
                        shape = RoundedCornerShape(18.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.onSurface,
                        ),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    ) {
                        Icon(Icons.Outlined.Snooze, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("다시 울리기")
                    }
                }
                Button(
                    onClick = onDismiss,
                    modifier = Modifier
                        .weight(1f)
                        .height(58.dp),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Text("알람 끄기")
                }
            }
        }
    }
}

@Composable
private fun RingingStatusPill() {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.GraphicEq,
                contentDescription = null,
                modifier = Modifier.size(17.dp),
            )
            Text(
                text = "알람 울림",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun RingingVoiceText(text: String) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 420.dp),
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
            maxLines = 4,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun RingingVoiceWaveform() {
    Row(
        modifier = Modifier
            .fillMaxWidth(0.76f)
            .height(54.dp),
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
                    .height((8 + level * 42).dp)
                    .background(
                        color = when (index) {
                            in 5..14 -> MaterialTheme.colorScheme.primary
                            15, 16, 17 -> MaterialTheme.colorScheme.secondary
                            else -> MaterialTheme.colorScheme.tertiary.copy(alpha = 0.52f)
                        },
                        shape = RoundedCornerShape(999.dp),
                    ),
            )
        }
    }
}

private data class RingingUiState(
    val title: String = "알람이 울리고 있어요",
    val subtitle: String = "지금 알람을 확인해 주세요",
    val voiceText: String? = null,
    val snoozeEnabled: Boolean = true,
)

private fun AlarmEntity.toRingingUiState(): RingingUiState {
    val customTitle = label.trim().takeIf { it.isNotBlank() && it != "알람" }
    val timeText = alarmTimeLabel(hour, minute)
    val voiceMessage = voiceText
        ?.trim()
        ?.takeIf { it.isNotBlank() && playMode != AlarmPlayModes.ALARM_ONLY }
    val snoozeAvailable = snoozeEnabled &&
        (
            snoozeRepeatLimit == SnoozeRepeatLimits.FOREVER ||
                snoozeCount < snoozeRepeatLimit
            )

    return RingingUiState(
        title = customTitle ?: timeText,
        subtitle = if (customTitle != null) timeText else ringingModeLabel(playMode, voiceMessage != null),
        voiceText = voiceMessage,
        snoozeEnabled = snoozeAvailable,
    )
}

private fun alarmTimeLabel(hour: Int, minute: Int): String {
    val marker = if (hour < 12) "오전" else "오후"
    val hour12 = hour % 12
    val displayHour = if (hour12 == 0) 12 else hour12
    return "$marker $displayHour:${"%02d".format(minute)}"
}

private fun ringingModeLabel(playMode: String, hasVoiceText: Boolean): String = when {
    hasVoiceText -> "목소리 알람이 울리고 있어요"
    playMode == AlarmPlayModes.VOICE_ONLY -> "음성이 울리고 있어요"
    playMode == AlarmPlayModes.ALARM_VOICE -> "알람과 음성이 준비되어 있어요"
    else -> "알람이 울리고 있어요"
}
