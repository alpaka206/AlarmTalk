package com.alarmtalk.app

import android.util.Patterns
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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

/** 인증 플로우 공통 배경 — 은은한 네이비 그라데이션 + 상단 브랜드 글로우. */
@Composable
internal fun AuthBackdrop(content: @Composable BoxScope.() -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    0f to Color(0xFF1A2A52),
                    0.55f to Color(0xFF0E1938),
                    1f to Color(0xFF070C1D),
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
    errorCursorColor = MaterialTheme.colorScheme.error,
)

@Composable
internal fun authOutlinedButtonColors() = ButtonDefaults.outlinedButtonColors(
    contentColor = TextOnScene,
    disabledContentColor = Color(0x59FFFFFF),
)

internal fun authOutlinedButtonBorder(enabled: Boolean) =
    BorderStroke(1.dp, if (enabled) AuthLine else AuthLineSoft)

@Composable
internal fun authTextButtonColors() = ButtonDefaults.textButtonColors(
    contentColor = BrandAccentOnScene,
    disabledContentColor = Color(0x59FFFFFF),
)

@Composable
internal fun AuthScreen(
    contentPadding: PaddingValues,
    mode: AuthMode,
    busy: Boolean,
    emailVerificationSentTo: String?,
    emailVerified: String?,
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
                .padding(contentPadding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = stringResource(R.string.auth_back),
                        tint = TextOnScene,
                    )
                }
                Text(
                    text = if (mode == AuthMode.Login) stringResource(R.string.auth_title_login) else stringResource(R.string.auth_title_register),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = TextOnScene,
                )
            }
            Text(
                text = if (mode == AuthMode.Login) {
                    stringResource(R.string.auth_subtitle_login)
                } else {
                    stringResource(R.string.auth_subtitle_register)
                },
                style = MaterialTheme.typography.bodyMedium,
                color = TextOnSceneDim,
            )

            if (mode == AuthMode.Register) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(30) },
                    label = { Text(stringResource(R.string.auth_label_name)) },
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

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text(stringResource(R.string.auth_label_email)) },
                singleLine = true,
                enabled = !busy,
                shape = WakerInputShape,
                colors = authFieldColors(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            if (mode == AuthMode.Register) {
                val verifyEnabled = !busy && emailLooksValid && !isEmailVerified
                OutlinedButton(
                    onClick = { onRequestEmailVerification(email) },
                    enabled = verifyEnabled,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp),
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
                        OutlinedTextField(
                            value = emailCode,
                            onValueChange = { emailCode = it.filter(Char::isDigit).take(6) },
                            label = { Text(stringResource(R.string.auth_label_verification_code)) },
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
                        val confirmEnabled = !busy && emailCode.length == 6
                        OutlinedButton(
                            onClick = { onConfirmEmailVerification(email, emailCode) },
                            enabled = confirmEnabled,
                            modifier = Modifier.height(56.dp),
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
            }

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(stringResource(R.string.auth_label_password)) },
                singleLine = true,
                enabled = !busy,
                shape = WakerInputShape,
                colors = authFieldColors(),
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

            if (mode == AuthMode.Register) {
                PasswordRules(
                    passwordAtLeastMin = passwordAtLeastMin,
                    passwordHasLetterAndDigit = passwordHasLetterAndDigit,
                    passwordMatches = passwordMatches,
                )

                OutlinedTextField(
                    value = confirmPassword,
                    onValueChange = { confirmPassword = it },
                    label = { Text(stringResource(R.string.auth_label_confirm_password)) },
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
                        text = stringResource(R.string.auth_or),
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
