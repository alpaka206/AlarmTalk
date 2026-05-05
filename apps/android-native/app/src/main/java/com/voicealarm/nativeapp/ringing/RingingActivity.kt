package com.voicealarm.nativeapp.ringing

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
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
            primary = Color(0xFFF0C25C),
            secondary = Color(0xFF7B8FB5),
            background = Color(0xFF1F1B14),
            surface = Color(0xFF2A251D),
            onPrimary = Color(0xFF1F1B14),
            onSurface = Color(0xFFF0EBE0),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.Alarm,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(22.dp))
            Text(
                text = "보이스 알람",
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 36.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "알람이 울리는 중",
                color = Color(0xFFA89F8F),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(48.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (snoozeEnabled) {
                    OutlinedButton(
                        onClick = onSnooze,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Outlined.Snooze, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("다시 울림")
                    }
                }
                Button(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("끄기")
                }
            }
        }
    }
}
