import AuthenticationServices
import SwiftUI
import UIKit

/// `LandingView` -> `LoginView` 흐름에서 로그인/회원가입 단일 화면.
///
/// Android `apps/android-native/.../ui/auth/AuthScreen.kt:48-323` 의 2-mode UI 를
/// 1:1 포팅했다. mode segmented control + 폼 + 인증코드 + Apple 버튼을 한 화면에
/// 담아 마찰을 최소화한다.
///
/// Mode
///   - `.login` : 이메일 + 비밀번호 두 칸. 즉시 제출 가능.
///   - `.register` : 이름 + 이메일 + 인증코드(6자리) + 비밀번호 + 비밀번호 확인.
///     `이메일 인증` 버튼을 눌러 코드를 발송하고, 6자리 입력 후 `확인` 으로 검증한다.
///     검증이 끝나기 전에는 제출 불가.
///
/// Apple 로그인은 mode 와 무관하게 패널 하단에 노출된다. 사용자가 이미 가입돼
/// 있으면 그대로 로그인되고, 처음이면 백엔드에서 계정이 생성된다.
struct LoginView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let initialMode: LoginMode

    @State private var mode: LoginMode
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var confirmPassword: String = ""
    @State private var name: String = ""
    @State private var verificationCode: String = ""
    /// 닉네임이 상한을 넘겨 잘렸는가 — 이유를 입력창 아래에 띄운다(말없이 자르지 않는다).
    @State private var nameTooLong = false
    @State private var verificationSent: Bool = false
    @State private var verificationCompleted: Bool = false
    @State private var verifiedEmail: String = ""

    @State private var isPasswordVisible = false
    @State private var isConfirmPasswordVisible = false

    @State private var pendingRawNonce: String?
    @State private var showPasswordReset = false

    init(initialMode: LoginMode) {
        self.initialMode = initialMode
        _mode = State(initialValue: initialMode)
    }

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var emailLooksValid: Bool {
        LoginValidator.isValidEmail(normalizedEmail)
    }

    private var passwordAtLeastMin: Bool { password.count >= 8 }
    private var passwordUnderMax: Bool { password.count <= 128 }
    private var passwordLengthValid: Bool { passwordAtLeastMin && passwordUnderMax }
    // 서버 정책(@alarmtalk/shared PasswordSchema)·Android 와 동일: 영문·숫자 각 1자 이상.
    private var passwordHasLetter: Bool { password.contains(where: { $0.isLetter }) }
    private var passwordHasDigit: Bool { password.contains(where: { $0.isNumber }) }
    private var passwordHasLetterAndDigit: Bool { passwordHasLetter && passwordHasDigit }
    private var passwordMatches: Bool { !password.isEmpty && password == confirmPassword }

    private var isEmailVerifiedForCurrentInput: Bool {
        mode == .login || (verificationCompleted && verifiedEmail == normalizedEmail)
    }

    private var canSubmit: Bool {
        guard !auth.isBusy else { return false }
        if mode == .login {
            return !email.isEmpty && !password.isEmpty
        }
        return !name.isEmpty &&
            emailLooksValid &&
            isEmailVerifiedForCurrentInput &&
            passwordLengthValid &&
            passwordHasLetterAndDigit &&
            passwordMatches
    }

    var body: some View {
        AuthBackdrop {

            VStack(alignment: .leading, spacing: 0) {
            // ⚠ **뒤로가기는 스크롤 밖에 둔다.** 안에 두면 폼을 내리거나 키보드가
            // 올라와 내용이 밀릴 때 같이 사라져, 나갈 길이 화면에서 없어진다.
            // 스크롤되는 건 폼이고 탈출구는 늘 같은 자리에 있어야 한다.
            //
            // ⚠ **시스템 뒤로가기를 쓰지 않는다.** OS 버전마다 컨테이너 모양이 바뀌므로
            // 앱 공용 `WakerBackButton`이 원형 표면·크기·색을 고정한다. 글리프만 각 플랫폼의
            // 기본 방향 아이콘을 쓴다. Android 대응: `ui/components/WakerBackButton.kt`.
            WakerBackButton(tint: AuthSceneColors.text) { dismiss() }
                .padding(.horizontal, 22)
                .padding(.top, 18)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // 안드로이드는 세그먼트 피커가 없다(AuthScreen.kt:215-232) — 화면 안에
                    // 제목을 두고, 로그인↔가입은 **맨 아래 전환 행**에서 고른다. 피커를
                    // 위에 두면 아직 계정이 있는지도 모르는 사람에게 먼저 답을 강요하게 된다.
                    Text(mode == .login ? "로그인" : "회원가입")
                        .font(theme.typography.headlineSmall)
                        .fontWeight(.bold)
                        .foregroundStyle(AuthSceneColors.text)
                        .padding(.top, 6)

                    Text(mode == .login
                         ? "좋아하는 목소리 알람을 다시 불러올게요."
                         : "목소리 알람을 만들 계정을 준비해요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(AuthSceneColors.textDim)

                    if mode == .register {
                        nameField
                    }

                    emailField

                    if mode == .register {
                        verifyEmailRow
                        if verificationSent && !verificationCompleted {
                            verificationCodeRow
                        } else if isEmailVerifiedForCurrentInput {
                            RuleRow(text: "이메일 인증 완료", satisfied: true)
                        }
                    }

                    passwordField

                    if mode == .register {
                        passwordRules
                        confirmPasswordField
                    }

                    submitButton

                    // SSO·비밀번호 찾기는 로그인 모드에서만 노출(Android AuthScreen.kt:314-355).
                    if mode == .login {
                        findPasswordRow
                        appleSignInRow
                    }

                    if let message = auth.statusMessage {
                        // ⚠ **성공을 빨간색으로 그리지 말 것.** 이 자리에는 "인증 코드를
                        // 보냈어요"(안내)와 "비밀번호가 달라요"(오류)가 함께 온다 —
                        // 전부 error 색으로 칠하면 코드를 잘 받은 사용자가 뭔가
                        // 잘못된 줄 안다(안드로이드는 AuthErrorText/AuthNoticeText 로 나눈다).
                        Text(message)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(auth.statusIsError ? AuthSceneColors.error : AuthSceneColors.notice)
                            .padding(.top, 4)
                    }

                    modeSwitchRow
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
            }
            // ⚠ **입력창 밖을 눌러 키보드를 닫을 길을 둔다.** iOS 는 바깥 탭으로 키보드가
            // 자동으로 닫히지 않아서, 없으면 키보드가 화면 절반을 가린 채 버튼에 닿지 못한다
            // (2026-08-10 사용자 보고 — 편집기에는 이미 있었고 나머지 화면만 빠져 있었다).
            .scrollDismissesKeyboard(.interactively)
            }
        }
        // 제목은 화면 **안**에 있다(위 Text) — 네비게이션 바에 또 그리면 같은 말이 두 번 나온다.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        // 위에서 직접 그리므로 시스템 것은 숨긴다(둘 다 뜨면 화살표가 두 개가 된다).
        .navigationBarBackButtonHidden(true)
        .navigationDestination(isPresented: $showPasswordReset) {
            PasswordResetView()
        }
        // 고쳐 치기 시작하면 지운다 — 안드로이드의 `onClearLoginError`(입력창 onValueChange)와
        // 같은 시점이다. 남겨 두면 이미 고친 값 아래에 옛 경고가 붙어 있다.
        .onChange(of: password) { _, _ in auth.loginError = nil }
        .onChange(of: email) { _, _ in auth.loginError = nil }
        // 로그인↔가입을 오갈 때도 지운다(안드로이드는 `authRoute` 가 바뀔 때 지운다) —
        // 가입 화면에서는 이 자리에 비밀번호 규칙이 온다.
        .onChange(of: mode) { _, _ in auth.loginError = nil }
    }

    // MARK: - Sections

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 0) {
        VocaTextField(
            title: "이름",
            text: $name,
            keyboardType: .default,
            submitLabel: .next,
            enabled: !auth.isBusy
        )
        .onChange(of: name) { _, newValue in
            // 규칙은 InputSanitizer 한 곳에서만(제어·제로폭·양방향 문자 제거, 줄바꿈→공백).
            let sanitized = InputSanitizer.sanitizeDisplayName(newValue)
            let cleaned = InputSanitizer.clampDisplayName(newValue)
            // ⚠ **말없이 자르지 말 것**(CLAUDE.md). 상한에서 입력은 막되, 넘겨 치는
            // 순간 이유를 띄운다. 안 그러면 사용자는 글자가 왜 안 들어가는지 모른 채
            // 갇힌다. 안드로이드 `AuthScreen` 의 `nameTooLong` 과 같은 규칙이다.
            //
            // ⚠ **상한과 정확히 같을 때는 플래그를 건드리지 않는다.** 잘라서 돌려준
            // 값을 IME 가 그대로 되돌려 보내므로, 여기서 끄면 경고가 곧바로 사라진다.
            if sanitized.count > InputSanitizer.displayNameMaxLength {
                nameTooLong = true
            } else if sanitized.count < InputSanitizer.displayNameMaxLength {
                nameTooLong = false
            }
            if cleaned != newValue { name = cleaned }
        }
        if nameTooLong {
            Text("닉네임은 \(InputSanitizer.displayNameMaxLength)자 이내로 써 주세요")
                .font(theme.typography.bodySmall)
                .foregroundStyle(AuthSceneColors.error)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
        }
        }
    }

    private var emailField: some View {
        VocaTextField(
            title: "이메일",
            text: $email,
            keyboardType: .emailAddress,
            submitLabel: .next,
            enabled: !auth.isBusy
        )
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .onChange(of: email) { _, _ in
            // 이메일이 바뀌면 인증 상태를 초기화.
            verificationSent = false
            verificationCompleted = false
            verificationCode = ""
            verifiedEmail = ""
        }
    }

    private var verifyEmailRow: some View {
        AuthOutlinedButton(
            title: verificationLabel,
            enabled: !auth.isBusy && emailLooksValid && !isEmailVerifiedForCurrentInput
        ) {
            Task {
                // 발송이 성공했을 때만 코드 입력 단계를 노출한다. 중복 이메일(AUTH_EMAIL_TAKEN)
                // 등으로 발송이 실패하면 verificationSent 가 켜지지 않아 6자리 코드 입력칸이
                // 뜨지 않는다. Android 는 codeSentForEmail 을 발송 성공 시에만 세팅한다.
                verificationSent = await auth.requestEmailVerification(email: normalizedEmail)
            }
        }
    }

    // 반환형이 `LocalizedStringKey` 여야 세 리터럴이 카탈로그 키로 잡힌다.
    // `String` 이면 버튼이 `Text(변수)` 로 그려져 en/ja 기기에서 한국어가 그대로 뜬다.
    private var verificationLabel: LocalizedStringKey {
        if isEmailVerifiedForCurrentInput { return "이메일 인증 완료" }
        if verificationSent { return "인증 코드 다시 받기" }
        return "이메일 인증"
    }

    private var verificationCodeRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                VocaTextField(
                    title: "인증 코드",
                    text: $verificationCode,
                    keyboardType: .numberPad,
                    submitLabel: .next,
                    enabled: !auth.isBusy
                )
                .onChange(of: verificationCode) { _, newValue in
                    let digits = newValue.filter(\.isNumber)
                    verificationCode = String(digits.prefix(6))
                }

                Button {
                    Task {
                        let success = await auth.verifyEmailCode(
                            email: normalizedEmail,
                            code: verificationCode
                        )
                        if success {
                            verificationCompleted = true
                            verifiedEmail = normalizedEmail
                        }
                    }
                } label: {
                    Text("확인")
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(confirmCodeEnabled ? AuthSceneColors.text : Color.white.opacity(0x59 / 255.0))
                        .padding(.vertical, 16)
                        .padding(.horizontal, 18)
                        // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                        .stroke(confirmCodeEnabled ? AuthSceneColors.line : AuthSceneColors.lineSoft, lineWidth: 1)
                )
                .disabled(!confirmCodeEnabled)
            }

            Text("메일로 받은 6자리 코드를 입력해 주세요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(AuthSceneColors.textDim)
        }
    }

    private var confirmCodeEnabled: Bool { !auth.isBusy && verificationCode.count == 6 }

    /// 로그인 실패는 **여기**, 비밀번호 입력창 바로 아래에 붙는다.
    ///
    /// ⚠ 하단 `statusMessage` 로 보내지 말 것 — 그 자리는 제출 버튼·비밀번호 찾기·애플
    /// 로그인 행을 다 지나서야 나와서, 틀린 사람이 **틀린 줄도 모른다**(2026-08-19 실기기
    /// 보고). 안드로이드는 `OutlinedTextField.supportingText` 로 처음부터 여기 붙였다
    /// (`ui/auth/AuthScreen.kt`). 테두리도 함께 빨개진다(`isError`).
    private var passwordField: some View {
        VStack(alignment: .leading, spacing: 6) {
            VocaSecureField(
                title: "비밀번호",
                text: $password,
                isVisible: $isPasswordVisible,
                enabled: !auth.isBusy,
                isError: showsLoginError
            )
            if showsLoginError, let message = auth.loginError {
                Text(message)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(AuthSceneColors.error)
            }
        }
    }

    /// 회원가입 모드에서는 이 자리에 비밀번호 **규칙**이 오므로 로그인 오류를 그리지 않는다
    /// (안드로이드도 `mode == AuthMode.Login` 일 때만 붙인다).
    private var showsLoginError: Bool {
        mode == .login && auth.loginError != nil
    }

    private var passwordRules: some View {
        VStack(alignment: .leading, spacing: 6) {
            RuleRow(text: "8자 이상", satisfied: passwordAtLeastMin)
            RuleRow(text: "영문·숫자 포함", satisfied: passwordHasLetterAndDigit)
            RuleRow(text: "비밀번호 확인 일치", satisfied: passwordMatches)
        }
    }

    private var confirmPasswordField: some View {
        VStack(alignment: .leading, spacing: 4) {
            VocaSecureField(
                title: "비밀번호 확인",
                text: $confirmPassword,
                isVisible: $isConfirmPasswordVisible,
                enabled: !auth.isBusy,
                isError: !confirmPassword.isEmpty && !passwordMatches
            )
            if !confirmPassword.isEmpty && !passwordMatches {
                Text("비밀번호가 일치하지 않아요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
            }
        }
    }

    private var submitButton: some View {
        GradientCta(
            title: mode == .login ? "로그인" : "계정 만들기",
            enabled: canSubmit,
            loading: auth.isBusy
        ) {
            Task {
                if mode == .login {
                    await auth.loginWithEmail(email: normalizedEmail, password: password)
                } else {
                    await auth.registerWithEmail(
                        email: normalizedEmail,
                        password: password,
                        name: name,
                        verificationCode: verificationCode
                    )
                }
            }
        }
        .padding(.top, 4)
    }

    /// 로그인 ↔ 회원가입 전환 — 안드로이드 `AuthScreen.kt:533-553` 의 하단 행.
    private var modeSwitchRow: some View {
        HStack(spacing: 2) {
            Spacer(minLength: 0)
            Text(mode == .login ? "처음 사용하시나요?" : "이미 계정이 있나요?")
                .font(theme.typography.bodyMedium)
                .foregroundStyle(AuthSceneColors.textMuted)
            Button(mode == .login ? "회원가입" : "로그인") {
                handleModeChange(mode == .login ? .register : .login)
            }
            .font(theme.typography.bodyMedium)
            .tint(AuthSceneColors.accent)
            .disabled(auth.isBusy)
            Spacer(minLength: 0)
        }
        .padding(.top, 6)
    }

    /// 비밀번호 찾기 진입 — 로그인 모드에서만 노출. Android `AuthScreen.kt:314-328`.
    private var findPasswordRow: some View {
        HStack(spacing: 4) {
            Text("비밀번호를 잊으셨나요?")
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
            Button {
                showPasswordReset = true
            } label: {
                Text("비밀번호 찾기")
                    .font(theme.typography.labelLarge)
                    .foregroundStyle(theme.palette.primary)
            }
            .buttonStyle(.plain)
            .disabled(auth.isBusy)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private var appleSignInRow: some View {
        VStack(spacing: 8) {
            HStack {
                Rectangle().fill(theme.palette.outlineVariant).frame(height: 1)
                Text("간편 로그인")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Rectangle().fill(theme.palette.outlineVariant).frame(height: 1)
            }
            .padding(.top, 6)

            SignInWithAppleButton(.signIn) { request in
                let raw = NonceGenerator.makeNonce()
                pendingRawNonce = raw
                request.requestedScopes = [.fullName, .email]
                request.nonce = NonceGenerator.sha256(raw)
            } onCompletion: { result in
                let raw = pendingRawNonce
                pendingRawNonce = nil
                switch result {
                case .success(let authorization):
                    Task { await auth.handleAppleAuthorization(authorization, rawNonce: raw) }
                case .failure(let error):
                    Task { @MainActor in auth.handleAppleAuthorizationFailure(error) }
                }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 52)
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
            .disabled(auth.isBusy)
        }
    }

    private func handleModeChange(_ next: LoginMode) {
        // ⚠ **이 대입을 빼지 말 것.** 예전에는 아래 리셋만 하고 `mode` 를 바꾸지 않아서,
        // '회원가입' 을 눌러도 화면이 로그인 그대로였다. 랜딩의 '시작하기' 는 `.login`
        // 으로만 들어오고 `.register` 진입은 DEBUG 프리뷰 플래그뿐이라, **이메일로 계정을
        // 만들 방법이 앱에 하나도 없었다**(애플 로그인만 가능했다).
        mode = next
        // 모드 전환 시 인증/오류 메시지를 살짝 리셋해 혼동을 줄인다.
        if next == .login {
            verificationSent = false
            verificationCompleted = false
            verificationCode = ""
        }
    }
}

// MARK: - Mode

/// 로그인/회원가입 두 모드. `LandingView` 에서 `LoginView(initialMode:)` 로 넘기고,
/// 화면 내부 segmented control 로 전환할 수 있다.
enum LoginMode: Hashable, Identifiable {
    case login
    case register

    var id: Self { self }
}

// MARK: - Inputs

struct VocaTextField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    // 라벨은 `LocalizedStringKey` — `String` 이면 번역이 죽는다(`GradientCta.title` 주석).
    let title: LocalizedStringKey
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var submitLabel: SubmitLabel = .next
    var enabled: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(theme.typography.labelMedium)
                .foregroundStyle(AuthSceneColors.textMuted)
            TextField("", text: $text)
                .keyboardType(keyboardType)
                .submitLabel(submitLabel)
                .disabled(!enabled)
                .foregroundStyle(AuthSceneColors.text)
                .tint(AuthSceneColors.accent)
                .padding(.vertical, 12)
                .padding(.horizontal, 14)
                // ⚠ 인증 화면은 고정 다크라 테마 `outline` 만 두면 남색 배경에서 테두리가
                // 거의 안 보이고 입력칸이 어디부터인지 모른다. 안드로이드는 글라스 채움
                // (`AuthFieldGlass`) + `AuthLine` 테두리다(`AuthScreen.kt:61-64`).
                .background(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                        .fill(AuthSceneColors.fieldGlass)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                        .stroke(AuthSceneColors.line, lineWidth: 1)
                )
        }
    }
}

