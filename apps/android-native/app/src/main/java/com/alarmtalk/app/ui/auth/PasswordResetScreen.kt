package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

/**
 * 비밀번호 재설정 — 가입한 이메일로 6자리 코드를 받고, 코드 + 새 비밀번호로 변경한다.
 * 회원가입의 이메일 인증 UI를 미러링한다. 코드 발송 후([codeSentTo] == 입력 이메일)
 * 코드·새 비밀번호 입력이 노출된다. 확정은 단일 호출([onConfirm])로 검증+변경을 처리한다.
 */
@Composable
internal fun PasswordResetScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    codeSentTo: String?,
    onBack: () -> Unit,
    onRequestCode: (String) -> Unit,
    onConfirm: (email: String, code: String, newPassword: String) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    // '인증 코드 받기' 를 눌렀는데 이메일이 형식에 안 맞았는가 — **누른 뒤에만** 뜬다.
    // 치는 도중에 빨갛게 만들면 아직 다 치지도 않은 주소를 틀렸다고 하는 셈이다.
    // 로그인 화면(`AuthScreen` 의 `emailFormatError`)과 같은 규칙이다.
    var emailFormatError by remember { mutableStateOf(false) }

    // 형식 규칙의 단일 출처는 `ui/auth/AuthEmail.kt` — 로그인 화면과 **같은 판정**이다.
    // 여기만 `Patterns.EMAIL_ADDRESS` 로 두면 로그인은 되는데 비밀번호 재설정만 막히는
    // 계정이 생긴다(아포스트로피가 든 주소가 실제로 그랬다).
    val normalizedEmail = normalizeAuthEmail(email)
    val codeSent = codeSentTo != null && codeSentTo == normalizedEmail
    // 서버 정책(@alarmtalk/shared PasswordSchema)과 일치: 8~128자 + 영문·숫자 각 1자 이상.
    val passwordAtLeastMin = password.length >= 8
    val passwordUnderMax = password.length <= 128
    val passwordHasLetterAndDigit = password.any { it.isLetter() } && password.any { it.isDigit() }
    val passwordPolicyValid = passwordAtLeastMin && passwordUnderMax && passwordHasLetterAndDigit
    val canConfirm = codeSent && code.length == 6 && passwordPolicyValid

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
            Text(
                text = stringResource(R.string.auth_reset_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = TextOnSceneDim,
            )

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                AuthFieldLabel(stringResource(R.string.auth_label_email))
                OutlinedTextField(
                    value = email,
                    onValueChange = {
                        email = it
                        // 고쳐 치기 시작하면 경고를 지운다 — 남겨 두면 이미 고친 값 아래에
                        // 옛 경고가 붙어 있다(로그인 화면과 같은 시점).
                        emailFormatError = false
                    },
                    singleLine = true,
                    enabled = !busy && !codeSent,
                    shape = WakerInputShape,
                    colors = authFieldColors(),
                    isError = emailFormatError,
                    supportingText = if (emailFormatError) {
                        { Text(stringResource(R.string.auth_error_email_invalid), color = AuthErrorText) }
                    } else {
                        null
                    },
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.textInputTapTarget().then(Modifier.fillMaxWidth()),
                )
            }

            // ⚠ **형식으로 버튼을 죽이지 않는다**(CLAUDE.md) — 누를 수는 있고, 누르면 왜
            // 안 되는지 이메일 칸 아래에 말한다. 예전에는 `emailLooksValid` 로 잠가 놔서,
            // 주소를 잘못 친 사람은 눌리지 않는 버튼 앞에서 이유를 들을 길이 없었다.
            // 잠그는 것은 **보낼 것이 없을 때**(빈 칸)와 이미 보낸 뒤뿐이다.
            val requestEnabled = !busy && canRequestEmailCode(email) && !codeSent
            OutlinedButton(
                onClick = {
                    when (authEmailSubmitOutcome(email)) {
                        AuthEmailSubmitOutcome.ShowEmailFormatError -> emailFormatError = true
                        AuthEmailSubmitOutcome.Submit -> onRequestCode(email)
                    }
                },
                enabled = requestEnabled,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 54.dp),
                shape = WakerButtonShape,
                border = authOutlinedButtonBorder(requestEnabled),
                colors = authOutlinedButtonColors(),
            ) {
                Text(
                    if (codeSent) {
                        stringResource(R.string.auth_reset_code_sent)
                    } else {
                        stringResource(R.string.auth_reset_send_code)
                    },
                )
            }

            if (codeSent) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    AuthFieldLabel(stringResource(R.string.auth_label_verification_code))
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it.filter(Char::isDigit).take(6) },
                        singleLine = true,
                        enabled = !busy,
                        shape = WakerInputShape,
                        colors = authFieldColors(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.NumberPassword,
                            imeAction = ImeAction.Next,
                        ),
                        modifier = Modifier.textInputTapTarget().then(Modifier.fillMaxWidth()),
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    AuthFieldLabel(stringResource(R.string.auth_reset_new_password))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        singleLine = true,
                        enabled = !busy,
                        shape = WakerInputShape,
                        colors = authFieldColors(),
                        visualTransformation = if (passwordVisible) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        trailingIcon = {
                            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                Icon(
                                    imageVector = if (passwordVisible) {
                                        Icons.Outlined.VisibilityOff
                                    } else {
                                        Icons.Outlined.Visibility
                                    },
                                    contentDescription = if (passwordVisible) {
                                        stringResource(R.string.auth_password_hide)
                                    } else {
                                        stringResource(R.string.auth_password_show)
                                    },
                                )
                            }
                        },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        modifier = Modifier.textInputTapTarget().then(Modifier.fillMaxWidth()),
                    )
                }
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
                }

                GradientCta(
                    text = stringResource(R.string.auth_reset_submit),
                    onClick = { onConfirm(email, code, password) },
                    enabled = !busy && canConfirm,
                )
            }
        }
    }
}
