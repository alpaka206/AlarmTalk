package com.alarmtalk.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
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

/** Compose 의 LocalContext(대개 Activity 를 감싼 ContextWrapper)에서 호스트 Activity 를 찾는다. */
internal tailrec fun Context.findHostActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findHostActivity()
    else -> null
}

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
    const val ConsentHistory = "consents"
    const val LegalDocTypeArg = "legalDocType"
    const val LegalDoc = "legal/{$LegalDocTypeArg}"
    const val OssLicenses = "oss-licenses"

    fun legalDoc(type: String): String = "legal/$type"
    const val AlarmCreate = "alarm/create"
    /**
     * 새 알람에서 처음 고를 목소리(목소리 탭의 '이 목소리로 새 알람 만들기', 2026-10-26). 새 알람에만 쓰고 전역 기본값(직전
     * 선택)은 바꾸지 않는다 — 저장에 성공해야 직전 선택이 된다.
     */
    const val AlarmCreateVoiceArg = "voice"
    const val AlarmCreatePattern = "$AlarmCreate?$AlarmCreateVoiceArg={$AlarmCreateVoiceArg}"

    fun alarmCreate(preferredVoiceId: String? = null): String =
        preferredVoiceId?.takeIf { it.isNotBlank() }?.let { "$AlarmCreate?$AlarmCreateVoiceArg=${Uri.encode(it)}" } ?: AlarmCreate
    const val AlarmIdArg = "alarmId"
    const val AlarmEdit = "alarm/edit/{$AlarmIdArg}"

    fun alarmEdit(alarmId: String): String = "alarm/edit/${Uri.encode(alarmId)}"
}

internal val NativeTab.route: String
    get() = when (this) {
        NativeTab.Voices -> "voices"
        NativeTab.Alarms -> "alarms"
        NativeTab.Billing -> "billing"
        NativeTab.Menu -> "menu"
    }

internal fun String?.toNativeTab(): NativeTab? =
    NativeTab.values().firstOrNull { it.route == this }

internal fun NavHostController.navigateTopLevelTab(tab: NativeTab) {
    // ⚠ **이용권은 형제 탭이 아니라 하위 화면이다 — 홈까지 팝하지 말 것.**
    // 하단바가 그리는 탭은 알람·목소리·더보기 셋뿐이고, 이용권은 더보기에서 들어가는
    // 화면이다(화면 안 뒤로가기가 더보기로 돌아간다). 그런데 이용권까지 `popUpTo(알람)`
    // 으로 보내면 백스택이 **[알람, 이용권]** 이 되어 더보기가 통째로 빠진다.
    // 그 상태에서 하드웨어 뒤로가기를 누르면 `NavHost` 자신의 콜백이 스택을 팝해
    // **알람으로** 가버린다 — 화면 안 뒤로가기(더보기)와 **서로 다른 곳으로 간다**
    // (2026-08-11 실기기 확인). 앱 레벨 `BackHandler` 가 더보기로 보내도록 적혀 있지만,
    // `NavHost` 의 콜백이 더 나중에 등록돼 **가려진다** — 그래서 여기 스택 자체를 고친다.
    if (tab == NativeTab.Billing) {
        navigate(tab.route) {
            launchSingleTop = true
            restoreState = true
        }
        return
    }
    navigate(tab.route) {
        popUpTo(NativeTab.Alarms.route) {
            saveState = true
        }
        launchSingleTop = true
        restoreState = true
    }
}

// 알람 탭이 곧 홈이다(홈 탭 병합).
internal fun NavHostController.navigateHomeClearingStack() {
    if (currentDestination == null) return
    navigate(NativeTab.Alarms.route) {
        popUpTo(NativeTab.Alarms.route)
        launchSingleTop = true
    }
}

/**
 * 한 칸 뒤로. 돌아갈 곳이 없으면 홈으로.
 *
 * ⚠ **`popBackStack()` 의 반환값으로 판단하면 안 된다.** 마지막 남은 목적지(=시작 목적지)
 * 까지 팝하고 `true` 를 돌려주기 때문이다. 그러면 백스택이 비면서 세 가지가 한꺼번에 터진다:
 * NavHost 가 아무것도 안 그리고, `currentTab` 이 null 이 되며, 그걸 보는 `showAppChrome` 이
 * 꺼져 하단바·＋FAB 까지 사라진다 — **되돌릴 방법이 없는 검은 화면**이다
 * (`navigateHomeClearingStack` 도 `currentDestination == null` 이라 아무것도 못 한다).
 *
 * 실제로 이걸 밟는 경로는 '두 번 팝' 이다: 저장이 비동기라 그 사이 저장/취소를 한 번 더
 * 누르거나 시스템 뒤로가기를 누르면, 화면은 이미 팝됐는데 저장 완료 콜백이 또 팝한다.
 * 그래서 **바닥에서는 팝하지 않는 것**이 이 함수의 계약이다.
 */
internal fun NavHostController.popBackStackOrHome() {
    if (previousBackStackEntry == null) {
        // 이미 바닥(홈)이다. 여기서 팝하면 백스택이 비므로 팝하지 않는다.
        navigateHomeClearingStack()
        return
    }
    popBackStack()
}