struct VocaSecureField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    // 라벨은 `LocalizedStringKey` — `String` 이면 번역이 죽는다(`GradientCta.title` 주석).
    let title: LocalizedStringKey
    @Binding var text: String
    @Binding var isVisible: Bool
    var enabled: Bool = true
    var isError: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(theme.typography.labelMedium)
                .foregroundStyle(AuthSceneColors.textMuted)
            HStack(spacing: 8) {
                Group {
                    if isVisible {
                        TextField("", text: $text)
                    } else {
                        SecureField("", text: $text)
                    }
                }
                .disabled(!enabled)
                .foregroundStyle(AuthSceneColors.text)
                .tint(AuthSceneColors.accent)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

                Button {
                    isVisible.toggle()
                } label: {
                    Image(systemName: isVisible ? "eye.slash" : "eye")
                        .foregroundStyle(AuthSceneColors.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isVisible ? "비밀번호 숨기기" : "비밀번호 보기")
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .background(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .fill(AuthSceneColors.fieldGlass)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(isError ? AuthSceneColors.error : AuthSceneColors.line, lineWidth: 1)
            )
        }
    }
}

private struct RuleRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let text: LocalizedStringKey
    let satisfied: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: satisfied ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(satisfied ? theme.palette.primary : theme.palette.onSurfaceVariant)
            Text(text)
                .font(theme.typography.bodySmall)
                .foregroundStyle(satisfied ? theme.palette.primary : theme.palette.onSurfaceVariant)
        }
    }
}

