package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

internal enum class AuthMode { Login, Register }

// 인증 플로우(로그인/가입/비밀번호 찾기/약관 동의) 공통 스타일 — 랜딩의 밤바다 톤을
// 이어받은 고정 다크 배경이라 폼 색은 테마 대신 고정(랜딩 브랜드 비주얼 예외).
internal val AuthFieldGlass = Color(0x14FFFFFF)
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
            // ⚠ **입력창 밖을 누르면 입력이 끝난다**(2026-08-27 지시).
            // 로그인·회원가입·비밀번호 재설정·동의 화면이 모두 이 배경을 쓴다.
            // Final 패스에서 아무도 소비하지 않은 탭만 받는다(`clearFocusOnOutsideTap`).
            .clearFocusOnOutsideTap()
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

/** 스크롤 밖에 고정되는 제목 줄 — 원형 뒤로가기 + 가운데 제목. 고르기 화면(`AuthMethodsScreen`)도 같이 쓴다. */
@Composable
internal fun AuthTopBar(title: String, onBack: () -> Unit) {
    // 제목은 다른 하위 화면처럼 **위쪽 가운데**, 뒤로가기와 한 줄이다(2026-11-09 오너 — "로그인·회원가입도 다른 것들처럼
    // 상단 가운데에"). 예전에는 뒤로가기만 위에 두고 제목을 본문 첫 줄에 크게 세웠다(2026-08-10). 골격은 공용 `WakerTopBar`
    // 이고, 여기는 고정 팔레트 화면이라 색만 `TextOnScene` 으로 준다. iOS 짝 `LoginView` 의 `WakerTopBar(tint:)`.
    WakerTopBar(
        title = title,
        onBack = onBack,
        modifier = Modifier.padding(top = 18.dp),
        tint = TextOnScene,
    )
}

/**
 * 입력칸 **위**에 붙는 라벨 — iOS `VocaTextField` 와 같은 구성이다.
 *
 * ⚠ `OutlinedTextField(label = …)` 로 안에 넣지 말 것. Material 의 플로팅 라벨은
 * 비어 있을 때 칸 **안**에 앉고 테두리에 홈을 파서, 같은 색·같은 반경을 써도 iOS 의
 * '빈 유리판 + 위 라벨' 과 다른 물건으로 보인다(2026-08-10 두 앱 대조).
 *
 * 칸 높이는 두 앱이 같은 [AuthControlHeight](52)다(2026-11-22 — 그전에는 안드로이드 56·iOS 46 이었다). 안드로이드 최소
 * 누르는 영역 48dp 보다 크다.
 */
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

/**
 * 인증 화면(로그인·가입·비밀번호 재설정)의 한 줄 입력칸 — 위 라벨 + 유리판 칸.
 *
 * [placeholderOnly] 면 라벨을 칸 **위**에 두지 않고 칸 **안** 안내 글자로 쓴다 — 이메일 로그인 화면이 그렇다(2026-11-22 오너.
 * 실제 서비스를 열어 보니 무신사·오늘의집·컬리·쿠팡·클래스101 로그인 모두 칸 위 이름표가 없었다). 가입·재설정처럼 칸이 여럿인
 * 폼은 위 라벨을 둔다 — 글자를 치면 안내 글자가 사라져 어느 칸인지 남지 않는다.
 *
 * [textInputTapTarget] 을 여기서 붙인다 — 칸마다 손으로 붙이다 빠지면 그 칸을 눌러도
 * 키보드가 내려간다(CLAUDE.md 「입력 중 바깥을 누르면 입력이 끝난다」).
 *
 * [passwordVisible] 이 null 이 아니면 비밀번호 칸이다 — false 면 글자를 가리고, 끝에
 * 보기/숨기기 버튼을 단다. 그 상태는 **화면이 갖는다**(로그인↔가입을 오가도 유지된다).
 *
 * [supportingText](오류 문장)는 칸 줄 **아래**에 붙는다 — 옆 버튼([trailingAction])이 있어도 그 아래까지 쓴다.
 */
