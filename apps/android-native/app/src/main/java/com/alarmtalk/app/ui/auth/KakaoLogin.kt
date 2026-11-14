package com.alarmtalk.app

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakao.sdk.auth.model.OAuthToken
import com.kakao.sdk.common.model.ClientError
import com.kakao.sdk.common.model.ClientErrorCause
import com.kakao.sdk.user.UserApiClient
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

// 카카오 로그인(2026-11-14). 서버 규칙은 `docs/spec/session-and-auth.md` 「카카오 로그인」 — 앱은 카카오 SDK 가 준
// 액세스 토큰을 `POST /auth/kakao` 에 넘길 뿐이고, 계정을 찾고 붙이는 판정은 전부 서버가 한다.

// 카카오 디자인 가이드의 버튼 색(브랜드 비주얼 예외 — 구글 버튼과 같은 자리). 바탕은 카카오 노랑(#FEE500), 심볼은 검정
// (#000000), 글자는 검정 85%. ⚠ 공식 리소스 이미지(Kakao Login.zip)는 둘 다 #191919 로 칠해 두었지만, 직접 만드는 버튼의
// 기준은 가이드 문서다(2026-11-14 확인).
private val KakaoContainer = Color(0xFFFEE500)
private val KakaoSymbol = Color(0xFF000000)
private val KakaoLabel = Color(0xD9000000)

/**
 * 카카오 로그인 버튼. 가이드대로 노랑 바탕 + 공식 말풍선 심볼(`ic_kakao_symbol`) + 글자 '카카오 로그인' 하나, 모서리 12(`WakerTileShape`).
 * ⚠ 글자를 바꾸지 말 것 — 가이드가 허용하는 글자는 '카카오 로그인'(축약 '로그인')뿐이다. 가입 화면에서도 같다.
 * ⚠ 다른 로그인 버튼을 이보다 눈에 띄게 두지 않는다(가이드) — 그래서 구글 버튼과 같은 높이·같은 자리다.
 */
@Composable
internal fun KakaoLoginButton(
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val contentAlpha = if (enabled) 1f else 0.38f
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(56.dp),
        shape = WakerTileShape,
        color = KakaoContainer,
        contentColor = KakaoLabel,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_kakao_symbol),
                contentDescription = null,
                tint = KakaoSymbol.copy(alpha = contentAlpha),
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .size(21.dp),
            )
            Text(
                text = stringResource(R.string.auth_kakao_login),
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(horizontal = 32.dp),
                color = KakaoLabel.copy(alpha = KakaoLabel.alpha * contentAlpha),
                // 가이드: 글꼴은 OS 기본. 구글 버튼과 같은 크기·굵기라 두 버튼이 한 묶음으로 읽힌다.
                fontFamily = FontFamily.Default,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
                lineHeight = 22.sp,
                maxLines = 1,
            )
        }
    }
}

/** 카카오 로그인 한 번의 결과. **취소는 실패가 아니다** — 화면에 아무 말도 하지 않는다. */
internal sealed interface KakaoLoginResult {
    data class Success(val accessToken: String) : KakaoLoginResult
    data object Cancelled : KakaoLoginResult
    data class Failed(val error: Throwable) : KakaoLoginResult
}

/**
 * 카카오톡 앱으로 로그인하고, 카카오톡이 없거나 거기서 실패하면(연결된 카카오계정이 없음 등) 카카오계정(웹)으로
 * 넘어간다 — 카카오 가이드의 순서다. ⚠ **카카오톡에서 사용자가 취소했으면 계정 로그인을 다시 띄우지 않는다**(가이드:
 * 의도적인 취소). [context] 는 화면을 띄울 수 있는 액티비티 컨텍스트여야 한다.
 */
internal suspend fun loginWithKakao(context: Context): KakaoLoginResult {
    val client = UserApiClient.instance
    if (client.isKakaoTalkLoginAvailable(context)) {
        val talk = awaitKakaoLogin { callback -> client.loginWithKakaoTalk(context, callback = callback) }
        if (talk !is KakaoLoginResult.Failed) return talk
    }
    return awaitKakaoLogin { callback -> client.loginWithKakaoAccount(context, callback = callback) }
}

/**
 * 우리 로그아웃·탈퇴 신청 때 이 기기의 카카오 토큰도 버린다. 카카오 서버 호출이 실패해도 SDK 는 기기의 토큰을
 * 지운다 — 우리 쪽 로그아웃을 막지 않도록 결과를 보지 않는다.
 */
internal suspend fun signOutKakao() {
    suspendCancellableCoroutine { cont ->
        UserApiClient.instance.logout { if (cont.isActive) cont.resume(Unit) }
    }
}

private suspend fun awaitKakaoLogin(
    start: (callback: (OAuthToken?, Throwable?) -> Unit) -> Unit,
): KakaoLoginResult = suspendCancellableCoroutine { cont ->
    start { token, error ->
        if (!cont.isActive) return@start
        val accessToken = token?.accessToken
        cont.resume(
            when {
                error != null && error.isKakaoCancel() -> KakaoLoginResult.Cancelled
                error != null -> KakaoLoginResult.Failed(error)
                !accessToken.isNullOrBlank() -> KakaoLoginResult.Success(accessToken)
                else -> KakaoLoginResult.Failed(IllegalStateException("Kakao login returned no access token"))
            },
        )
    }
}

private fun Throwable.isKakaoCancel(): Boolean = this is ClientError && reason == ClientErrorCause.Cancelled
