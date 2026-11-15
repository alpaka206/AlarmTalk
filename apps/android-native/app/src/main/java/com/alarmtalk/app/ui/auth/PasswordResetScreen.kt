package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.unit.dp

/**
 * 비밀번호 재설정 — 가입한 이메일로 6자리 코드를 받아 **먼저 확인하고**, 그다음 새 비밀번호를 정한다
 * (2026-11-16 오너: "인증 코드 받고 확인한 다음에 넘어가게"). 비밀번호를 찾아 주는 것이 아니라 바꾸는 것이다 —
 * 서버에는 비밀번호 원문이 없다(bcrypt 해시만 있다).
 *
 * 이메일·코드 줄은 가입 화면([AuthScreen])과 **같은 부품**이다: 이메일 칸 옆 `인증 받기`(보낸 뒤 `다시 받기`,
 * 확인 뒤 `✓ 인증됨`), 코드 칸과 `확인`, 그 아래 안내. 새 비밀번호·비밀번호 확인·규칙 세 줄도 가입과 같다.
 * 확인([onVerifyCode] — `POST /auth/password-reset/verify`)은 코드를 쓰지 않고, 확정([onConfirm])에서 서버가
 * 같은 코드를 한 번 더 판정한다. iOS `PasswordResetView` 와 같다.
 */