@Composable
internal fun AuthTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    keyboardType: KeyboardType,
    imeAction: ImeAction,
    enabled: Boolean,
    isError: Boolean = false,
    supportingText: (@Composable () -> Unit)? = null,
    passwordVisible: Boolean? = null,
    onTogglePasswordVisible: () -> Unit = {},
    showPasswordLabel: String = "",
    hidePasswordLabel: String = "",
    placeholderOnly: Boolean = false,
    // 칸 **옆**에 붙는 버튼(가입의 '인증 받기', 코드 줄의 '확인'). 칸 안에 넣지 않는다 — 긴 주소를 가리고, 아래 코드 줄의
    // [칸][확인] 과 모양이 갈린다(2026-11-14 오너 확인, 캔버스 proposal-09).
    trailingAction: (@Composable () -> Unit)? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!placeholderOnly) AuthFieldLabel(label)
        // 칸과 옆 버튼은 같은 높이([AuthControlHeight])라 가운데 정렬이면 한 줄이다. 오류 문장은 이 줄 밖 아래라 줄을 밀지 않는다.
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AuthOutlinedField(
                value = value,
                onValueChange = onValueChange,
                keyboardType = keyboardType,
                imeAction = imeAction,
                enabled = enabled,
                isError = isError,
                placeholder = if (placeholderOnly) label else null,
                passwordVisible = passwordVisible,
                onTogglePasswordVisible = onTogglePasswordVisible,
                showPasswordLabel = showPasswordLabel,
                hidePasswordLabel = hidePasswordLabel,
                modifier = Modifier.weight(1f),
            )
            trailingAction?.invoke()
        }
        if (supportingText != null) {
            // 칸 아래 오류 — 작은 글씨·오류색, 칸 **왼쪽 끝**에서 시작한다(위 이름표와 같은 줄). 여기 오는 것은 오류뿐이다.
            // 예전에는 Material 칸 안쪽 여백(16)만큼 들여 써서 iOS(들여 쓰지 않음)와 시작점이 달랐다(2026-11-22 두 앱 대조).
            CompositionLocalProvider(LocalContentColor provides AuthErrorText) {
                ProvideTextStyle(MaterialTheme.typography.bodySmall, supportingText)
            }
        }
    }
}

/**
 * 유리판 칸 하나 — 높이는 [AuthControlHeight](52).
 *
 * ⚠ Material `OutlinedTextField` 로 되돌리지 말 것. 그 칸은 최소 높이 56dp 를 스스로 걸고 위아래 여백도 16 씩이라, 52 로 줄이면
 *   글자가 잘린다. 같은 부품(`OutlinedTextFieldDefaults.DecorationBox`·`Container`)으로 칸을 짜고 위아래 여백만 뺐다 — 한 줄
 *   칸이라 글자는 가운데 놓인다. 글꼴을 아주 키우면 그만큼 자란다(`heightIn`). iOS `VocaTextField` 와 같은 높이다.
 */
