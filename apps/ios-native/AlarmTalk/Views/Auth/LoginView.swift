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
    @State private var verificationSent: Bool = false
    @State private var verificationCompleted: Bool = false
    @State private var verifiedEmail: String = ""

    @State private var isPasswordVisible = false
    @State private var isConfirmPasswordVisible = false

    @State private var pendingRawNonce: String?
    @State private var showPasswordReset = false

    /// `AuthViewModel.requestEmailVerification` 가 발송 성공 시 세팅하는 statusMessage.
    /// 발송 성공 여부를 view 에서 알 길이 이 메시지뿐이라(메서드가 결과를 반환하지 않음)
    /// 동일 문구로 성공을 판별한다. VM 문구가 바뀌면 함께 맞춰야 한다.
    private static let verificationCodeSentMessage = "인증 코드를 보냈어요. 메일을 확인해 주세요."

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
        ZStack {
            theme.palette.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ModePicker(mode: $mode, onChange: handleModeChange)
                        .padding(.top, 6)

                    // Android `AuthScreen.kt:111` 과 동일한 문구.
                    Text(mode == .login
                         ? "좋아하는 목소리 알람을 다시 불러올게요."
                         : "목소리 알람을 만들 계정을 준비해요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)

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
                        Text(message)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.error)
                            .padding(.top, 4)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
            }
        }
        .navigationTitle(mode == .login ? "로그인" : "회원가입")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.backward")
                }
                .accessibilityLabel("뒤로")
            }
        }
        .navigationDestination(isPresented: $showPasswordReset) {
            PasswordResetView()
        }
    }

    // MARK: - Sections

    private var nameField: some View {
        VocaTextField(
            title: "이름",
            text: $name,
            keyboardType: .default,
            submitLabel: .next,
            enabled: !auth.isBusy
        )
        .onChange(of: name) { _, newValue in
            // 규칙은 InputSanitizer 한 곳에서만(제어·제로폭·양방향 문자 제거, 줄바꿈→공백).
            let cleaned = InputSanitizer.clampDisplayName(newValue)
            if cleaned != newValue { name = cleaned }
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
        Button {
            Task {
                await auth.requestEmailVerification(email: normalizedEmail)
                // 발송이 성공했을 때만 코드 입력 단계를 노출한다. 중복 이메일(AUTH_EMAIL_TAKEN)
                // 등으로 발송이 실패하면 verificationSent 가 켜지지 않아 6자리 코드 입력칸이
                // 뜨지 않는다. Android 는 codeSentForEmail 을 발송 성공 시에만 세팅한다.
                verificationSent = (auth.statusMessage == Self.verificationCodeSentMessage)
            }
        } label: {
            Text(verificationLabel)
                .font(theme.typography.labelLarge)
                .frame(maxWidth: .infinity, minHeight: 54)
        }
        .buttonStyle(.bordered)
        .disabled(auth.isBusy || !emailLooksValid || isEmailVerifiedForCurrentInput)
    }

    private var verificationLabel: String {
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
                        .padding(.vertical, 16)
                        .padding(.horizontal, 18)
                }
                .buttonStyle(.bordered)
                .disabled(auth.isBusy || verificationCode.count != 6)
            }

            Text("메일로 받은 6자리 코드를 입력해 주세요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
        }
    }

    private var passwordField: some View {
        VocaSecureField(
            title: "비밀번호",
            text: $password,
            isVisible: $isPasswordVisible,
            enabled: !auth.isBusy
        )
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
        Button {
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
        } label: {
            Text(auth.isBusy ? "처리 중" : (mode == .login ? "로그인" : "계정 만들기"))
                .font(theme.typography.labelLarge)
                .frame(maxWidth: .infinity, minHeight: 54)
        }
        .buttonStyle(.borderedProminent)
        .tint(theme.palette.primary)
        .foregroundStyle(theme.palette.onPrimary)
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
        .disabled(!canSubmit)
        .padding(.top, 4)
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

private struct ModePicker: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var mode: LoginMode
    let onChange: (LoginMode) -> Void

    var body: some View {
        Picker(selection: Binding(
            get: { mode },
            set: { new in
                mode = new
                onChange(new)
            }
        ), label: Text("모드")) {
            Text("로그인").tag(LoginMode.login)
            Text("회원가입").tag(LoginMode.register)
        }
        .pickerStyle(.segmented)
    }
}

// MARK: - Inputs

struct VocaTextField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var submitLabel: SubmitLabel = .next
    var enabled: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(theme.typography.labelMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
            TextField("", text: $text)
                .keyboardType(keyboardType)
                .submitLabel(submitLabel)
                .disabled(!enabled)
                .padding(.vertical, 12)
                .padding(.horizontal, 14)
                .background(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                        .stroke(theme.palette.outline, lineWidth: 1)
                )
        }
    }
}

struct VocaSecureField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String
    @Binding var text: String
    @Binding var isVisible: Bool
    var enabled: Bool = true
    var isError: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(theme.typography.labelMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
            HStack(spacing: 8) {
                Group {
                    if isVisible {
                        TextField("", text: $text)
                    } else {
                        SecureField("", text: $text)
                    }
                }
                .disabled(!enabled)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

                Button {
                    isVisible.toggle()
                } label: {
                    Image(systemName: isVisible ? "eye.slash" : "eye")
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isVisible ? "비밀번호 숨기기" : "비밀번호 보기")
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .background(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(isError ? theme.palette.error : theme.palette.outline, lineWidth: 1)
            )
        }
    }
}

private struct RuleRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let text: String
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
