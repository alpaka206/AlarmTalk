package com.voicealarm.nativeapp

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
    val passwordLengthValid = passwordAtLeastMin && passwordUnderMax
    val passwordMatches = password.isNotBlank() && password == confirmPassword
    val isEmailVerified = mode == AuthMode.Login || emailVerified == normalizedEmail
    val codeSentForEmail = emailVerificationSentTo == normalizedEmail
    val canSubmit = if (mode == AuthMode.Login) {
        email.isNotBlank() && password.isNotBlank()
    } else {
        name.isNotBlank() &&
            emailLooksValid &&
            isEmailVerified &&
            passwordLengthValid &&
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
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "뒤로")
            }
            Text(
                text = if (mode == AuthMode.Login) "로그인" else "회원가입",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            text = if (mode == AuthMode.Login) {
                "좋아하는 목소리 알람을 다시 불러오세요."
            } else {
                "좋아하는 목소리 알람을 만들 계정을 준비해요."
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (mode == AuthMode.Register) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(30) },
                label = { Text("이름") },
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
            label = { Text("이메일") },
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
                        isEmailVerified -> "이메일 인증 완료"
                        codeSentForEmail -> "인증 코드 다시 받기"
                        else -> "이메일 인증"
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
                        label = { Text("인증 코드") },
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
                        Text("확인")
                    }
                }
                Text(
                    text = "메일로 받은 6자리 코드를 입력해 주세요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else if (isEmailVerified) {
                PasswordRuleRow(text = "이메일 인증 완료", satisfied = true)
            }
        }

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("비밀번호") },
            singleLine = true,
            enabled = !busy,
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        imageVector = if (passwordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                        contentDescription = if (passwordVisible) "비밀번호 숨기기" else "비밀번호 보기",
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
                passwordUnderMax = passwordUnderMax,
                passwordMatches = passwordMatches,
            )

            OutlinedTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = { Text("비밀번호 확인") },
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
                                "비밀번호 확인 숨기기"
                            } else {
                                "비밀번호 확인 보기"
                            },
                        )
                    }
                },
                supportingText = {
                    if (confirmPassword.isNotBlank() && !passwordMatches) {
                        Text("비밀번호가 일치하지 않아요.")
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
                    busy -> "처리 중"
                    mode == AuthMode.Register -> "계정 만들기"
                    else -> "로그인"
                },
            )
        }

        GoogleSignInButton(
            enabled = !busy,
            onClick = onGoogleSignIn,
            modifier = Modifier.fillMaxWidth(),
        )

        TextButton(
            onClick = onSwitchMode,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (mode == AuthMode.Login) "처음이신가요? 회원가입"
                else "이미 계정이 있나요? 로그인",
            )
        }
    }
}

@Composable
private fun PasswordRules(
    passwordAtLeastMin: Boolean,
    passwordUnderMax: Boolean,
    passwordMatches: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        PasswordRuleRow(text = "8자 이상", satisfied = passwordAtLeastMin)
        PasswordRuleRow(text = "128자 이하", satisfied = passwordUnderMax)
        PasswordRuleRow(text = "비밀번호 확인 일치", satisfied = passwordMatches)
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
