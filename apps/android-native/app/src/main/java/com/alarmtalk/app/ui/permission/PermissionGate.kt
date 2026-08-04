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

    /**
     * **아예 못 울리는가.** 세 권한이 같은 무게가 아니다 —
     *  - 알림(POST_NOTIFICATIONS) 없음: 울림 화면을 띄울 통로가 없다 → 알람이 안 울린다.
     *  - 정확 알람 없음: `AlarmScheduler.schedule()` 이 `setAndAllowWhileIdle` 로 폴백해
     *    **울리기는 한다**(수 분 늦을 수 있음).
     *  - 전체화면 인텐트 없음: 소리·알림은 나지만 잠금화면을 덮지 못한다.
     *
     * 그래서 "울리지 않아요" 는 알림 권한이 없을 때만 참이다. 나머지를 같이 묶어
     * 안 울린다고 말하면 사용자는 멀쩡히 울릴 알람을 꺼진 것으로 오해한다(Codex #671 P2).
     */
    val ringingBlocked: Boolean
        get() = !notifications

    /** 울리기는 하지만 제 성능이 안 나오는 상태(늦거나, 잠금화면을 못 덮거나). */
    val ringingDegraded: Boolean
        get() = notifications && (!exactAlarms || !fullScreenIntent)

    val allStartupGranted: Boolean
        get() = alarmReady && recordAudio

    fun firstMissingAlarmTarget(): PermissionTarget? = when {
        !notifications -> PermissionTarget.Notifications
        !exactAlarms -> PermissionTarget.ExactAlarms
        !fullScreenIntent -> PermissionTarget.FullScreenIntent
        else -> null
    }

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
    val title = when (target) {
        PermissionTarget.Notifications -> stringResource(R.string.common_permission_gate_notifications_title)
        PermissionTarget.ExactAlarms -> stringResource(R.string.common_permission_gate_exact_alarm_title)
        PermissionTarget.FullScreenIntent -> stringResource(R.string.common_permission_gate_full_screen_title)
        PermissionTarget.RecordAudio -> stringResource(R.string.common_permission_gate_mic_title)
    }
    // 로그아웃·계정삭제 등 확인형 모달과 동일한 iOS 알럿 스타일(IosAlertDialog)로 통일한다.
    // 설명(message)은 없애고 제목=결론만 노출. 취소 / 허용하기(강조) 2버튼.
    IosAlertDialog(
        title = title,
        message = null,
        onDismiss = onDismiss,
        // 알람 권한 셋(알림·정확한 알람·잠금 화면)은 **전부 필수**다 — 하나라도 빠지면
        // 알람이 안 울리거나 늦거나 잠금 화면을 못 덮는다. 그래서 '그대로 진행' 같은
        // 우회 액션은 두지 않는다. 다만 막는 건 **알람 기능뿐**이고 앱 전체가 아니다
        // (목소리 등록·이용권 등록·설정은 권한과 무관하게 쓸 수 있어야 한다).
        //
        // 취소 액션은 두지 않는다. 대신 **바깥 탭·뒤로가기로는 닫힌다**(실기기 확인).
        // 즉 이건 못 빠져나가는 차단 게이트가 아니라 '허용해 달라' 는 요청이고, 안드로이드의
        // 표준 탈출구(뒤로가기)를 그대로 남겨 둔 것이다. 화면 안에 취소를 또 그리면 버튼 두
        // 개가 같은 일을 하게 되고, 정작 눌러야 할 '허용하기' 와 무게가 같아진다.
        // (닫으면 호출부가 대기 중이던 알람 추가도 함께 비운다 — AlarmTalkApp 의 onDismiss.)
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.common_permission_gate_allow_action),
                emphasized = true,
                onClick = onOpenSettings,
            ),
        ),
    )
}
