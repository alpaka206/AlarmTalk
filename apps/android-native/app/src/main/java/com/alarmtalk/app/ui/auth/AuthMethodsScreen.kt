package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * '시작하기' 다음 화면 — 로그인 수단을 **먼저** 고른다(2026-11-22 오너). 카카오 → 구글 → 이메일로 계속하기.
 *
 * 실제 앱 캡처 10개 중 7개가 이 모양이었다 — 조사와 출처는 `docs/spec/session-and-auth.md` 「로그인 화면」. 예전에는 이 버튼들
 * 아래에 이메일 칸까지 한 화면에 펼쳐 두었다(2026-11-14).
 *
 * - 카카오·구글은 처음이면 곧 가입이라 이 화면에 가입 갈래가 따로 없다. 이메일을 고르면 이메일 로그인(`AuthScreen`)으로 가고,
 *   가입은 거기 아래 '회원가입' 이다.
 * - 세 버튼은 같은 높이([AuthControlHeight])·같은 모서리(12)다. 카카오 가이드대로 다른 버튼을 카카오보다 눈에 띄게 두지
 *   않는다 — 이메일은 옅은 유리 바탕이다.
 * - iOS 짝은 `LoginView.swift` 의 `AuthMethodsView`(구글 자리에 Apple).
 */
@Composable
internal fun AuthMethodsScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    onBack: () -> Unit,
    onKakaoSignIn: () -> Unit,
    onGoogleSignIn: () -> Unit,
    onContinueWithEmail: () -> Unit,
) {
    AuthBackdrop {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding),
        ) {
            AuthTopBar(title = stringResource(R.string.auth_methods_title), onBack = onBack)
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
                    .padding(top = 8.dp, bottom = 18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                KakaoLoginButton(
                    enabled = !busy,
                    onClick = onKakaoSignIn,
                    modifier = Modifier.fillMaxWidth(),
                )
                GoogleSignInButton(
                    enabled = !busy,
                    onClick = onGoogleSignIn,
                    modifier = Modifier.fillMaxWidth(),
                )
                EmailContinueButton(
                    enabled = !busy,
                    onClick = onContinueWithEmail,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/**
 * 고르기 화면 세 버튼의 아이콘과 글자 사이 — 아이콘은 글자 **바로 앞**에 붙고 둘이 한 덩어리로 가운데 선다(2026-11-22 오너
 * "애플만 아이콘이 붙어 있는 게 맞아?"). iOS 의 Apple 버튼은 시스템 버튼이라 그 모양만 있어 카카오·구글·이메일을 거기에
 * 맞췄다. 10 은 구글 가이드의 로고 뒤 여백(Android·Web)이다. iOS 는 Apple 시스템 버튼에 가깝게 8(`AuthSignInIconGap`).
 */
internal val AuthSignInIconGap = 10.dp

/**
 * '이메일로 계속하기' — 카카오·구글 버튼과 같은 골격(아이콘 + 글자를 한 덩어리로 가운데, 높이·모서리 같음)이라 세 버튼이 한
 * 묶음으로 읽힌다. 바탕은 입력 칸과 같은 옅은 유리다. iOS 짝 `AuthMethodsView` 의 `emailButton`.
 */
@Composable
private fun EmailContinueButton(
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val contentAlpha = if (enabled) 1f else 0.38f
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(AuthControlHeight),
        shape = WakerTileShape,
        color = AuthFieldGlass,
        contentColor = TextOnScene,
        border = BorderStroke(1.dp, AuthLine),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.Email,
                contentDescription = null,
                tint = TextOnScene.copy(alpha = contentAlpha),
                modifier = Modifier.size(21.dp),
            )
            Spacer(Modifier.width(AuthSignInIconGap))
            Text(
                text = stringResource(R.string.auth_continue_with_email),
                color = TextOnScene.copy(alpha = contentAlpha),
                // 카카오·구글 버튼과 같은 글꼴·크기·굵기 — 셋이 한 묶음으로 읽힌다.
                fontFamily = FontFamily.Default,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
                lineHeight = 22.sp,
                maxLines = 1,
            )
        }
    }
}