@Composable
internal fun PasswordResetScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    codeSentTo: String?,
    // 코드를 확인한 이메일(`MainViewModel.passwordResetVerified`). 입력 이메일과 같을 때만 새 비밀번호 단계다.
    verifiedEmail: String?,
    // 인증 코드 칸을 비우라는 신호(`MainViewModel.emailCodeFieldClearTick`) — 값이 바뀌면 비운다.
    codeFieldClearTick: Int = 0,
    onBack: () -> Unit,
    onRequestCode: (String) -> Unit,
    onVerifyCode: (email: String, code: String) -> Unit,
    onConfirm: (email: String, code: String, newPassword: String) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var confirmPasswordVisible by remember { mutableStateOf(false) }
    // `인증 받기` 를 눌렀는데 이메일이 형식에 안 맞았는가 — **누른 뒤에만** 뜬다.
    // 치는 도중에 빨갛게 만들면 아직 다 치지도 않은 주소를 틀렸다고 하는 셈이다.
    // 로그인 화면(`AuthScreen` 의 `emailFormatError`)과 같은 규칙이다.
    var emailFormatError by remember { mutableStateOf(false) }

    // 형식 규칙의 단일 출처는 `ui/auth/AuthEmail.kt` — 로그인 화면과 **같은 판정**이다.
    // 여기만 `Patterns.EMAIL_ADDRESS` 로 두면 로그인은 되는데 비밀번호 재설정만 막히는
    // 계정이 생긴다(아포스트로피가 든 주소가 실제로 그랬다).
    val normalizedEmail = normalizeAuthEmail(email)
    // 보낸 것도 확인한 것도 **그 주소에** 묶인다 — 주소를 고치면 `인증 받기` 로 돌아간다(가입과 같다).
    val codeSent = codeSentTo != null && codeSentTo == normalizedEmail
    val verified = codeSent && verifiedEmail == normalizedEmail
    // 서버 정책(@alarmtalk/shared PasswordSchema)과 일치: 8~128자 + 영문·숫자 각 1자 이상.
    val passwordAtLeastMin = password.length >= 8
    val passwordUnderMax = password.length <= 128
    val passwordHasLetterAndDigit = password.any { it.isLetter() } && password.any { it.isDigit() }
    val passwordPolicyValid = passwordAtLeastMin && passwordUnderMax && passwordHasLetterAndDigit
    val passwordMatches = password.isNotBlank() && password == confirmPassword
    val canConfirm = verified && code.length == VerificationCodeLength && passwordPolicyValid && passwordMatches

    // 거절된 인증 코드를 칸에 남기지 않는다 — 서버가 코드를 거절했을 때(틀림·만료·시도 상한)와 다시
    // 받기가 성공했을 때 뷰모델이 신호를 올린다. 가입 화면(`AuthScreen`)과 같은 규칙이고 이유도 같다:
    // 칸이 비면 거절된 숫자를 그대로 다시 보낼 수 없고, 꽉 찬 칸에 새 숫자가 안 들어가는 일도 없다.
    // 새 비밀번호는 지우지 않는다 — 거절된 것은 코드다.
    LaunchedEffect(codeFieldClearTick) { code = "" }

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
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = stringResource(R.string.auth_back),
                        tint = TextOnScene,
                    )
                }
                Text(
                    text = stringResource(R.string.auth_reset_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = TextOnScene,
                )
            }
            // 제목 아래 안내('가입한 이메일로 인증 코드를 보내드려요.')는 뺐다(2026-11-16 오너) — 칸과 버튼이 같은 말을 한다.

            AuthTextField(
                label = stringResource(R.string.auth_label_email),
                value = email,
                onValueChange = {
                    email = it
                    // 고쳐 치기 시작하면 경고를 지운다 — 남겨 두면 이미 고친 값 아래에
                    // 옛 경고가 붙어 있다(로그인 화면과 같은 시점).
                    emailFormatError = false
                },
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
                enabled = !busy,
                isError = emailFormatError,
                supportingText = if (emailFormatError) {
                    { Text(stringResource(R.string.auth_error_email_invalid), color = AuthErrorText) }
                } else {
                    null
                },
                trailingAction = {
                    // ⚠ **형식으로 버튼을 죽이지 않는다**(CLAUDE.md) — 누를 수는 있고, 누르면 왜 안 되는지
                    // 이메일 칸 아래에 말한다. 잠그는 것은 **보낼 것이 없을 때**(빈 칸)와 확인을 마쳤을 때뿐이다.
                    //
                    // ⚠ **보낸 뒤에도 눌린다**(2026-10-11) — `다시 받기` 다. 코드가 만료되거나 틀린 횟수를 다 써서
                    // "다시 받아 주세요" 를 들은 사람이 화면을 나갔다 오지 않고 다시 받는다. 너무 잦은 요청은 서버가
                    // 걸러 낸다(`shouldSkipEmailCodeSend` — 스펙 session-and-auth 「이메일 인증 코드」).
                    EmailVerifyButton(
                        verified = verified,
                        codeSent = codeSent,
                        enabled = !busy && canRequestEmailCode(email) && !verified,
                        onClick = {
                            when (authEmailSubmitOutcome(email)) {
                                AuthEmailSubmitOutcome.ShowEmailFormatError -> emailFormatError = true
                                AuthEmailSubmitOutcome.Submit -> onRequestCode(email)
                            }
                        },
                    )
                },
            )

            if (codeSent && !verified) {
                // 가입 화면의 코드 줄과 같다 — 라벨은 줄 위에 따로, 줄에는 입력칸과 `확인` 만 같은 높이(56)로.
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    AuthFieldLabel(stringResource(R.string.auth_label_verification_code))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedTextField(
                            value = code,
                            onValueChange = { code = sanitizeVerificationCode(it) },
                            singleLine = true,
                            enabled = !busy,
                            shape = WakerInputShape,
                            colors = authFieldColors(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.NumberPassword,
                                imeAction = ImeAction.Done,
                            ),
                            modifier = Modifier.textInputTapTarget().then(Modifier.weight(1f)),
                        )
                        val verifyEnabled = !busy && code.length == VerificationCodeLength
                        OutlinedButton(
                            onClick = { onVerifyCode(email, code) },
                            enabled = verifyEnabled,
                            modifier = Modifier.heightIn(min = 56.dp),
                            shape = WakerButtonShape,
                            border = authOutlinedButtonBorder(verifyEnabled),
                            colors = authOutlinedButtonColors(),
                        ) {
                            Text(stringResource(R.string.auth_confirm))
                        }
                    }
                }
                Text(
                    text = stringResource(R.string.auth_verification_code_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = AuthTextMuted,
                )
            }

            if (verified) {
                AuthTextField(
                    label = stringResource(R.string.auth_reset_new_password),
                    value = password,
                    onValueChange = { password = it },
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Next,
                    enabled = !busy,
                    passwordVisible = passwordVisible,
                    onTogglePasswordVisible = { passwordVisible = !passwordVisible },
                    showPasswordLabel = stringResource(R.string.auth_password_show),
                    hidePasswordLabel = stringResource(R.string.auth_password_hide),
                )
                // 비밀번호 확인 칸 — 가입 화면과 같다(2026-11-16 오너 "비밀번호 찾기에는 비밀번호 확인 일치가 왜 없어").
                // 잘못 친 채 바꾸면 그 비밀번호로는 로그인할 수 없어 재설정을 한 번 더 해야 한다.
                AuthTextField(
                    label = stringResource(R.string.auth_label_confirm_password),
                    value = confirmPassword,
                    onValueChange = { confirmPassword = it },
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                    enabled = !busy,
                    isError = confirmPassword.isNotBlank() && !passwordMatches,
                    supportingText = {
                        if (confirmPassword.isNotBlank() && !passwordMatches) {
                            Text(stringResource(R.string.auth_password_mismatch))
                        }
                    },
                    passwordVisible = confirmPasswordVisible,
                    onTogglePasswordVisible = { confirmPasswordVisible = !confirmPasswordVisible },
                    showPasswordLabel = stringResource(R.string.auth_confirm_password_show),
                    hidePasswordLabel = stringResource(R.string.auth_confirm_password_hide),
                )
                PasswordRules(
                    passwordAtLeastMin = passwordAtLeastMin,
                    passwordHasLetterAndDigit = passwordHasLetterAndDigit,
                    passwordMatches = passwordMatches,
                )

                GradientCta(
                    text = stringResource(R.string.auth_reset_submit),
                    onClick = { onConfirm(email, code, password) },
                    enabled = !busy && canConfirm,
                )
            }
        }
    }
}
