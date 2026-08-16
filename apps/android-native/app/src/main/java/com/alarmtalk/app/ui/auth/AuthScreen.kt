package com.alarmtalk.app

import android.util.Patterns
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

internal enum class AuthMode { Login, Register }

// 인증 플로우(로그인/가입/비밀번호 찾기/약관 동의) 공통 스타일 — 랜딩의 밤바다 톤을
// 이어받은 고정 다크 배경이라 폼 색은 테마 대신 고정(랜딩 브랜드 비주얼 예외).
private val AuthFieldGlass = Color(0x14FFFFFF)
internal val AuthLine = Color(0x3DFFFFFF)
internal val AuthLineSoft = Color(0x29FFFFFF)
internal val AuthTextMuted = Color(0x99FFFFFF)

// 이 화면은 고정 다크 비주얼(문서화된 예외)이라 테마 error/primary 대신 밝은 고정색을 쓴다 —
// 라이트 테마 기기에서도 남색 배경 위에서 안내가 보이도록.
internal val AuthErrorText = Color(0xFFFFB4AB)
internal val AuthNoticeText = Color(0xFFA8C8FF)
// 원형 뒤로가기 버튼 — iOS 로그인 화면과 같은 모양(옅은 채움 + 얇은 테두리).
private val AuthSceneTop = Color(0xFF1A2A52)
private val AuthSceneBottom = Color(0xFF070C1D)

/** 인증 플로우 공통 배경 — 은은한 네이비 그라데이션 + 상단 브랜드 글로우. */
@Composable
internal fun AuthBackdrop(content: @Composable BoxScope.() -> Unit) {
    SceneSystemBars(top = AuthSceneTop, bottom = AuthSceneBottom)
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    0f to AuthSceneTop,
                    0.55f to Color(0xFF0E1938),
                    1f to AuthSceneBottom,
                ),
            ),
    ) {
        // 상단에 브랜드 빛이 아주 옅게 스며드는 글로우 — 밋밋함만 걷어낸다.
        Box(
            Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .fillMaxHeight(0.5f)
                .background(
                    Brush.radialGradient(
                        0f to BrandAccentOnScene.copy(alpha = 0.13f),
                        1f to Color.Transparent,
                    ),
                ),
        )
        content()
    }
}

@Composable
internal fun authFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = TextOnScene,
    unfocusedTextColor = TextOnScene,
    disabledTextColor = TextOnScene.copy(alpha = 0.5f),
    focusedContainerColor = AuthFieldGlass,
    unfocusedContainerColor = AuthFieldGlass,
    disabledContainerColor = Color(0x0AFFFFFF),
    cursorColor = BrandAccentOnScene,
    focusedBorderColor = BrandAccentOnScene.copy(alpha = 0.85f),
    unfocusedBorderColor = AuthLine,
    disabledBorderColor = AuthLineSoft,
    focusedLabelColor = BrandAccentOnScene,
    unfocusedLabelColor = AuthTextMuted,
    disabledLabelColor = Color(0x66FFFFFF),
    focusedTrailingIconColor = TextOnSceneDim,
    unfocusedTrailingIconColor = AuthTextMuted,
    errorTextColor = TextOnScene,
    errorContainerColor = AuthFieldGlass,
    errorCursorColor = AuthErrorText,
    errorBorderColor = AuthErrorText,
    errorLabelColor = AuthErrorText,
    errorSupportingTextColor = AuthErrorText,
    errorTrailingIconColor = TextOnSceneDim,
)

/**
 * 입력칸 **위**에 붙는 라벨 — iOS `VocaTextField` 와 같은 구성이다.
 *
 * ⚠ `OutlinedTextField(label = …)` 로 안에 넣지 말 것. Material 의 플로팅 라벨은
 * 비어 있을 때 칸 **안**에 앉고 테두리에 홈을 파서, 같은 색·같은 반경을 써도 iOS 의
 * '빈 유리판 + 위 라벨' 과 다른 물건으로 보인다(2026-08-10 두 앱 대조).
 *
 * 칸 높이는 iOS(약 44pt)보다 큰 Material 기본 56dp 를 **그대로 둔다** — 안드로이드
 * 최소 터치 타깃이 48dp 라 iOS 치수를 그대로 가져오면 오히려 규격을 깬다.
 */