// MARK: - Validation helpers

/// 본 화면이 직접 사용하는 작은 검증 helper. 테스트에서 재사용한다.
enum LoginValidator {
    /// Android `Patterns.EMAIL_ADDRESS` 와 호환되는 단순 검증. RFC 822 풀 검증
    /// 대신 일반적인 이메일 모양 (`local@domain.tld`) 만 확인한다.
    static func isValidEmail(_ value: String) -> Bool {
        // RFC 5322 의 매우 완화된 ASCII 형태. 클라이언트 측 1차 검증이며,
        // 최종은 서버가 RFC 검증을 다시 한다.
        let pattern = #"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$"#
        return value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// 비밀번호 길이 정책. 본 함수는 LoginViewModelTests 가 사용한다.
    static func isValidPasswordLength(_ value: String) -> Bool {
        (8...128).contains(value.count)
    }

    /// 인증코드 = 정확히 6자리 숫자.
    static func isValidVerificationCode(_ value: String) -> Bool {
        value.count == 6 && value.allSatisfy(\.isNumber)
    }
}

#if DEBUG
#Preview("LoginView login (light)") {
    NavigationStack {
        LoginView(initialMode: .login)
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("LoginView register (dark)") {
    NavigationStack {
        LoginView(initialMode: .register)
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
