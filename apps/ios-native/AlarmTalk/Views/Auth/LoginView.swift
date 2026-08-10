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
        AuthBackdrop {

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // ⚠ **시스템 뒤로가기를 쓰지 않는다 — 두 앱이 달라진다.**
                    // 시스템 버튼은 OS 버전이 정하는 모양(iOS 26 은 유리 원형)이라
                    // 안드로이드에서 같은 것을 만들 수 없다. 두 앱을 같게 두려고 **양쪽 다
                    // 같은 스펙의 원형 버튼을 직접 그린다**(채움 12% 흰색, 테두리 1px
                    // 액센트 36%, 지름 44). 안드로이드 대응: `ui/auth/AuthScreen.kt` 의
                    // `AuthBackCircleFill`·`AuthBackCircleStroke`.
                    AuthCircleBackButton { dismiss() }

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
                await auth.requestEmailVerification(email: normalizedEmail)
                // 발송이 성공했을 때만 코드 입력 단계를 노출한다. 중복 이메일(AUTH_EMAIL_TAKEN)
                // 등으로 발송이 실패하면 verificationSent 가 켜지지 않아 6자리 코드 입력칸이
                // 뜨지 않는다. Android 는 codeSentForEmail 을 발송 성공 시에만 세팅한다.
                verificationSent = (auth.statusMessage == Self.verificationCodeSentMessage)
            }
        }
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
                        .foregroundStyle(confirmCodeEnabled ? AuthSceneColors.text : Color.white.opacity(0x59 / 255.0))
                        .padding(.vertical, 16)
                        .padding(.horizontal, 18)
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
    let title: String
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
    let title: String
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


/// 원형 뒤로가기 — **안드로이드와 같은 스펙**을 직접 그린다.
///
/// ⚠ 시스템 뒤로가기(`NavigationStack` 기본)를 쓰면 모양을 OS 가 정해서
/// 안드로이드에서 같은 것을 만들 수 없다. 두 앱을 나란히 놓았을 때 화살표만 다른 게
/// 눈에 띄어(2026-08-10) 양쪽 다 같은 값으로 고정했다.
/// 안드로이드 대응: `ui/auth/AuthScreen.kt` 의 뒤로가기 `IconButton`.
struct AuthCircleBackButton: View {
    var action: () -> Void

    /// 안드로이드 `AuthBackCircleFill` = `Color(0x1FFFFFFF)`.
    private static let fill = Color.white.opacity(0x1F / 255.0)
    /// 안드로이드 `AuthBackCircleStroke` = `Color(0x5CA6D2FF)` — 액센트 36%.
    private static let stroke = Color.hex(0xA6D2FF).opacity(0x5C / 255.0)

    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.backward")
                // Material `KeyboardArrowLeft` 의 두께에 맞춘 값 — SF 기본은 더 가늘다.
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(AuthSceneColors.text)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Self.fill))
                .overlay(Circle().stroke(Self.stroke, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("뒤로")
    }
}