// `DecorationBox`·`Container` 는 Material3 1.3 에서 실험 표시다 — 같은 부품을 `OutlinedTextField` 가 안에서 그대로 쓴다.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AuthOutlinedField(
    value: String,
    onValueChange: (String) -> Unit,
    keyboardType: KeyboardType,
    imeAction: ImeAction,
    enabled: Boolean,
    isError: Boolean,
    placeholder: String?,
    passwordVisible: Boolean?,
    onTogglePasswordVisible: () -> Unit,
    showPasswordLabel: String,
    hidePasswordLabel: String,
    modifier: Modifier,
) {
    val colors = authFieldColors()
    val interactionSource = remember { MutableInteractionSource() }
    val visualTransformation = if (passwordVisible == false) {
        PasswordVisualTransformation()
    } else {
        VisualTransformation.None
    }
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier
            .textInputTapTarget()
            .then(modifier)
            .heightIn(min = AuthControlHeight),
        enabled = enabled,
        singleLine = true,
        textStyle = LocalTextStyle.current.merge(TextStyle(color = if (enabled) TextOnScene else colors.disabledTextColor)),
        cursorBrush = SolidColor(if (isError) colors.errorCursorColor else colors.cursorColor),
        visualTransformation = visualTransformation,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
        interactionSource = interactionSource,
        decorationBox = { innerTextField ->
            OutlinedTextFieldDefaults.DecorationBox(
                value = value,
                innerTextField = innerTextField,
                enabled = enabled,
                singleLine = true,
                visualTransformation = visualTransformation,
                interactionSource = interactionSource,
                isError = isError,
                placeholder = placeholder?.let { text -> { Text(text, color = AuthTextMuted) } },
                trailingIcon = passwordVisible?.let { visible ->
                    {
                        IconButton(onClick = onTogglePasswordVisible) {
                            Icon(
                                imageVector = if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                contentDescription = if (visible) hidePasswordLabel else showPasswordLabel,
                            )
                        }
                    }
                },
                colors = colors,
                contentPadding = OutlinedTextFieldDefaults.contentPadding(top = 0.dp, bottom = 0.dp),
                container = {
                    OutlinedTextFieldDefaults.Container(
                        enabled = enabled,
                        isError = isError,
                        interactionSource = interactionSource,
                        colors = colors,
                        shape = WakerInputShape,
                    )
                },
            )
        },
    )
}

/**
 * 인증 코드 칸과 `확인`, 그 아래 한 줄 — 가입·비밀번호 재설정 두 화면이 같은 모양으로 쓴다. iOS 짝은 `LoginView.swift` 의
 * `AuthCodeConfirmRow` 와 그것을 감싼 `verificationCodeRow`.
 *
 * ⚠ **라벨은 줄 위에 따로 둔다**(2026-11-09 오너 "입력창이랑 확인이랑 줄 다름"). 줄에는 칸과 버튼만 같은 높이
 * ([AuthControlHeight])로 둔다 — 라벨까지 한 묶음이면 가운데 정렬된 버튼이 라벨을 합친 높이의 가운데로 올라간다.
 * 확인은 여섯 자리가 찼을 때만 눌린다 — 거절된 숫자는 화면이 비우므로 같은 숫자를 다시 보낼 수 없다.
 *
 * 줄 바로 아래(6)는 안내 '메일로 받은 6자리 코드를…' 이고, [error] 가 있으면 **그 자리에** 오류가 대신 선다(작은 글씨·오류색).
 * 2026-11-22 전에는 안드로이드만 안내를 화면 간격(14) 밖에 두고, 오류를 그 아래 큰 글씨로 하나 더 띄웠다 — iOS 와 달랐다.
 */