/** 스크롤 밖에 고정되는 원형 뒤로가기 줄. iOS `AuthCircleBackButton` 과 같은 스펙. */
@Composable
private fun BackCircleRow(onBack: () -> Unit) {
    // ⚠ **뒤로가기와 제목을 한 줄에 두지 않는다** — iOS 와 같은 구성이다.
    // 뒤로가기는 원형 버튼으로 위에 따로 두고, 제목은 그 아래 본문 첫 줄로 크게 세운다
    // (디자인 언어: 제목 = 결론). 2026-08-10 결정: 이 화면만은 **iOS 를 원본으로 삼는다**.
    // 모양은 공용 `WakerBackButton` 이 갖는다 — 이 화면에만 있던 것을 빼서 하위 화면들과
    // 함께 쓴다(2026-08-11). 여기는 고정 팔레트 화면이라 틴트만 `TextOnScene` 으로 준다.
    WakerBackButton(
        onBack = onBack,
        modifier = Modifier.padding(start = 24.dp, top = 18.dp),
        tint = TextOnScene,
    )
}

@Composable
internal fun AuthFieldLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        // ⚠ 여백을 여기서 주지 말 것 — 감싸는 Column 의 `spacedBy(6.dp)` 가 담당한다.
        // 패딩과 형제 간격이 더해지면 라벨이 자기 칸에서 멀어져 어느 칸의 라벨인지 흐려진다.
        color = AuthTextMuted,
    )
}

@Composable
internal fun authOutlinedButtonColors() = ButtonDefaults.outlinedButtonColors(
    contentColor = TextOnScene,
    // ⚠ 35%(0x59)는 대비 3.15:1 로 읽기 어려웠다 — 55%(0x8C)로 올린다(2026-08-17).
    // iOS `AuthOutlinedButton` 도 같은 값이다.
    disabledContentColor = Color(0x8CFFFFFF),
)

internal fun authOutlinedButtonBorder(enabled: Boolean) =
    BorderStroke(1.dp, if (enabled) AuthLine else AuthLineSoft)

@Composable
internal fun authTextButtonColors() = ButtonDefaults.textButtonColors(
    contentColor = BrandAccentOnScene,
    // ⚠ 35%(0x59)는 대비 3.15:1 로 읽기 어려웠다 — 55%(0x8C)로 올린다(2026-08-17).
    // iOS `AuthOutlinedButton` 도 같은 값이다.
    disabledContentColor = Color(0x8CFFFFFF),
)

