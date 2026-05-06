package com.voicealarm.nativeapp

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.voicealarm.nativeapp.network.AuthSession

private enum class SpecialPermissionStep { None, ExactAlarm, FullScreenIntent }

/**
 * 로그인 직후 한 번 권한을 모아서 요청한다.
 *  1) 런타임 권한 (POST_NOTIFICATIONS, RECORD_AUDIO) → 시스템 다이얼로그
 *  2) SCHEDULE_EXACT_ALARM (Android 12+)            → 설정 화면 안내 다이얼로그
 *  3) USE_FULL_SCREEN_INTENT (Android 14+)         → 설정 화면 안내 다이얼로그
 *
 * 이미 허용된 권한은 건너뛴다. 사용자가 "나중에" 를 누르면 그 세션에선 더 묻지 않는다.
 */
@Composable
internal fun LoginPermissionGate(authSession: AuthSession?) {
    val context = LocalContext.current
    var lastHandledToken by remember { mutableStateOf<String?>(null) }
    var step by remember { mutableStateOf(SpecialPermissionStep.None) }

    val runtimePermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        // 런타임 권한 결과와 무관하게 다음 단계로 진행한다. 거부했어도 알람 자체는 동작.
        step = nextSpecialStep(context, SpecialPermissionStep.None)
    }

    LaunchedEffect(authSession?.token) {
        val token = authSession?.token
        if (token == null) {
            lastHandledToken = null
            step = SpecialPermissionStep.None
            return@LaunchedEffect
        }
        if (token == lastHandledToken) return@LaunchedEffect
        lastHandledToken = token

        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        if (
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed += Manifest.permission.RECORD_AUDIO
        }

        if (needed.isNotEmpty()) {
            runtimePermissionLauncher.launch(needed.toTypedArray())
        } else {
            step = nextSpecialStep(context, SpecialPermissionStep.None)
        }
    }

    when (step) {
        SpecialPermissionStep.ExactAlarm -> AlertDialog(
            onDismissRequest = { step = SpecialPermissionStep.None },
            title = { Text("정확한 알람 권한 필요") },
            text = {
                Text(
                    "알람이 정해진 시간에 정확하게 울리려면 권한이 필요해요. " +
                        "‘설정으로 이동’ 을 눌러 ‘알람 및 리마인더’ 를 허용해 주세요.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    context.openExactAlarmSettings()
                    step = nextSpecialStep(context, SpecialPermissionStep.ExactAlarm)
                }) { Text("설정으로 이동") }
            },
            dismissButton = {
                TextButton(onClick = {
                    step = nextSpecialStep(context, SpecialPermissionStep.ExactAlarm)
                }) { Text("나중에") }
            },
        )

        SpecialPermissionStep.FullScreenIntent -> AlertDialog(
            onDismissRequest = { step = SpecialPermissionStep.None },
            title = { Text("전체 화면 알림 권한") },
            text = {
                Text(
                    "화면이 잠겨 있어도 알람 화면이 잘 뜨도록 권한이 필요해요. " +
                        "‘설정으로 이동’ 을 눌러 허용해 주세요.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    context.openFullScreenIntentSettings()
                    step = SpecialPermissionStep.None
                }) { Text("설정으로 이동") }
            },
            dismissButton = {
                TextButton(onClick = { step = SpecialPermissionStep.None }) { Text("나중에") }
            },
        )

        SpecialPermissionStep.None -> Unit
    }
}

private fun nextSpecialStep(
    context: android.content.Context,
    after: SpecialPermissionStep,
): SpecialPermissionStep {
    if (after == SpecialPermissionStep.None && !context.canScheduleExactAlarms()) {
        return SpecialPermissionStep.ExactAlarm
    }
    if (after <= SpecialPermissionStep.ExactAlarm && !context.canUseFullScreenIntent()) {
        return SpecialPermissionStep.FullScreenIntent
    }
    return SpecialPermissionStep.None
}
