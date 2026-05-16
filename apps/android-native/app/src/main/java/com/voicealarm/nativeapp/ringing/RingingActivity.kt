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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.alarm.AlarmContract.EXTRA_ALARM_ID
import com.voicealarm.nativeapp.alarm.RingingService
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.data.SnoozeRepeatLimits
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class RingingActivity : ComponentActivity() {
    private var alarmId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureLockScreen()
        blockBackNavigation()
        alarmId = intent.getStringExtra(EXTRA_ALARM_ID)

        setContent {
            var snoozeEnabled by remember { mutableStateOf(true) }
            val currentAlarmId = alarmId
            LaunchedEffect(currentAlarmId) {
                snoozeEnabled = currentAlarmId?.let { id ->
                    withContext(Dispatchers.IO) {
                        AlarmAppContainer.repository(applicationContext).getAlarm(id)?.let { alarm ->
                            alarm.snoozeEnabled &&
                                (
                                    alarm.snoozeRepeatLimit == SnoozeRepeatLimits.FOREVER ||
                                        alarm.snoozeCount < alarm.snoozeRepeatLimit
                                    )
                        }
                    }
                } ?: true
            }
            RingingRoute(
                snoozeEnabled = snoozeEnabled,
                onDismiss = {
                    alarmId?.let { RingingService.dismiss(this, it) }
                    finishAndRemoveTask()
                },
                onSnooze = {
                    alarmId?.let { RingingService.snooze(this, it) }
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
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
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
    snoozeEnabled: Boolean,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit,
) {
    MaterialTheme(
        colorScheme = androidx.compose.material3.darkColorScheme(
            primary = Color(0xFFE6A6A1),
            secondary = Color(0xFFA9C8E8),
            background = Color(0xFF090A0F),
            surface = Color(0xFF14161E),
            onPrimary = Color(0xFF2C1110),
            onSurface = Color(0xFFF7F7FA),
            onSurfaceVariant = Color(0xFFA8AEBA),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Spacer(Modifier.height(24.dp))
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Surface(
                    modifier = Modifier.size(128.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.16f),
                    contentColor = MaterialTheme.colorScheme.primary,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Outlined.Alarm,
                            contentDescription = null,
                            modifier = Modifier.size(68.dp),
                        )
                    }
                }
                Spacer(Modifier.height(28.dp))
                Text(
                    text = "좋아하는 목소리로\n일어날 시간이에요",
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "오늘의 목소리 알람이 울리고 있어요",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(28.dp))
                RingingVoiceWaveform()
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (snoozeEnabled) {
                    OutlinedButton(
                        onClick = onSnooze,
                        modifier = Modifier
                            .weight(1f)
                            .height(58.dp),
                        shape = RoundedCornerShape(18.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.onSurface,
                        ),
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
private fun RingingVoiceWaveform() {
    Row(
        modifier = Modifier
            .fillMaxWidth(0.78f)
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
                            in 5..15 -> MaterialTheme.colorScheme.primary
                            16, 17 -> MaterialTheme.colorScheme.secondary
                            else -> MaterialTheme.colorScheme.outlineVariant
                        },
                        shape = RoundedCornerShape(999.dp),
                    ),
            )
        }
    }
}
