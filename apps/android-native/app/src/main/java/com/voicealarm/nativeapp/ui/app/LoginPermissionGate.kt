package com.voicealarm.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.voicealarm.nativeapp.network.AuthSession

/**
 * 로그인 후 첫 진입에서 알람 앱에 필요한 권한을 한 번에 안내한다.
 *
 * Android의 exact alarm / full-screen intent 권한 화면은 Activity result가 없기 때문에
 * 권한 획득 여부는 lifecycle resume 때 다시 읽은 PermissionSnapshot만 신뢰한다.
 */
@Composable
internal fun LoginPermissionGate(
    authSession: AuthSession?,
    enabled: Boolean,
    permissions: PermissionSnapshot,
    onRequestPermission: (PermissionTarget) -> Unit,
    onRequestAllPermissions: () -> Unit,
) {
    var lastHandledToken by remember { mutableStateOf<String?>(null) }
    var visible by remember { mutableStateOf(false) }

    LaunchedEffect(authSession?.token, enabled) {
        val token = authSession?.token
        if (token == null) {
            lastHandledToken = null
            visible = false
            return@LaunchedEffect
        }
        if (!enabled) return@LaunchedEffect
        if (token != lastHandledToken) {
            lastHandledToken = token
            visible = !permissions.allStartupGranted
        }
    }

    LaunchedEffect(permissions.allStartupGranted) {
        if (permissions.allStartupGranted) {
            visible = false
        }
    }

    if (!enabled || !visible || permissions.firstMissingStartupTarget() == null) return

    Dialog(
        onDismissRequest = { visible = false },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .widthIn(max = 520.dp),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "알람 권한을 허용해 주세요",
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Text(
                        text = "정확한 시간에 알람을 울리고 잠금 화면에서 바로 열려면 아래 권한이 필요해요.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                PermissionPanel(
                    permissions = permissions,
                    onRequestPermission = onRequestPermission,
                    onRequestAllPermissions = onRequestAllPermissions,
                )
                TextButton(
                    onClick = { visible = false },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("나중에")
                }
            }
        }
    }
}
