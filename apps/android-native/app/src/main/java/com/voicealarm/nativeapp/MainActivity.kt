package com.voicealarm.nativeapp

import android.Manifest
import android.app.AlarmManager
import android.app.Application
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.AlarmAdd
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.voicealarm.nativeapp.alarm.AlarmScheduler
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.data.AlarmEntity
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            VoiceAlarmTheme {
                VoiceAlarmApp()
            }
        }
    }
}

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = AlarmAppContainer.repository(application)

    val alarms: StateFlow<List<AlarmEntity>> = repository.observeAlarms()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    var message by mutableStateOf<String?>(null)
        private set

    fun createTestAlarm(delayMinutes: Int) {
        viewModelScope.launch {
            runCatching {
                repository.createTestAlarm(delayMinutes)
            }.onSuccess { alarm ->
                message = "Scheduled ${alarm.label} in $delayMinutes min"
            }.onFailure { error ->
                Log.e(TAG, "Failed to create test alarm", error)
                message = error.message ?: "Failed to schedule alarm"
            }
        }
    }

    fun clearMessage() {
        message = null
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VoiceAlarmApp(viewModel: MainViewModel = viewModel()) {
    val context = LocalContext.current
    val alarms by viewModel.alarms.collectAsStateWithLifecycle()
    val message = viewModel.message
    var permissions by remember { mutableStateOf(PermissionSnapshot.read(context)) }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) {
        permissions = PermissionSnapshot.read(context)
    }

    RefreshPermissionsOnResume {
        permissions = PermissionSnapshot.read(context)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Voice Alarm",
                        fontWeight = FontWeight.SemiBold,
                    )
                },
            )
        },
    ) { padding ->
        MainScreen(
            contentPadding = padding,
            permissions = permissions,
            alarms = alarms,
            message = message,
            onClearMessage = viewModel::clearMessage,
            onCreateAlarm = viewModel::createTestAlarm,
            onRequestNotifications = {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            },
            onRequestExactAlarms = { context.openExactAlarmSettings() },
            onRequestFullScreen = { context.openFullScreenIntentSettings() },
        )
    }
}

@Composable
private fun MainScreen(
    contentPadding: PaddingValues,
    permissions: PermissionSnapshot,
    alarms: List<AlarmEntity>,
    message: String?,
    onClearMessage: () -> Unit,
    onCreateAlarm: (Int) -> Unit,
    onRequestNotifications: () -> Unit,
    onRequestExactAlarms: () -> Unit,
    onRequestFullScreen: () -> Unit,
) {
    var delayMinutes by remember { mutableIntStateOf(1) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            PermissionPanel(
                permissions = permissions,
                onRequestNotifications = onRequestNotifications,
                onRequestExactAlarms = onRequestExactAlarms,
                onRequestFullScreen = onRequestFullScreen,
            )
        }

        item {
            OutlinedCard(
                colors = CardDefaults.outlinedCardColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(
                        text = "Test alarm",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        IconButton(
                            onClick = { delayMinutes = (delayMinutes - 1).coerceAtLeast(1) },
                            enabled = delayMinutes > 1,
                        ) {
                            Icon(Icons.Outlined.Close, contentDescription = "Decrease")
                        }
                        Text(
                            text = "$delayMinutes min",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        IconButton(
                            onClick = { delayMinutes = (delayMinutes + 1).coerceAtMost(5) },
                            enabled = delayMinutes < 5,
                        ) {
                            Icon(Icons.Outlined.AlarmAdd, contentDescription = "Increase")
                        }
                    }
                    Button(
                        onClick = { onCreateAlarm(delayMinutes) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Outlined.AlarmAdd, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Schedule exact alarm")
                    }
                }
            }
        }

        if (message != null) {
            item {
                AssistChip(
                    onClick = onClearMessage,
                    label = { Text(message) },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Outlined.CheckCircle,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                    },
                )
            }
        }

        item {
            Text(
                text = "Local alarms",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        if (alarms.isEmpty()) {
            item {
                Text(
                    text = "No local alarms",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            items(alarms, key = { it.id }) { alarm ->
                AlarmRow(alarm)
            }
        }
    }
}

@Composable
private fun PermissionPanel(
    permissions: PermissionSnapshot,
    onRequestNotifications: () -> Unit,
    onRequestExactAlarms: () -> Unit,
    onRequestFullScreen: () -> Unit,
) {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Permissions",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            PermissionRow(
                icon = Icons.Outlined.Alarm,
                label = "Exact alarms",
                granted = permissions.exactAlarms,
                actionLabel = "Open",
                onAction = onRequestExactAlarms,
            )
            PermissionRow(
                icon = Icons.Outlined.Notifications,
                label = "Notifications",
                granted = permissions.notifications,
                actionLabel = "Allow",
                onAction = onRequestNotifications,
            )
            PermissionRow(
                icon = Icons.Outlined.Fullscreen,
                label = "Full screen",
                granted = permissions.fullScreenIntent,
                actionLabel = "Open",
                onAction = onRequestFullScreen,
            )
        }
    }
}

