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
    /// 로그인 제출을 눌렀는데 이메일이 형식에 안 맞았는가 — **누른 뒤에만** 뜬다.
    /// 치는 도중에 빨갛게 만들면 아직 다 치지도 않은 주소를 틀렸다고 하는 셈이다.
    /// 안드로이드 `ui/auth/AuthScreen.kt` 의 `emailFormatError` 와 같은 규칙이다.
    @State private var emailFormatError = false
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

    /// 형식 규칙의 단일 출처는 `AuthEmailFormat` — 서버 `@alarmtalk/shared` 의
    /// `EMAIL_PATTERN` 과 같은 값이다. 예전의 자체 정규식은 서버보다 좁아서
    /// (아포스트로피 거부) 정당한 주소를 가진 사람의 로그인을 막았다.
    private var normalizedEmail: String {
        AuthEmailFormat.normalize(email)
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
            // ⚠ **형식으로 버튼을 죽이지 않는다** — 누를 수 있게 두고, 누르면
            // `AuthEmailFormat.submitOutcome` 이 이유를 말한다.
            return AuthEmailFormat.canSubmitLogin(email: email, password: password)
        }
        // ⚠ **형식으로 버튼을 죽이지 않는다 — 가입 모드도 마찬가지**(2026-09-21 리뷰).
        // 예전에는 여기에만 `emailLooksValid` 가 남아, 로그인은 눌러서 이유를 듣는데
        // 가입은 같은 주소로 버튼이 죽어 있었다. 잠그는 것은 **보낼 것이 없을 때**뿐이다.
        return !name.isEmpty &&
            AuthEmailFormat.canRequestEmailCode(email) &&
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
        .onChange(of: password) { _, _ in auth.clearLoginError() }
        .onChange(of: email) { _, _ in auth.clearLoginError() }
        // 로그인↔가입을 오갈 때도 지운다(안드로이드는 `authRoute` 가 바뀔 때 지운다) —
        // 가입 화면에서는 이 자리에 비밀번호 규칙이 온다.
        .onChange(of: mode) { _, _ in auth.clearLoginError() }
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

    /// 형식 오류는 **이메일 칸 아래**에 붙는다. 나머지 로그인 실패(`auth.loginError`)는
    /// 비밀번호 칸 아래지만, 이건 이메일을 고쳐야 하는 일이라 고칠 칸 옆에 있어야 한다.
    /// 앱이 잡은 것이든 서버가 잡은 것이든(`AUTH_EMAIL_INVALID`) 자리는 하나다.
    /// 안드로이드도 같은 자리다(`ui/auth/AuthScreen.kt` 의 이메일 `supportingText`).
    private var emailField: some View {
        VStack(alignment: .leading, spacing: 6) {
            VocaTextField(
                title: "이메일",
                text: $email,
                keyboardType: .emailAddress,
                submitLabel: .next,
                enabled: !auth.isBusy,
                isError: showsEmailFormatError
            )
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onChange(of: email) { _, _ in
                // 고쳐 치기 시작하면 형식 경고를 지운다(안드로이드의 `onValueChange` 와 같은 시점).
                emailFormatError = false
                // ⚠ **서버가 준 같은 경고도 함께 지운다.** 이 칸 아래에 떠 있는 말인데
                // 고쳐 쳐도 안 사라지면, 사용자는 방금 고친 주소가 또 틀렸다고 읽는다.
                // 지우는 것은 **이 칸이 맡은 갈래 하나**다 — 자격증명 실패는 비밀번호
                // 칸의 말이라 건드리지 않는다(안드로이드는 `onClearLoginError`).
                if loginErrorIsEmailFormat { auth.clearLoginError() }
                // 이메일이 바뀌면 인증 상태를 초기화.
                verificationSent = false
                verificationCompleted = false
                verificationCode = ""
                verifiedEmail = ""
            }
            if showsEmailFormatError {
                Text(APIErrorMessages.emailInvalid)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(AuthSceneColors.error)
            }
        }
    }

    /// ⚠ **앱이 잡은 것과 서버가 잡은 것이 같은 자리에 뜬다.** 판정은 같은데 앱 갈래는
    /// 이메일 칸, 서버 갈래는 비밀번호 칸이면 사용자는 같은 말을 두 자리에서 보게 되고,
    /// 비밀번호 쪽에 뜬 회차에는 비밀번호부터 다시 친다.
    ///
    /// ⚠ **가입 모드에도 붙는다.** `emailFormatError` 는 '이메일 인증' 을 누른 회차에도
    /// 켜지므로, 로그인에서만 그리면 가입 쪽은 눌러도 아무 말이 없다. 서버 갈래
    /// (`loginErrorIsEmailFormat`)는 로그인 응답이라 로그인 모드에서만 온다.
    private var showsEmailFormatError: Bool {
        emailFormatError || loginErrorIsEmailFormat
    }

    /// 서버가 이메일 형식을 지적한 것(`AUTH_EMAIL_INVALID`)인가.
    ///
    /// ⚠ **문구를 비교하지 말 것**(2026-09-21 리뷰). 예전에는
    /// `auth.loginError == APIErrorMessages.emailInvalid` 였다 — 문구를 한 글자 고치거나
    /// 다른 코드가 같은 문장을 쓰게 되는 순간 **아무 경고 없이** 갈래가 어긋나고,
    /// 형식 오류가 비밀번호 칸 아래로 내려간다. 판정은 코드 하나다. 안드로이드도 같다
    /// (`ui/auth/AuthScreen.kt` 의 `loginErrorIsEmailFormat`).
    private var loginErrorIsEmailFormat: Bool {
        mode == .login && AuthEmailFormat.isEmailFormatErrorCode(auth.loginErrorCode)
    }

    /// ⚠ **형식으로 죽이지 않는다** — 가입에서 실질적인 제출 버튼이 이것이다.
    /// 예전에는 `emailLooksValid` 로 잠가 놔서, 주소를 잘못 친 사람은 눌리지 않는
    /// '이메일 인증' 앞에서 **무엇이 잘못됐는지 들을 길이 없었다.**
    private var verifyEmailRow: some View {
        AuthOutlinedButton(
            title: verificationLabel,
            enabled: !auth.isBusy
                && AuthEmailFormat.canRequestEmailCode(email)
                && !isEmailVerifiedForCurrentInput
        ) {
            guard AuthEmailFormat.submitOutcome(email: email) == .submit else {
                emailFormatError = true
                return
            }
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
            // ⚠ **아래로 정렬한다**(2026-09-17 실기기). 입력칸은 라벨('인증 코드')이 위에 붙은
            // 세로 묶음이라 중앙 정렬이면 버튼이 라벨까지 포함한 높이의 가운데로 올라가
            // **입력칸과 한 줄로 안 맞는다.** 높이도 입력칸과 같은 값(`AuthFieldHeight`)으로
            // 고정해 두 상자의 위·아래가 맞물리게 한다.
            HStack(alignment: .bottom, spacing: 8) {
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
                        .frame(height: AuthFieldHeight)
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
    ///
    /// 이메일 형식 갈래는 **위 이메일 칸**이 맡는다 — 같은 문구를 두 자리에 띄우지 않는다.
    private var showsLoginError: Bool {
        mode == .login && auth.loginError != nil && !loginErrorIsEmailFormat
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
            // ⚠ **버튼을 죽이지 않는다**(CLAUDE.md) — 누를 수는 있고, 누르면 왜 안 되는지
            // 말한다. 이메일 형식은 서버에 물어볼 것도 없는 실패라 네트워크를 타기 전에
            // 여기서 끊는다(서버 판정과 같은 갈래 = `AUTH_EMAIL_INVALID`).
            // 판정은 **두 모드가 같은 함수**를 쓴다 — 안드로이드 `authEmailSubmitOutcome` 과 짝이다.
            guard AuthEmailFormat.submitOutcome(email: email) == .submit else {
                emailFormatError = true
                return
            }
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
        // ⚠ **형식 경고는 모드가 바뀌면 지운다.** `email` 상태는 로그인↔가입을 오가도
        // 그대로라, 안 지우면 로그인에서 띄운 경고가 가입에 다녀온 뒤에도 **아무것도
        // 안 했는데** 살아 있다. 안드로이드 `ui/auth/AuthScreen.kt` 의
        // `LaunchedEffect(mode)` 와 같은 자리다.
        emailFormatError = false
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

/// 인증 화면 입력칸 한 줄의 높이. **옆에 붙는 버튼이 같은 값을 쓴다** — 따로 두면
/// 글꼴 크기 설정에 따라 둘이 어긋난다(2026-09-17).
let AuthFieldHeight: CGFloat = 46

struct VocaTextField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    // 라벨은 `LocalizedStringKey` — `String` 이면 번역이 죽는다(`GradientCta.title` 주석).
    let title: LocalizedStringKey
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var submitLabel: SubmitLabel = .next
    var enabled: Bool = true
    // 테두리를 빨갛게 — `VocaSecureField` 와 같은 규칙이다. 안드로이드는
    // `OutlinedTextField.isError` 가 같은 일을 한다(`ui/auth/AuthScreen.kt`).
    var isError: Bool = false

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
                .frame(height: AuthFieldHeight)
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
                        .stroke(isError ? AuthSceneColors.error : AuthSceneColors.line, lineWidth: 1)
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
    /// ⚠ **자체 정규식을 여기 다시 박지 말 것.** 형식 규칙의 단일 출처는
    /// `AuthEmailFormat` 이고, 그 값은 서버 `@alarmtalk/shared` 의 `EMAIL_PATTERN`·
    /// 안드로이드 `AuthEmailPattern` 과 **같은 문자열**이다.
    ///
    /// 예전에는 여기 `^[A-Z0-9._%+-]+@…` 가 박혀 있었다. 서버보다 좁아
    /// **아포스트로피를 거부**했고(`o'brien@example.com` 으로 가입한 사람은 로그인
    /// 자체가 불가능했다), 동시에 서버가 거부하는 `%` 는 통과시켰다.
    ///
    /// 화면들은 이제 `AuthEmailFormat` 을 직접 부른다 — 이 입구는 테스트가 "갈라지지
    /// 않았다" 를 확인하는 자리로만 남는다.
    static func isValidEmail(_ value: String) -> Bool {
        AuthEmailFormat.isValid(value)
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
