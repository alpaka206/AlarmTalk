package com.voicealarm.nativeapp

import android.Manifest
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
import androidx.core.content.ContextCompat

enum class PermissionTarget { Alarm, RecordAudio }

internal fun Context.hasAlarmPermissions(): Boolean {
    val notifGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    } else {
        true
    }
    return notifGranted && canScheduleExactAlarms() && canUseFullScreenIntent()
}

internal fun Context.hasRecordAudioPermission(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED

internal fun Context.openPermissionSettingsFor(target: PermissionTarget) {
    when (target) {
        PermissionTarget.Alarm -> {
            // 가장 사용자 행동이 필요한 항목부터 우선 안내. 그 외는 시스템 설정에서 함께 풀 수 있도록 앱 상세로.
            when {
                !canScheduleExactAlarms() -> openExactAlarmSettings()
                !canUseFullScreenIntent() -> openFullScreenIntentSettings()
                else -> openAppDetailsSettings()
            }
        }
        PermissionTarget.RecordAudio -> openAppDetailsSettings()
    }
}

private fun Context.openAppDetailsSettings() {
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
    val title: String
    val body: String
    when (target) {
        PermissionTarget.Alarm -> {
            title = "알람 권한이 필요해요"
            body = "정해진 시간에 알람이 울리려면 ‘알림’, ‘알람 및 리마인더’, ‘전체 화면 알림’ 권한이 모두 필요해요. 설정에서 허용해 주세요."
        }
        PermissionTarget.RecordAudio -> {
            title = "마이크 권한이 필요해요"
            body = "내 목소리로 음성을 녹음하려면 마이크 권한이 필요해요. 설정에서 허용해 주세요."
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = {
            TextButton(onClick = onOpenSettings) { Text("설정으로 이동") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("닫기") }
        },
    )
}