internal suspend fun signOutGoogleAccount(context: Context) {
    GoogleSignIn
        .getClient(context.applicationContext, buildGoogleSignInOptions())
        .signOut()
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
    data object ResetPassword : AuthRoute
    data class Auth(val mode: AuthMode) : AuthRoute
}

/** 스낵바의 색·아이콘. 문구에서 고르는 규칙은 `SnackbarSeverity.kt` 한 곳이다. */
internal enum class MessageSeverity { Success, Error, Info }

/**
 * 스낵바 한 장. 색·아이콘은 문구의 종류(`SnackbarSeverity.kt`)로 고른다.
 *
 * [passTouchesThrough] 가 true 면 카드가 **누르는 것을 받지 않는다** — 그 아래 화면의 행·스위치가 그대로 눌린다(액션을
 * 넣었다면 그 버튼만 제 버튼대로 눌린다). 화면 아래에 몇 초 떠 있는 알람 켜기 안내(`docs/spec/alarm-editor.md` §7)가 쓴다.
 * M3 `Snackbar` 는 누를 수 없는 `Surface` 로 그려지는데 그 `Surface` 도 자기 영역의 터치를 받아서(빈 `pointerInput`),
 * 목록 위에 얹히면 그 띠에 걸친 행의 스위치를 눌러도 아무 일이 없다. 그래서 그때는 같은 모양을 [PassThroughSnackbarCard] 로 그린다.
 */
@Composable
internal fun PrettySnackbar(
    message: String,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
    passTouchesThrough: Boolean = false,
) {
    val context = LocalContext.current
    val severity = remember(message) { snackbarSeverity(context, message) }
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
    val body: @Composable () -> Unit = {
        SnackbarBody(
            message = message,
            iconVector = iconVector,
            contentColor = contentColor,
            actionLabel = actionLabel,
            onAction = onAction,
        )
    }
    if (passTouchesThrough) {
        PassThroughSnackbarCard(containerColor = containerColor, contentColor = contentColor, content = body)
        return
    }
    Snackbar(
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 8.dp)
            // 단일 행 스낵바에 큰 카드(22)는 캡슐처럼 보여 과함 — 표준 패널(18)로.
            .shadow(elevation = 12.dp, shape = WakerPanelShape, clip = false),
        shape = WakerPanelShape,
        containerColor = containerColor,
        contentColor = contentColor,
        content = body,
    )
}

/**
 * [PrettySnackbar] 의 카드를 **터치 판정에 걸리지 않게** 그린다 — M3 `Snackbar` 와 같은 바깥 여백·최대 폭·그림자·한 줄
 * 높이·글자이되 `Surface` 없이 그림만 그린다. 입력 수정자가 하나도 없는 노드는 터치 판정이 건너뛰므로 누른 것이 아래 화면에
 * 닿는다. 스크린 리더 안내(live region)는 감싸는 `SnackbarHost` 가 맡으므로 그대로다.
 *
 * ⚠ 여기에 `Surface`·`Snackbar`·`clickable`·`pointerInput` 을 넣지 말 것 — 그 순간 다시 아래 행을 가린다
 * (`PassThroughSnackbarTouchTest` 가 실제로 눌러 본다).
 */
@Composable
private fun PassThroughSnackbarCard(
    containerColor: Color,
    contentColor: Color,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 8.dp)
            // M3 스낵바의 최대 폭(본문 600 + 좌우 안쪽 여백 24) — 넓은 화면에서도 위쪽 안내와 같은 폭이다.
            .widthIn(max = 624.dp)
            .fillMaxWidth()
            .shadow(elevation = 12.dp, shape = WakerPanelShape, clip = false)
            // M3 스낵바가 스스로 거는 그림자(Level3) — M3 쪽 카드는 위의 12 와 이것을 겹쳐 그린다.
            .shadow(elevation = 6.dp, shape = WakerPanelShape, clip = false)
            .background(containerColor, WakerPanelShape)
            // M3 한 줄 스낵바의 높이(48)와 글자 자리 — 한 줄이면 위쪽 안내와 같은 곳에 글자가 앉는다.
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        CompositionLocalProvider(
            LocalContentColor provides contentColor,
            // M3 스낵바의 본문 글자(bodyMedium)와 같다.
            LocalTextStyle provides MaterialTheme.typography.bodyMedium,
            content = content,
        )
    }
}

/** 스낵바 안쪽 — 아이콘·문구·(있으면) 액션. 두 카드가 같이 쓴다. */
@Composable
private fun SnackbarBody(
    message: String,
    iconVector: ImageVector,
    contentColor: Color,
    actionLabel: String?,
    onAction: () -> Unit,
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
            // 액션이 있으면 남은 폭을 메시지가 차지해 버튼이 끝에 붙는다.
            modifier = if (actionLabel != null) Modifier.weight(1f) else Modifier,
        )
        if (actionLabel != null) {
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = onAction) {
                Text(
                    text = actionLabel,
                    color = contentColor,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}