@Composable
internal fun AuthCodeConfirmRow(
    code: String,
    onCodeChange: (String) -> Unit,
    busy: Boolean,
    imeAction: ImeAction,
    error: String? = null,
    onConfirm: () -> Unit,
) {
    val confirmEnabled = !busy && code.length == VerificationCodeLength
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AuthTextField(
            label = stringResource(R.string.auth_label_verification_code),
            value = code,
            // ASCII 숫자 여섯 자로 맞춘다 — `isDigit` 필터는 ASCII 가 아닌 숫자를 그대로 통과시키고 서버는 그걸 형식에서 떨어뜨린다.
            onValueChange = { onCodeChange(sanitizeVerificationCode(it)) },
            keyboardType = KeyboardType.NumberPassword,
            imeAction = imeAction,
            enabled = !busy,
            trailingAction = {
                OutlinedButton(
                    onClick = onConfirm,
                    enabled = confirmEnabled,
                    modifier = Modifier.heightIn(min = AuthControlHeight),
                    shape = WakerButtonShape,
                    border = authOutlinedButtonBorder(confirmEnabled),
                    colors = authOutlinedButtonColors(),
                ) {
                    Text(stringResource(R.string.auth_confirm))
                }
            },
        )
        Text(
            text = error ?: stringResource(R.string.auth_verification_code_hint),
            style = MaterialTheme.typography.bodySmall,
            color = if (error != null) AuthErrorText else AuthTextMuted,
        )
    }
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
    // 그 실패의 **에러 코드**. 문구는 번역되므로 갈래 판정은 언제나 이 값으로 한다
    // (`isEmailFormatErrorCode`). iOS `AuthViewModel.loginErrorCode` 와 같은 짝이다.
    loginErrorCode: String? = null,
    registerError: String? = null,
    // 인증 코드 칸을 비우라는 신호(`MainViewModel.emailCodeFieldClearTick`) — 값이 바뀌면 비운다.
    codeFieldClearTick: Int = 0,
    // 회원가입 → 로그인 자동 전환(이미 가입된 이메일) 때 로그인 화면에 남는 이유 안내.
    authNotice: String? = null,
    onClearLoginError: () -> Unit = {},
    onBack: () -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onRequestEmailVerification: (String) -> Unit,
    onConfirmEmailVerification: (String, String) -> Unit,
    onSwitchMode: () -> Unit,
    onFindPassword: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var emailCode by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var confirmPasswordVisible by remember { mutableStateOf(false) }
    // 형식 규칙의 단일 출처는 `ui/auth/AuthEmail.kt` — 서버 `@alarmtalk/shared` 의
    // `EMAIL_PATTERN` 과 같은 값이다. 예전의 `Patterns.EMAIL_ADDRESS` 는 서버보다
    // 좁아서(아포스트로피 거부) 정당한 주소를 가진 사람의 로그인을 막았다.
    val normalizedEmail = normalizeAuthEmail(email)
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
    // 서버가 이메일 형식을 지적한 것(`AUTH_EMAIL_INVALID`)인지 가른다.
    //
    // ⚠ **문구를 비교하지 말 것**(2026-09-21 리뷰). 예전에는
    // `loginError == stringResource(R.string.auth_error_email_invalid)` 였다 — 문구를 한 글자
    // 고치거나 다른 에러 코드가 같은 문구 자원을 가리키게 되는 순간 **아무 경고 없이**
    // 갈래가 어긋나고, 형식 오류가 비밀번호 칸 아래로 내려간다. 판정은 코드 하나다.
    val emailInvalidMessage = stringResource(R.string.auth_error_email_invalid)
    val loginErrorIsEmailFormat = mode == AuthMode.Login && isEmailFormatErrorCode(loginErrorCode)
    // 비밀번호 칸 아래에는 **이메일 형식이 아닌** 로그인 실패만 남는다.
    val showPasswordLoginError =
        mode == AuthMode.Login && loginError != null && !loginErrorIsEmailFormat

    // 로그인 실패 시 비밀번호만 비운다 — 오타 대부분이 비밀번호 쪽이고, 이메일까지 비우면
    // 맞게 입력한 이메일을 다시 치는 마찰만 생긴다(문구가 이메일 확인도 함께 안내).
    //
    // ⚠ **이메일 형식 오류에서는 비우지 않는다.** 서버가 비밀번호를 **보지도 않은**
    // 실패라, 비우면 멀쩡한 비밀번호를 이메일 오타 때문에 다시 치게 된다.
    // 여기서도 갈래는 코드로 가른다 — 문구 비교는 조용히 어긋난다.
    LaunchedEffect(loginError, loginErrorCode) {
        if (loginError != null && !isEmailFormatErrorCode(loginErrorCode)) password = ""
    }

    // 거절된 인증 코드를 칸에 남기지 않는다(스펙 session-and-auth 「거절된 숫자를 칸에 남기지 않는다」).
    // 뷰모델이 신호를 올리는 때는 서버가 코드를 거절했을 때(틀림·만료·시도 상한 — 인증 확인이든
    // 가입이든)와 다시 받기가 성공했을 때다.
    //  - 확인 버튼은 여섯 자리가 찼을 때만 눌린다 — 칸이 비면 **방금 거절된 숫자를 그대로 다시 보낼 수
    //    없다**(2026-10-09 prod: 같은 여섯 자리를 3초에 다섯 번 보내 시도 상한을 태웠다).
    //  - 칸은 여섯 자에서 자른다 — 안 비우면 다시 받은 뒤 치는 새 숫자가 **한 글자도 안 들어간다.**
    // ⚠ **`registerError` 의 문장을 비교해 가르지 말 것.** 번역되는 문장이라 en·ja 에서 조용히
    // 어긋난다. 판정은 뷰모델이 에러 코드로 하고(`isEmailCodeRefusal`), 화면은 이 신호만 본다.
    // (첫 구성에서도 한 번 돈다 — 그때 칸은 어차피 비어 있다.)
    LaunchedEffect(codeFieldClearTick) { emailCode = "" }

    // 이메일을 보내는 버튼을 눌렀는데 형식에 안 맞았는가 — **누른 뒤에만** 뜬다.
    // 치는 도중에 빨갛게 만들면 아직 다 치지도 않은 주소를 틀렸다고 하는 셈이다.
    // 서버도 같은 판정을 `AUTH_EMAIL_INVALID` 로 돌려주므로 문구는 한 벌뿐이다.
    //
    // ⚠ 로그인 전용이 아니다 — **가입의 '이메일 인증'·'계정 만들기' 도 같은 플래그**를 쓴다.
    // 예전에는 가입 쪽만 `emailLooksValid` 로 버튼을 죽여 놓고 아무 말도 하지 않아서,
    // 주소를 잘못 친 사람은 눌리지 않는 버튼 앞에서 이유를 알 수 없었다(죽은 버튼은
    // 고장으로 읽힌다 — CLAUDE.md).
    var emailFormatError by remember { mutableStateOf(false) }
    // 모드가 바뀌면 형식 경고를 지운다. `email` 상태는 로그인↔가입을 오가도 그대로라,
    // 안 지우면 로그인에서 띄운 경고가 가입에 다녀온 뒤에도 **아무것도 안 했는데** 살아
    // 있다. iOS `Views/Auth/LoginView.swift` 의 `handleModeChange` 도 같이 지운다.
    LaunchedEffect(mode) { emailFormatError = false }
    // ⚠ **형식으로 버튼을 죽이지 않는다 — 두 모드 모두**(2026-09-21 리뷰).
    // 가입 쪽에만 `emailLooksValid` 가 남아 있어서, 로그인은 눌러서 이유를 듣는데
    // 가입은 같은 주소로 버튼이 죽어 있었다. 잠그는 것은 **보낼 것이 없을 때**뿐이고
    // (미인증·비밀번호 규칙), 형식은 누른 뒤에 이메일 칸 아래로 말한다.
    val canSubmit = if (mode == AuthMode.Login) {
        canSubmitLogin(email, password)
    } else {
        canRequestEmailCode(email) &&
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
        AuthTopBar(
            title = if (mode == AuthMode.Login) stringResource(R.string.auth_title_login) else stringResource(R.string.auth_title_register),
            onBack = onBack,
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                // 제목 줄(`AuthTopBar`)이 아래 간격을 이미 갖는다 — 여기는 조금만 띄운다(iOS `LoginView` 와 같은 8).
                .padding(top = 8.dp, bottom = 18.dp),
            // iOS `LoginView` 의 `VStack(spacing: 14)` 와 같은 값.
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // 회원가입에서 이미 가입된 이메일로 인증을 시도해 로그인으로 전환된 경우 —
            // 왜 화면이 바뀌었는지 여기서 설명한다(스낵바는 키보드에 가려 안 보인다).
            if (mode == AuthMode.Login && authNotice != null) {
                Text(
                    text = authNotice,
                    style = MaterialTheme.typography.bodyMedium,
                    color = AuthNoticeText,
                )
            }

            // 간편 로그인(카카오·구글)은 이 화면에 없다 — 앞 화면(`AuthMethodsScreen`)에서 고른다(2026-11-22 오너, 실제 앱 10개 중
            // 7개가 '수단 먼저 고르고 이메일은 다음 화면' 이었다). 여기는 '이메일로 계속하기' 를 고른 사람의 화면이다. 로그인은 칸
            // 두 개를 칸 안 안내 글자로만 쓰고, 가입은 칸이 많아 라벨을 칸 위에 둔다. iOS 짝 `LoginView`.

            // 형식 오류는 **이메일 칸 아래**에 붙인다. 나머지 서버 실패(`loginError`)는
            // 비밀번호 칸 아래지만, 이건 이메일을 고쳐야 하는 일이라 고칠 칸 옆에 있어야 한다.
            //
            // ⚠ **앱이 잡은 것과 서버가 잡은 것이 같은 자리에 뜬다.** 판정은 같은데
            // 앱 갈래는 이메일 칸, 서버 갈래는 비밀번호 칸이면 사용자는 같은 말을 두
            // 자리에서 보게 되고, 비밀번호 쪽에 뜬 회차에는 비밀번호부터 다시 친다.
            //
            // ⚠ **가입 모드에도 붙는다.** `emailFormatError` 는 '이메일 인증' 버튼을 누른
            // 회차에도 켜지므로, 로그인에서만 그리면 가입 쪽은 눌러도 아무 말이 없다.
            // 서버 갈래(`loginErrorIsEmailFormat`)는 로그인 응답이라 로그인 모드에서만 온다.
            val showEmailFormatError = emailFormatError || loginErrorIsEmailFormat
            AuthTextField(
                label = stringResource(R.string.auth_label_email),
                value = email,
                onValueChange = {
                    email = it
                    emailFormatError = false
                    onClearLoginError()
                },
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
                enabled = !busy,
                isError = showEmailFormatError || (mode == AuthMode.Login && loginError != null),
                supportingText = if (showEmailFormatError) {
                    { Text(emailInvalidMessage, color = AuthErrorText) }
                } else {
                    null
                },
                placeholderOnly = mode == AuthMode.Login,
                trailingAction = if (mode == AuthMode.Register) {
                    {
                        EmailVerifyButton(
                            verified = isEmailVerified,
                            codeSent = codeSentForEmail,
                            // ⚠ **형식으로 죽이지 않는다** — 가입에서 실질적인 제출 버튼이 이것이다. 예전에는
                            // `emailLooksValid` 로 잠가 놔서, 주소를 잘못 친 사람은 눌리지 않는 버튼 앞에서
                            // **무엇이 잘못됐는지 들을 길이 없었다.** 빈 칸일 때만 흐리다.
                            enabled = !busy && canRequestEmailCode(email) && !isEmailVerified,
                            onClick = {
                                when (authEmailSubmitOutcome(email)) {
                                    AuthEmailSubmitOutcome.ShowEmailFormatError -> emailFormatError = true
                                    AuthEmailSubmitOutcome.Submit -> onRequestEmailVerification(email)
                                }
                            },
                        )
                    }
                } else {
                    null
                },
            )

            if (mode == AuthMode.Register) {
                // 인증 요청·코드 확인·가입의 실패 문장 — 코드 줄이 있으면 그 줄 아래 안내 자리(`AuthCodeConfirmRow` 의 `error`),
                // 없으면 이메일 줄 바로 아래다. 스낵바는 키보드에 가려 안 보인다. iOS `LoginView` 의 `emailCodeError` 와 같은 자리·크기다.
                if (codeSentForEmail && !isEmailVerified) {
                    AuthCodeConfirmRow(
                        code = emailCode,
                        onCodeChange = {
                            emailCode = it
                            onClearLoginError()
                        },
                        busy = busy,
                        imeAction = ImeAction.Next,
                        error = registerError,
                        onConfirm = { onConfirmEmailVerification(email, emailCode) },
                    )
                } else if (registerError != null) {
                    Text(
                        text = registerError,
                        style = MaterialTheme.typography.bodySmall,
                        color = AuthErrorText,
                    )
                }
                // 인증을 마친 것은 이메일 칸 옆 버튼('✓ 인증됨')이 말한다 — 아래에 '이메일 인증 완료' 줄을 또 두지
                // 않는다(예전에는 버튼과 줄이 같은 말을 두 번 했다).
            }

            AuthTextField(
                label = stringResource(R.string.auth_label_password),
                value = password,
                onValueChange = {
                    password = it
                    onClearLoginError()
                },
                keyboardType = KeyboardType.Password,
                imeAction = if (mode == AuthMode.Register) ImeAction.Next else ImeAction.Done,
                enabled = !busy,
                // 이메일 형식 갈래는 **위 이메일 칸**이 맡는다 — 같은 문구를 두
                // 자리에 띄우지 않는다.
                isError = showPasswordLoginError,
                supportingText = if (showPasswordLoginError && loginError != null) {
                    { Text(loginError, color = AuthErrorText) }
                } else {
                    null
                },
                passwordVisible = passwordVisible,
                onTogglePasswordVisible = { passwordVisible = !passwordVisible },
                showPasswordLabel = stringResource(R.string.auth_password_show),
                hidePasswordLabel = stringResource(R.string.auth_password_hide),
                placeholderOnly = mode == AuthMode.Login,
            )

            if (mode == AuthMode.Register) {
                // 비밀번호·비밀번호 확인 입력창을 붙여 두고, 조건 안내는 확인 필드 아래에 모은다.
                AuthTextField(
                    label = stringResource(R.string.auth_label_confirm_password),
                    value = confirmPassword,
                    onValueChange = { confirmPassword = it },
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                    enabled = !busy,
                    isError = confirmPassword.isNotBlank() && !passwordMatches,
                    supportingText = if (confirmPassword.isNotBlank() && !passwordMatches) {
                        { Text(stringResource(R.string.auth_password_mismatch)) }
                    } else {
                        null
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
            }

            // 주 버튼은 위 칸·규칙에서 14 + 4 떨어진다(iOS `LoginView.submitButton` 의 `.padding(.top, 4)` 와 같은 18). 예전에는
            // 여기 `Spacer(2)` 를 두어 간격 14 가 한 번 더 붙어 30 이었다(2026-11-22 두 앱 대조).
            Box(Modifier.padding(top = 4.dp)) {
                GradientCta(
                    text = when {
                        busy -> stringResource(R.string.auth_processing)
                        mode == AuthMode.Register -> stringResource(R.string.auth_create_account)
                        else -> stringResource(R.string.auth_title_login)
                    },
                    onClick = {
                        // ⚠ **버튼을 죽이지 않는다**(CLAUDE.md) — 누를 수는 있고, 누르면 왜
                        // 안 되는지 말한다. 이메일 형식은 서버에 물어볼 것도 없는 실패라
                        // 네트워크를 타기 전에 여기서 끊는다(서버 판정과 같은 갈래 =
                        // `AUTH_EMAIL_INVALID`). 판정은 **두 모드가 같은 함수**를 쓴다.
                        when (authEmailSubmitOutcome(email)) {
                            AuthEmailSubmitOutcome.ShowEmailFormatError -> emailFormatError = true
                            AuthEmailSubmitOutcome.Submit -> if (mode == AuthMode.Register) {
                                onRegister(email, password, emailCode)
                            } else {
                                onLogin(email, password)
                            }
                        }
                    },
                    enabled = !busy && canSubmit,
                )
            }

            if (mode == AuthMode.Login) {
                AuthLoginLinksRow(enabled = !busy, onFindPassword = onFindPassword, onRegister = onSwitchMode)
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.auth_already_have_account),
                        style = MaterialTheme.typography.bodyMedium,
                        color = AuthTextMuted,
                    )
                    TextButton(onClick = onSwitchMode, enabled = !busy, colors = authTextButtonColors()) {
                        Text(stringResource(R.string.auth_title_login))
                    }
                }
            }
        }
    }
    }
}

