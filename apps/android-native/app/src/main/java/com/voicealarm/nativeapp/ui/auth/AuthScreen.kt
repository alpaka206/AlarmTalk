package com.voicealarm.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.dp

internal enum class AuthMode { Login, Register }

@Composable
internal fun AuthScreen(
    contentPadding: PaddingValues,
    mode: AuthMode,
    busy: Boolean,
    onBack: () -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onSwitchMode: () -> Unit,
    onGoogleSignIn: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    val canSubmit = email.isNotBlank() &&
        password.isNotBlank() &&
        (mode == AuthMode.Login || (name.isNotBlank() && password.length >= 8))

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
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

        if (mode == AuthMode.Register) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(30) },
                label = { Text("닉네임") },
                singleLine = true,
                enabled = !busy,
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
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("비밀번호") },
            singleLine = true,
            enabled = !busy,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        Button(
            onClick = {
                if (mode == AuthMode.Register) onRegister(email, password, name)
                else onLogin(email, password)
            },
            enabled = !busy && canSubmit,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
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