@Composable
internal fun AuthScreen(
    contentPadding: PaddingValues,
    mode: AuthMode,
    busy: Boolean,
    emailVerificationSentTo: String?,
    emailVerified: String?,
    // 로그인/회원가입 실패 인라인 안내 — 전역 스낵바는 열려 있는 키보드에 가려 안 보여서 화면 안에 띄운다.
    loginError: String? = null,
    registerError: String? = null,
    // 회원가입 → 로그인 자동 전환(이미 가입된 이메일) 때 로그인 화면에 남는 이유 안내.
    authNotice: String? = null,
    onClearLoginError: () -> Unit = {},
    onBack: () -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String, String) -> Unit,
    onRequestEmailVerification: (String) -> Unit,
    onConfirmEmailVerification: (String, String) -> Unit,
    onSwitchMode: () -> Unit,
    onGoogleSignIn: () -> Unit,
    onFindPassword: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var emailCode by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var confirmPasswordVisible by remember { mutableStateOf(false) }
    val normalizedEmail = email.trim().lowercase()
    val emailLooksValid = Patterns.EMAIL_ADDRESS.matcher(normalizedEmail).matches()
    val passwordAtLeastMin = password.length >= 8
    val passwordUnderMax = password.length <= 128
    val passwordHasLetter = password.any { it.isLetter() }
    val passwordHasDigit = password.any { it.isDigit() }
    val passwordHasLetterAndDigit = passwordHasLetter && passwordHasDigit
    // 서버 정책(@alarmtalk/shared PasswordSchema)과 일치: 8~128자 + 영문·숫자 각 1자 이상.
    val passwordPolicyValid =
        passwordAtLeastMin && passwordUnderMax && passwordHasLetterAndDigit
    val passwordMatches = password.isNotBlank() && password == confirmPassword
    val isEmailVerified = mode == AuthMode.Login || emailVerified == normalizedEmail
    val codeSentForEmail = emailVerificationSentTo == normalizedEmail
    // 로그인 실패 시 비밀번호만 비운다 — 오타 대부분이 비밀번호 쪽이고, 이메일까지 비우면
    // 맞게 입력한 이메일을 다시 치는 마찰만 생긴다(문구가 이메일 확인도 함께 안내).
    LaunchedEffect(loginError) {
        if (loginError != null) password = ""
    }

    // 상한을 넘겨 치려 했는지. 값 자체는 30자에서 잘리므로 값만으로는 알 수 없다.
    var nameTooLong by remember { mutableStateOf(false) }
    val canSubmit = if (mode == AuthMode.Login) {
        email.isNotBlank() && password.isNotBlank()
    } else {
        name.isNotBlank() &&
            emailLooksValid &&
            isEmailVerified &&
            passwordPolicyValid &&
            passwordMatches
    }

    AuthBackdrop {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding),
        ) {
        // ⚠ **뒤로가기는 스크롤 밖에 둔다.** 안에 두면 폼을 내리거나 키보드가 올라와
        // 내용이 밀릴 때 같이 사라져, 나갈 길이 화면에서 없어진다. 스크롤되는 건 폼이고
        // 탈출구는 늘 같은 자리에 있어야 한다(iOS `LoginView` 도 같은 구조).
        BackCircleRow(onBack = onBack)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                // ⚠ 뒤로가기와 제목 사이 간격. 스크롤 밖으로 버튼을 빼면서 이 여백이
                // 통째로 사라져 제목이 버튼에 붙어 있었다. iOS 와 같은 24
                // (`LoginView` 의 ScrollView `.padding(.vertical, 18)` + 제목 `.padding(.top, 6)`).
                .padding(top = 24.dp, bottom = 18.dp),
            // iOS `LoginView` 의 `VStack(spacing: 14)` 와 같은 값.
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = if (mode == AuthMode.Login) stringResource(R.string.auth_title_login) else stringResource(R.string.auth_title_register),
                // iOS 와 같은 단계 — `theme.typography.headlineSmall`(24pt).
                // headlineLarge(32) 로 키우면 iOS 보다 한 단계 커져 두 앱이 어긋난다.
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = TextOnScene,
            )
            Text(
                text = if (mode == AuthMode.Login) {
                    stringResource(R.string.auth_subtitle_login)
                } else {
                    stringResource(R.string.auth_subtitle_register)
                },
                style = MaterialTheme.typography.bodyMedium,
                color = TextOnSceneDim,
            )

            // 회원가입에서 이미 가입된 이메일로 인증을 시도해 로그인으로 전환된 경우 —
            // 왜 화면이 바뀌었는지 여기서 설명한다(스낵바는 키보드에 가려 안 보인다).
            if (mode == AuthMode.Login && authNotice != null) {
                Text(
                    text = authNotice,
                    style = MaterialTheme.typography.bodyMedium,
                    color = AuthNoticeText,
                )
            }

            if (mode == AuthMode.Register) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    AuthFieldLabel(stringResource(R.string.auth_label_name))
                    OutlinedTextField(
                        value = name,
                        // 서버(`DisplayNameSchema`)와 같은 규칙을 앱에서 먼저 태운다 — 제로폭·
                        // 양방향 문자가 남으면 isNotBlank() 는 통과하는데 서버에서 정리하면 빈 값이
                        // 되어 **이메일 인증까지 마친 뒤에야** 400 이 난다.
                        //
                        // 30자에서 막되, **말없이 막지 않는다.** 넘겨 치면 그 순간 아래에
                        // 이유가 뜨고(글자는 들어가지 않는다), 지워서 여유가 생기면 사라진다.
                        // 항상 켜진 카운터(7/30)는 넘기 전까진 알려 줄 게 없어 두지 않는다.
                        onValueChange = { raw ->
                            val cleaned = sanitizeDisplayName(raw)
                            // 30자 **정확히** 일 때는 플래그를 건드리지 않는다 — 잘라서 돌려준
                            // 값을 IME 가 되돌려 보내면 방금 켠 경고가 곧바로 꺼진다.
                            if (cleaned.length > DisplayNameMaxLength) {
                                nameTooLong = true
                            } else if (cleaned.length < DisplayNameMaxLength) {
                                nameTooLong = false
                            }
                            name = cleaned.takeWithoutSplittingPairs(DisplayNameMaxLength)
                        },
                        isError = nameTooLong,
                        supportingText = if (nameTooLong) {
                            { Text(stringResource(R.string.auth_error_name_too_long, DisplayNameMaxLength)) }
                        } else {
                            null
                        },
                        singleLine = true,
                        enabled = !busy,
                        shape = WakerInputShape,
                        colors = authFieldColors(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Text,
                            imeAction = ImeAction.Next,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                AuthFieldLabel(stringResource(R.string.auth_label_email))
                OutlinedTextField(
                    value = email,
                    onValueChange = {
                        email = it
                        onClearLoginError()
                    },
                    singleLine = true,
                    enabled = !busy,
                    shape = WakerInputShape,
                    colors = authFieldColors(),
                    isError = mode == AuthMode.Login && loginError != null,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (mode == AuthMode.Register) {
                val verifyEnabled = !busy && emailLooksValid && !isEmailVerified
                OutlinedButton(
                    onClick = { onRequestEmailVerification(email) },
                    enabled = verifyEnabled,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 54.dp),
                    shape = WakerButtonShape,
                    border = authOutlinedButtonBorder(verifyEnabled),
                    colors = authOutlinedButtonColors(),
                ) {
                    Text(
                        when {
                            isEmailVerified -> stringResource(R.string.auth_email_verify_done)
                            codeSentForEmail -> stringResource(R.string.auth_email_verify_resend)
                            else -> stringResource(R.string.auth_email_verify)
                        },
                    )
                }

                if (codeSentForEmail && !isEmailVerified) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            AuthFieldLabel(stringResource(R.string.auth_label_verification_code))
                            OutlinedTextField(
                                value = emailCode,
                                onValueChange = {
                                    emailCode = it.filter(Char::isDigit).take(6)
                                    onClearLoginError()
                                },
                                singleLine = true,
                                enabled = !busy,
                                shape = WakerInputShape,
                                colors = authFieldColors(),
                                keyboardOptions = KeyboardOptions(
                                    keyboardType = KeyboardType.NumberPassword,
                                    imeAction = ImeAction.Next,
                                ),
                                modifier = Modifier.weight(1f),
                            )
                        }
                        val confirmEnabled = !busy && emailCode.length == 6
                        OutlinedButton(
                            onClick = { onConfirmEmailVerification(email, emailCode) },
                            enabled = confirmEnabled,
                            modifier = Modifier.heightIn(min = 56.dp),
                            shape = WakerButtonShape,
                            border = authOutlinedButtonBorder(confirmEnabled),
                            colors = authOutlinedButtonColors(),
                        ) {
                            Text(stringResource(R.string.auth_confirm))
                        }
                    }
                    Text(
                        text = stringResource(R.string.auth_verification_code_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = AuthTextMuted,
                    )
                } else if (isEmailVerified) {
                    PasswordRuleRow(
                        text = stringResource(R.string.auth_email_verify_done),
                        satisfied = true,
                        satisfiedColor = BrandAccentOnScene,
                        pendingColor = AuthTextMuted,
                    )
                }

                // 인증 요청/코드 확인/가입 실패 안내 — 스낵바는 키보드에 가려 안 보인다.
                if (registerError != null) {
                    Text(
                        text = registerError,
                        style = MaterialTheme.typography.bodyMedium,
                        color = AuthErrorText,
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                AuthFieldLabel(stringResource(R.string.auth_label_password))
                OutlinedTextField(
                    value = password,
                    onValueChange = {
                        password = it
                        onClearLoginError()
                    },
                    singleLine = true,
                    enabled = !busy,
                    shape = WakerInputShape,
                    colors = authFieldColors(),
                    isError = mode == AuthMode.Login && loginError != null,
                    supportingText = if (mode == AuthMode.Login && loginError != null) {
                        { Text(loginError, color = AuthErrorText) }
                    } else {
                        null
                    },
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }) {
                            Icon(
                                imageVector = if (passwordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                contentDescription = if (passwordVisible) stringResource(R.string.auth_password_hide) else stringResource(R.string.auth_password_show),
                            )
                        }
                    },
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = if (mode == AuthMode.Register) ImeAction.Next else ImeAction.Done,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (mode == AuthMode.Register) {
                // 비밀번호·비밀번호 확인 입력창을 붙여 두고, 조건 안내는 확인 필드 아래에 모은다.
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    AuthFieldLabel(stringResource(R.string.auth_label_confirm_password))
                    OutlinedTextField(
                        value = confirmPassword,
                        onValueChange = { confirmPassword = it },
                        singleLine = true,
                        enabled = !busy,
                        shape = WakerInputShape,
                        colors = authFieldColors(),
                        isError = confirmPassword.isNotBlank() && !passwordMatches,
                        visualTransformation = if (confirmPasswordVisible) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        trailingIcon = {
                            IconButton(onClick = { confirmPasswordVisible = !confirmPasswordVisible }) {
                                Icon(
                                    imageVector = if (confirmPasswordVisible) {
                                        Icons.Outlined.VisibilityOff
                                    } else {
                                        Icons.Outlined.Visibility
                                    },
                                    contentDescription = if (confirmPasswordVisible) {
                                        stringResource(R.string.auth_confirm_password_hide)
                                    } else {
                                        stringResource(R.string.auth_confirm_password_show)
                                    },
                                )
                            }
                        },
                        supportingText = {
                            if (confirmPassword.isNotBlank() && !passwordMatches) {
                                Text(stringResource(R.string.auth_password_mismatch))
                            }
                        },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                PasswordRules(
                    passwordAtLeastMin = passwordAtLeastMin,
                    passwordHasLetterAndDigit = passwordHasLetterAndDigit,
                    passwordMatches = passwordMatches,
                )
            }

            Spacer(Modifier.height(2.dp))
            GradientCta(
                text = when {
                    busy -> stringResource(R.string.auth_processing)
                    mode == AuthMode.Register -> stringResource(R.string.auth_create_account)
                    else -> stringResource(R.string.auth_title_login)
                },
                onClick = {
                    if (mode == AuthMode.Register) onRegister(email, password, name, emailCode)
                    else onLogin(email, password)
                },
                enabled = !busy && canSubmit,
            )

            if (mode == AuthMode.Login) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.auth_forgot_password),
                        style = MaterialTheme.typography.bodyMedium,
                        color = AuthTextMuted,
                    )
                    TextButton(onClick = onFindPassword, colors = authTextButtonColors()) {
                        Text(stringResource(R.string.auth_find_password))
                    }
                }
                // SSO 구분선 — 소셜 로그인은 여기 아래로 묶고, 추후 제공자 추가 시 이 섹션에 덧붙인다.
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    HorizontalDivider(
                        modifier = Modifier.weight(1f),
                        color = AuthLineSoft,
                    )
                    Text(
                        // iOS 와 같은 문구 — "또는" 은 무엇 사이의 선택인지 말하지 않는다.
                        text = stringResource(R.string.auth_social_divider),
                        modifier = Modifier.padding(horizontal = 12.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = AuthTextMuted,
                    )
                    HorizontalDivider(
                        modifier = Modifier.weight(1f),
                        color = AuthLineSoft,
                    )
                }
                GoogleSignInButton(
                    enabled = !busy,
                    onClick = onGoogleSignIn,
                    modifier = Modifier.fillMaxWidth(),
                    label = stringResource(R.string.common_google_login),
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (mode == AuthMode.Login) {
                        stringResource(R.string.auth_landing_first_time)
                    } else {
                        stringResource(R.string.auth_already_have_account)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = AuthTextMuted,
                )
                TextButton(onClick = onSwitchMode, enabled = !busy, colors = authTextButtonColors()) {
                    Text(
                        if (mode == AuthMode.Login) stringResource(R.string.auth_title_register)
                        else stringResource(R.string.auth_title_login),
                    )
                }
            }
        }
    }
    }
}

@Composable
private fun PasswordRules(
    passwordAtLeastMin: Boolean,
    passwordHasLetterAndDigit: Boolean,
    passwordMatches: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        PasswordRuleRow(
            text = stringResource(R.string.auth_password_rule_min),
            satisfied = passwordAtLeastMin,
            satisfiedColor = BrandAccentOnScene,
            pendingColor = AuthTextMuted,
        )
        PasswordRuleRow(
            text = stringResource(R.string.auth_password_rule_alnum),
            satisfied = passwordHasLetterAndDigit,
            satisfiedColor = BrandAccentOnScene,
            pendingColor = AuthTextMuted,
        )
        PasswordRuleRow(
            text = stringResource(R.string.auth_password_rule_match),
            satisfied = passwordMatches,
            satisfiedColor = BrandAccentOnScene,
            pendingColor = AuthTextMuted,
        )
    }
}

@Composable
internal fun PasswordRuleRow(
    text: String,
    satisfied: Boolean,
    satisfiedColor: Color = MaterialTheme.colorScheme.primary,
    pendingColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    val color = if (satisfied) satisfiedColor else pendingColor
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(
            imageVector = if (satisfied) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = color,
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = color,
        )
    }
}
