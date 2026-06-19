package com.alarmtalk.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.tasks.Task
import java.util.concurrent.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

internal fun Context.openWebUrl(url: String) {
    runCatching {
        startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

internal fun buildGoogleSignInOptions(requestIdToken: Boolean = false): GoogleSignInOptions {
    val builder = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestEmail()
    if (requestIdToken) {
        val clientId = BuildConfig.VOICE_ALARM_GOOGLE_WEB_CLIENT_ID
        if (clientId.isNotBlank()) {
            builder.requestIdToken(clientId)
        }
    }
    return builder.build()
}

internal object AppRoute {
    const val Settings = "settings"
    const val MemberManagement = "members"
    const val FamilyTargetModeArg = "familyTargetMode"
    const val AlarmCreate = "alarm/create/{$FamilyTargetModeArg}"
    const val AlarmIdArg = "alarmId"
    const val AlarmEdit = "alarm/edit/{$AlarmIdArg}"

    fun alarmCreate(familyTargetMode: Boolean): String = "alarm/create/$familyTargetMode"
    fun alarmEdit(alarmId: String): String = "alarm/edit/${Uri.encode(alarmId)}"
}

internal val NativeTab.route: String
    get() = when (this) {
        NativeTab.Home -> "home"
        NativeTab.Voices -> "voices"
        NativeTab.Alarms -> "alarms"
        NativeTab.People -> "people"
        NativeTab.Messages -> "messages"
        NativeTab.Growth -> "growth"
        NativeTab.Billing -> "billing"
    }

internal fun String?.toNativeTab(): NativeTab? =
    NativeTab.values().firstOrNull { it.route == this }

internal fun alarmPermissionRequiredMessage(context: Context, target: PermissionTarget): String = when (target) {
    PermissionTarget.Notifications -> context.getString(R.string.r3app_perm_required_notifications)
    PermissionTarget.ExactAlarms -> context.getString(R.string.r3app_perm_required_exact_alarms)
    PermissionTarget.FullScreenIntent -> context.getString(R.string.r3app_perm_required_full_screen)
    PermissionTarget.RecordAudio -> context.getString(R.string.r3app_perm_required_record_audio)
}

internal fun NavHostController.navigateTopLevelTab(tab: NativeTab) {
    navigate(tab.route) {
        popUpTo(NativeTab.Home.route) {
            saveState = true
        }
        launchSingleTop = true
        restoreState = true
    }
}

internal fun NavHostController.navigateHomeClearingStack() {
    if (currentDestination == null) return
    navigate(NativeTab.Home.route) {
        popUpTo(NativeTab.Home.route)
        launchSingleTop = true
    }
}

internal fun NavHostController.popBackStackOrHome() {
    if (!popBackStack()) {
        navigateHomeClearingStack()
    }
}

internal suspend fun signOutGoogleAccount(context: Context) {
    GoogleSignIn
        .getClient(context.applicationContext, buildGoogleSignInOptions())
        .signOut()
        .awaitCompletion()
}

internal suspend fun revokeGoogleAccountAccess(context: Context) {
    GoogleSignIn
        .getClient(context.applicationContext, buildGoogleSignInOptions())
        .revokeAccess()
        .awaitCompletion()
}

internal suspend fun Task<Void>.awaitCompletion() {
    suspendCancellableCoroutine { continuation ->
        addOnCompleteListener { task ->
            if (!continuation.isActive) return@addOnCompleteListener
            when {
                task.isCanceled -> continuation.resumeWithException(
                    CancellationException("Google task was cancelled"),
                )
                task.isSuccessful -> continuation.resume(Unit)
                else -> continuation.resumeWithException(
                    task.exception ?: IllegalStateException("Google task failed"),
                )
            }
        }
    }
}

internal sealed interface AuthRoute {
    data object Landing : AuthRoute
    data class Auth(val mode: AuthMode) : AuthRoute
}

internal enum class MessageSeverity { Success, Error, Info }

internal data class PlanGateDialogState(
    val message: String,
    // null이면 PlanGateDialog의 현지화된 기본 확인 라벨을 사용한다.
    val confirmLabel: String? = null,
)

internal fun messageSeverity(text: String): MessageSeverity = when {
    "실패" in text || "못했어요" in text || "오류" in text -> MessageSeverity.Error
    "했어요" in text || "었어요" in text || "완료" in text -> MessageSeverity.Success
    else -> MessageSeverity.Info
}

@Composable
internal fun PrettySnackbar(message: String) {
    val severity = messageSeverity(message)
    val scheme = MaterialTheme.colorScheme
    val containerColor = when (severity) {
        MessageSeverity.Error -> scheme.error
        MessageSeverity.Success -> scheme.tertiary
        MessageSeverity.Info -> scheme.secondaryContainer
    }
    val contentColor = when (severity) {
        MessageSeverity.Error -> scheme.onError
        MessageSeverity.Success -> scheme.onTertiary
        MessageSeverity.Info -> scheme.onSecondaryContainer
    }
    val iconVector = when (severity) {
        MessageSeverity.Error -> Icons.Outlined.ErrorOutline
        MessageSeverity.Success -> Icons.Outlined.CheckCircle
        MessageSeverity.Info -> Icons.Outlined.Info
    }
    Snackbar(
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .shadow(elevation = 12.dp, shape = RoundedCornerShape(20.dp), clip = false),
        shape = RoundedCornerShape(20.dp),
        containerColor = containerColor,
        contentColor = contentColor,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = iconVector,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = message,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}