@Composable
private fun PermissionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    granted: Boolean,
    actionLabel: String,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(icon, contentDescription = null)
            Column {
                Text(text = label, fontWeight = FontWeight.Medium)
                Text(
                    text = if (granted) "Allowed" else "Required",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (granted) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                )
            }
        }
        if (granted) {
            Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        } else {
            TextButton(onClick = onAction) {
                Icon(Icons.Outlined.ErrorOutline, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(actionLabel)
            }
        }
    }
}

@Composable
private fun AlarmRow(alarm: AlarmEntity) {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = alarm.label, fontWeight = FontWeight.SemiBold)
                Text(
                    text = alarm.state,
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
            Text(
                text = formatFireTime(alarm.fireAtMillis),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "snooze ${alarm.snoozeMinutes} min",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RefreshPermissionsOnResume(onResume: () -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnResume by rememberUpdatedState(onResume)

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) currentOnResume()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }
}

private data class PermissionSnapshot(
    val exactAlarms: Boolean,
    val notifications: Boolean,
    val fullScreenIntent: Boolean,
) {
    companion object {
        fun read(context: Context): PermissionSnapshot {
            val alarmManager = requireNotNull(context.getSystemService<AlarmManager>())
            val notificationManager = NotificationManagerCompat.from(context)
            val platformNotificationManager = requireNotNull(context.getSystemService<NotificationManager>())

            val exactAlarms = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                alarmManager.canScheduleExactAlarms()
            val notifications = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                notificationManager.areNotificationsEnabled()
            val fullScreenIntent = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
                platformNotificationManager.canUseFullScreenIntent()

            return PermissionSnapshot(
                exactAlarms = exactAlarms,
                notifications = notifications,
                fullScreenIntent = fullScreenIntent,
            )
        }
    }
}

private fun Context.openExactAlarmSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return

    val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        data = Uri.parse("package:$packageName")
    }
    startSettingsActivity(intent)
}

private fun Context.openFullScreenIntentSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return

    val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
        data = Uri.parse("package:$packageName")
    }
    startSettingsActivity(intent)
}

private fun Context.startSettingsActivity(intent: Intent) {
    runCatching {
        ContextCompat.startActivity(this, intent, null)
    }.recoverCatching { error ->
        if (error is ActivityNotFoundException) {
            ContextCompat.startActivity(
                this,
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                },
                null,
            )
        } else {
            throw error
        }
    }.onFailure { error ->
        Log.e(TAG, "Failed to open settings", error)
    }
}

private fun formatFireTime(millis: Long): String {
    val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
    return Instant.ofEpochMilli(millis)
        .atZone(ZoneId.systemDefault())
        .format(formatter)
}

@Composable
private fun VoiceAlarmTheme(content: @Composable () -> Unit) {
    val colorScheme = androidx.compose.material3.lightColorScheme(
        primary = androidx.compose.ui.graphics.Color(0xFF2563EB),
        secondary = androidx.compose.ui.graphics.Color(0xFF0F766E),
        error = androidx.compose.ui.graphics.Color(0xFFB42318),
        surface = androidx.compose.ui.graphics.Color(0xFFFFFFFF),
        background = androidx.compose.ui.graphics.Color(0xFFF8FAFC),
        onSurface = androidx.compose.ui.graphics.Color(0xFF111827),
        onSurfaceVariant = androidx.compose.ui.graphics.Color(0xFF4B5563),
    )

    MaterialTheme(colorScheme = colorScheme) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            content = content,
        )
    }
}
