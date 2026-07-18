package com.alarmtalk.app

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.alarmtalk.app.R
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

enum class PermissionTarget {
    Notifications,
    ExactAlarms,
    FullScreenIntent,
    RecordAudio,
}

internal data class PermissionSnapshot(
    val exactAlarms: Boolean,
    val notifications: Boolean,
    val fullScreenIntent: Boolean,
    val recordAudio: Boolean,
) {
    val alarmReady: Boolean
        get() = exactAlarms && notifications && fullScreenIntent

    val allStartupGranted: Boolean
        get() = alarmReady && recordAudio

    fun firstMissingAlarmTarget(): PermissionTarget? = when {
        !notifications -> PermissionTarget.Notifications
        !exactAlarms -> PermissionTarget.ExactAlarms
        !fullScreenIntent -> PermissionTarget.FullScreenIntent
        else -> null
    }

    fun firstMissingStartupTarget(): PermissionTarget? =
        firstMissingAlarmTarget() ?: if (!recordAudio) PermissionTarget.RecordAudio else null

    companion object {
        fun read(context: Context): PermissionSnapshot {
            val alarmManager = requireNotNull(context.getSystemService<AlarmManager>())
            val notificationManager = NotificationManagerCompat.from(context)
            val platformNotificationManager = requireNotNull(context.getSystemService<NotificationManager>())

            val exactAlarms = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                alarmManager.canScheduleExactAlarms()
            val notificationRuntimeGranted =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
            val notifications = notificationRuntimeGranted && notificationManager.areNotificationsEnabled()
            val fullScreenIntent = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
                platformNotificationManager.canUseFullScreenIntent()
            val recordAudio =
                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                    PackageManager.PERMISSION_GRANTED

            return PermissionSnapshot(
                exactAlarms = exactAlarms,
                notifications = notifications,
                fullScreenIntent = fullScreenIntent,
                recordAudio = recordAudio,
            )
        }
    }
}

@Stable
internal class PermissionStatusState internal constructor(
    private val context: Context,
) {
    var snapshot by mutableStateOf(PermissionSnapshot.read(context))
        private set
    var refreshTick by mutableStateOf(0)
        private set

    fun refresh() {
        snapshot = PermissionSnapshot.read(context)
        refreshTick += 1
    }
}

@Composable
internal fun rememberPermissionStatusState(): PermissionStatusState {
    val appContext = LocalContext.current.applicationContext
    val lifecycleOwner = LocalLifecycleOwner.current
    val state = remember(appContext) { PermissionStatusState(appContext) }

    DisposableEffect(lifecycleOwner, state) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START || event == Lifecycle.Event.ON_RESUME) {
                state.refresh()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        state.refresh()
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    return state
}

internal fun Context.shouldRequestNotificationRuntimePermission(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED

internal fun Context.openNotificationSettings() {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
        putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
    }
    startSettingsActivity(intent)
}

internal fun Context.openAppDetailsSettings() {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:$packageName")
    }
    startSettingsActivity(intent)
}

@Composable
internal fun PermissionGateDialog(
    target: PermissionTarget,
    onDismiss: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val action = stringResource(R.string.common_permission_gate_allow_action)
    val (title, body) = when (target) {
        PermissionTarget.Notifications -> Pair(
            stringResource(R.string.common_permission_gate_notifications_title),
            stringResource(R.string.common_permission_gate_notifications_body),
        )
        PermissionTarget.ExactAlarms -> Pair(
            stringResource(R.string.common_permission_gate_exact_alarm_title),
            stringResource(R.string.common_permission_gate_exact_alarm_body),
        )
        PermissionTarget.FullScreenIntent -> Pair(
            stringResource(R.string.common_permission_gate_full_screen_title),
            stringResource(R.string.common_permission_gate_full_screen_body),
        )
        PermissionTarget.RecordAudio -> Pair(
            stringResource(R.string.common_permission_gate_mic_title),
            stringResource(R.string.common_permission_gate_mic_body),
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { ModalDialogTitle(title, onDismiss = onDismiss) },
        text = { Text(body) },
        confirmButton = {
            TextButton(onClick = onOpenSettings) { Text(action) }
        },
    )
}
