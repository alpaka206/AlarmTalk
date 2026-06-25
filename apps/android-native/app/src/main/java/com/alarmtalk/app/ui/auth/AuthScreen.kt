package com.alarmtalk.app

import android.util.Patterns
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

internal enum class AuthMode { Login, Register }

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
    onFindId: () -> Unit,
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
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.auth_back))
            }
            Text(
                text = if (mode == AuthMode.Login) stringResource(R.string.auth_title_login) else stringResource(R.string.auth_title_register),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            text = if (mode == AuthMode.Login) {
                stringResource(R.string.auth_subtitle_login)
            } else {
                stringResource(R.string.auth_subtitle_register)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (mode == AuthMode.Register) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(30) },
                label = { Text(stringResource(R.string.auth_label_name)) },
                singleLine = true,
                enabled = !busy,
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
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
            colors = wakerOutlinedTextFieldColors(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        if (mode == AuthMode.Register) {
            OutlinedButton(
                onClick = { onRequestEmailVerification(email) },
                enabled = !busy && emailLooksValid && !isEmailVerified,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp),
                shape = WakerButtonShape,
                border = wakerCardBorder(),
                colors = wakerOutlinedButtonColors(),
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
                        colors = wakerOutlinedTextFieldColors(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.NumberPassword,
                            imeAction = ImeAction.Next,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(
                        onClick = { onConfirmEmailVerification(email, emailCode) },
                        enabled = !busy && emailCode.length == 6,
                        modifier = Modifier.height(56.dp),
                        shape = WakerButtonShape,
                        border = wakerCardBorder(),
                        colors = wakerOutlinedButtonColors(),
                    ) {
                        Text(stringResource(R.string.auth_confirm))
                    }
                }
                Text(
                    text = stringResource(R.string.auth_verification_code_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else if (isEmailVerified) {
                PasswordRuleRow(text = stringResource(R.string.auth_email_verify_done), satisfied = true)
            }
        }

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(stringResource(R.string.auth_label_password)) },
            singleLine = true,
            enabled = !busy,
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
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
                colors = wakerOutlinedTextFieldColors(),
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

        Button(
            onClick = {
                if (mode == AuthMode.Register) onRegister(email, password, name, emailCode)
                else onLogin(email, password)
            },
            enabled = !busy && canSubmit,
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp),
            shape = WakerButtonShape,
        ) {
            Text(
                when {
                    busy -> stringResource(R.string.auth_processing)
                    mode == AuthMode.Register -> stringResource(R.string.auth_create_account)
                    else -> stringResource(R.string.auth_title_login)
                },
            )
        }

        if (mode == AuthMode.Login) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onFindId) {
                    Text(
                        text = stringResource(R.string.auth_find_id),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(text = "|", color = MaterialTheme.colorScheme.outlineVariant)
                TextButton(onClick = onFindPassword) {
                    Text(
                        text = stringResource(R.string.auth_find_password),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // SSO 구분선 — 소셜 로그인은 여기 아래로 묶고, 추후 제공자 추가 시 이 섹션에 덧붙인다.
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                HorizontalDivider(
                    modifier = Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                Text(
                    text = stringResource(R.string.auth_or),
                    modifier = Modifier.padding(horizontal = 12.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                HorizontalDivider(
                    modifier = Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
            }
            GoogleSignInButton(
                enabled = !busy,
                onClick = onGoogleSignIn,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        TextButton(
            onClick = onSwitchMode,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (mode == AuthMode.Login) stringResource(R.string.auth_switch_to_register)
                else stringResource(R.string.auth_switch_to_login),
            )
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
        PasswordRuleRow(text = stringResource(R.string.auth_password_rule_min), satisfied = passwordAtLeastMin)
        PasswordRuleRow(text = stringResource(R.string.auth_password_rule_alnum), satisfied = passwordHasLetterAndDigit)
        PasswordRuleRow(text = stringResource(R.string.auth_password_rule_match), satisfied = passwordMatches)
    }
}

@Composable
private fun PasswordRuleRow(text: String, satisfied: Boolean) {
    val color = if (satisfied) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
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