/**
 * 이메일 로그인 아래 한 줄 — `비밀번호 찾기 | 회원가입`(2026-11-22 오너). 실제 서비스(무신사·오늘의집·컬리·쿠팡, 앱 웨이브·
 * 밀리의서재)가 모두 로그인 버튼 근처 한 줄이었다. 예전에는 '비밀번호를 잊으셨나요? 비밀번호 찾기' 와 '처음 사용하시나요?
 * 회원가입' 두 줄로 떨어져 있었다. 둘은 같은 무게다 — 어느 쪽도 주 버튼이 아니다. iOS 짝 `LoginView.loginLinksRow`.
 */
@Composable
private fun AuthLoginLinksRow(enabled: Boolean, onFindPassword: () -> Unit, onRegister: () -> Unit) {
    val colors = ButtonDefaults.textButtonColors(
        contentColor = TextOnSceneDim,
        disabledContentColor = Color(0x8CFFFFFF),
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onFindPassword, enabled = enabled, colors = colors) {
            Text(stringResource(R.string.auth_find_password), style = MaterialTheme.typography.bodyMedium)
        }
        Box(
            Modifier
                .width(1.dp)
                .height(12.dp)
                .background(AuthLine),
        )
        TextButton(onClick = onRegister, enabled = enabled, colors = colors) {
            Text(stringResource(R.string.auth_title_register), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * 가입의 이메일 칸 옆 버튼 — `인증 받기` → (보낸 뒤) `다시 받기` → (확인되면) `✓ 인증됨`. 인증 상태는 **정규화한 그
 * 주소**에 묶여 있어 주소를 고치면 `인증 받기` 로 돌아간다(`emailVerified == normalizedEmail`). 높이는 칸과 같은
 * [AuthControlHeight](52)라 한 줄로 맞는다. iOS 짝은 `LoginView.emailVerifyButton`.
 */
@Composable
internal fun EmailVerifyButton(
    verified: Boolean,
    codeSent: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .heightIn(min = AuthControlHeight)
            .widthIn(min = 88.dp),
        shape = WakerButtonShape,
        // 인증됨은 눌리지 않지만 '꺼진 버튼' 이 아니라 '마친 상태' 로 읽혀야 한다 — 강조색 글자·옅은 강조 테두리.
        border = if (verified) BorderStroke(1.dp, BrandAccentOnScene.copy(alpha = 0.3f)) else authOutlinedButtonBorder(enabled),
        colors = authOutlinedButtonColors(),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        if (verified) {
            Icon(
                imageVector = Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = BrandAccentOnScene,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(4.dp))
        }
        Text(
            text = when {
                verified -> stringResource(R.string.auth_email_verify_done)
                codeSent -> stringResource(R.string.auth_email_verify_resend_short)
                else -> stringResource(R.string.auth_email_verify)
            },
            color = if (verified) BrandAccentOnScene else Color.Unspecified,
            maxLines = 1,
        )
    }
}

/** 비밀번호 규칙 세 줄 — 가입·비밀번호 재설정 두 화면이 같은 모양으로 쓴다(iOS `PasswordRules`). */
@Composable
internal fun PasswordRules(
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
