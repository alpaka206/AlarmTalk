import AuthenticationServices
import SwiftUI
import UIKit

/// 이메일 로그인/회원가입 화면 — `LandingView` → `AuthMethodsView`('이메일로 계속하기') → 여기.
///
/// Android `apps/android-native/.../ui/auth/AuthScreen.kt` 의 `AuthScreen`(2-mode UI)과 같은 화면이다.
///
/// Mode
///   - `.login` : 이메일 + 비밀번호 두 칸, **칸 안 안내 글자만**(위 이름표 없음). 아래 한 줄이 `비밀번호 찾기 | 회원가입`.
///   - `.register` : 이메일 + 인증코드(6자리) + 비밀번호 + 비밀번호 확인, 칸이 많아 이름표를 칸 위에 둔다.
///     `인증 받기` 를 눌러 코드를 발송하고, 6자리 입력 후 `확인` 으로 검증한다. 검증이 끝나기 전에는 제출 불가.
///
/// 간편 로그인(카카오·Apple)은 이 화면에 없다 — 앞 화면 `AuthMethodsView` 에서 고른다(2026-11-22 오너). 예전에는 두 모드
/// 모두 맨 위에 두고 그 아래 이메일 칸을 펼쳤다(2026-11-14).
struct LoginView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let initialMode: LoginMode

    @State private var mode: LoginMode
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var confirmPassword: String = ""
    @State private var verificationCode: String = ""
    /// 로그인 제출을 눌렀는데 이메일이 형식에 안 맞았는가 — **누른 뒤에만** 뜬다.
    /// 치는 도중에 빨갛게 만들면 아직 다 치지도 않은 주소를 틀렸다고 하는 셈이다.
    /// 안드로이드 `ui/auth/AuthScreen.kt` 의 `emailFormatError` 와 같은 규칙이다.
    @State private var emailFormatError = false
    @State private var verificationSent: Bool = false
    @State private var verificationCompleted: Bool = false
    @State private var verifiedEmail: String = ""

    @State private var isPasswordVisible = false
    @State private var isConfirmPasswordVisible = false

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

    // 규칙은 `PasswordPolicy` 한 벌이다. 화면은 체크리스트를 그리려고 조각으로 나눠 본다.
    private var passwordAtLeastMin: Bool { password.count >= PasswordPolicy.lengthRange.lowerBound }
    private var passwordUnderMax: Bool { password.count <= PasswordPolicy.lengthRange.upperBound }
    private var passwordLengthValid: Bool { passwordAtLeastMin && passwordUnderMax }
    private var passwordHasLetter: Bool { PasswordPolicy.hasLetter(password) }
    private var passwordHasDigit: Bool { PasswordPolicy.hasDigit(password) }
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
        return AuthEmailFormat.canRequestEmailCode(email) &&
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
            //
            // 제목은 다른 하위 화면처럼 **위쪽 가운데**, 뒤로가기와 한 줄이다(2026-11-09 오너). 예전에는 뒤로가기만 위에 두고
            // 제목을 폼 첫 줄에 크게 세웠다. 안드로이드 짝 `AuthScreen` 의 `AuthTopBar`.
            WakerTopBar(
                title: mode == .login ? "로그인" : "회원가입",
                onBack: { dismiss() },
                tint: AuthSceneColors.text
            )
            .padding(.top, 18)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // 로그인↔가입은 세그먼트 피커가 아니라 **맨 아래 전환 행**에서 고른다(안드로이드와 같다). 피커를 위에 두면
                    // 아직 계정이 있는지도 모르는 사람에게 먼저 답을 강요하게 된다.
                    // 가입에서 이미 가입된 이메일이라 로그인으로 넘어온 경우 — 왜 화면이 바뀌었는지 여기서 말한다
                    // (안드로이드 `ui/auth/AuthScreen.kt` 의 `authNotice` 자리).
                    if mode == .login, let notice = auth.authNotice {
                        Text(notice)
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(AuthSceneColors.accent)
                    }

                    // 간편 로그인(카카오·Apple)은 앞 화면(`AuthMethodsView`)에 있다 — 여기는 '이메일로 계속하기' 를 고른 사람의
                    // 화면이다(2026-11-22 오너). 안드로이드 짝 `AuthScreen`.
                    emailField

                    if mode == .register {
                        if verificationSent && !verificationCompleted {
                            // 실패 문장은 이 줄이 직접 그린다(안내 문구의 자리).
                            verificationCodeRow
                        } else {
                            // 코드 줄이 없을 때의 실패 문장은 이메일 줄 바로 아래다(안드로이드 `registerError` 와 같은
                            // 자리). 인증을 마쳤으면 코드와 무관한 가입 실패(네트워크 등)가, 아직 코드를 못 받았으면 첫
                            // 요청의 실패가 뜬다. 코드가 거절된 가입은 '인증됨' 이 내려가 위 갈래(코드 줄)로 간다.
                            // 인증을 마친 것은 이메일 칸 옆 버튼('✓ 인증됨')이 말한다 — '이메일 인증 완료' 줄을 또 두지 않는다.
                            emailCodeErrorText
                        }
                    }

                    passwordField

                    // 비밀번호 → 비밀번호 확인 → 규칙 세 줄(안드로이드 `AuthScreen` 과 같은 순서 — 2026-11-16 에 맞췄다).
                    if mode == .register {
                        confirmPasswordField
                        passwordRules
                    }

                    submitButton

                    // 안내(`statusMessage` — "인증 코드를 보냈어요" 등)는 폼 맨 아래 글줄이 아니라 **위쪽
                    // 토스트**다(아래 `.authToast` — 2026-11-15 오너). 맨 아래면 키보드 뒤에 숨는다. 안내와 오류는 색으로 가른다.

                    // 로그인은 `비밀번호 찾기 | 회원가입` 한 줄, 가입은 `이미 계정이 있나요? 로그인`(안드로이드 `AuthScreen` 과 같다).
                    if mode == .login {
                        loginLinksRow
                    } else {
                        modeSwitchRow
                    }
                }
                .padding(.horizontal, 22)
                // 제목 줄(`WakerTopBar`)이 아래 24 를 이미 갖는다 — 여기는 위 8 만 띄운다(안드로이드 `AuthScreen` 과 같은 32).
                .padding(.top, 8)
                .padding(.bottom, 18)
            }
            // ⚠ **입력창 밖을 눌러 키보드를 닫을 길을 둔다.** iOS 는 바깥 탭으로 키보드가
            // 자동으로 닫히지 않아서, 없으면 키보드가 화면 절반을 가린 채 버튼에 닿지 못한다
            // (2026-08-10 사용자 보고 — 편집기에는 이미 있었고 나머지 화면만 빠져 있었다).
            .scrollDismissesKeyboard(.interactively)
            }
        }
        .authToast(message: auth.statusMessage, isError: auth.statusIsError) { auth.statusMessage = nil }
        #if DEBUG
        // 화면 확인용 — `-UIPreviewAuthToast "<문장>"` 이면 그 문장을 토스트로 띄운다(`UIPreviewSeed.authToast`).
        .task {
            if let preview = UIPreviewSeed.authToast { auth.statusMessage = preview }
            // DEBUG 화면 확인 — `-UIPreviewAuthScreen reset` 은 로그인 화면을 거쳐 비밀번호 재설정을 연다(릴리스에서는 늘 nil).
            if UIPreviewSeed.authScreen == "reset" { showPasswordReset = true }
            if mode == .register, let step = UIPreviewSeed.registerStep { await applyRegisterPreviewStep(step) }
        }
        #endif
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
        // 가입 쪽 인라인 오류(`emailCodeError`)도 같은 시점에 지운다 — 안드로이드는 한 콜백이
        // 로그인·가입 오류를 함께 지운다.
        // '이미 가입된 이메일' 안내(`authNotice`)도 입력을 고치면 지운다 — 안드로이드 `onClearLoginError` 와 같다.
        .onChange(of: password) { _, _ in
            auth.clearLoginError()
            auth.clearEmailCodeError()
            auth.clearAuthNotice()
        }
        .onChange(of: email) { _, _ in
            auth.clearLoginError()
            auth.clearEmailCodeError()
            auth.clearAuthNotice()
        }
        // 화면을 떠나면(랜딩으로 돌아가기·로그인 성공) 지운다 — 안 지우면 다음에 연 로그인 화면에 앞 회차의 안내가 그대로
        // 떠 있다. 안드로이드는 `authRoute` 가 로그인 밖으로 바뀔 때 지운다(`ui/app/AlarmTalkApp.kt`).
        .onDisappear { auth.clearAuthNotice() }
        // 로그인↔가입을 오갈 때도 지운다(안드로이드는 `authRoute` 가 바뀔 때 지운다) —
        // 가입 화면에서는 이 자리에 비밀번호 규칙이 온다.
        // 가입 쪽 인라인 오류도 함께 지운다 — 안드로이드의 그 자리도 `registerError` 를 지운다. 남기면
        // 다시 들어온 가입 화면의 '이메일 인증' 버튼 아래에 앞 회차의 문장이 붙어 있다(코드 줄은
        // `handleModeChange` 가 닫는다).
        .onChange(of: mode) { _, next in
            auth.clearLoginError()
            auth.clearEmailCodeError()
            // 로그인으로 넘어온 이유는 로그인에 남기고, 가입으로 돌아가면 지운다(안드로이드도 같다).
            if next == .register { auth.clearAuthNotice() }
        }
        // 이미 가입된 이메일 — 입력한 이메일은 그대로 둔 채 로그인으로 돌린다(`AuthViewModel.authNotice`).
        .onChange(of: auth.redirectToLoginTick) { _, _ in
            handleModeChange(.login)
        }
        // 코드 칸을 비우라는 신호 — 서버가 코드를 거절했거나 다시 받기가 성공했다
        // (`AuthViewModel.emailCodeFieldClearTick`, 스펙 session-and-auth 「이메일 인증 코드」).
        .onChange(of: auth.emailCodeFieldClearTick) { _, _ in
            // 재설정 화면(이 화면 위에 push 된다)도 같은 신호를 올린다 — 로그인 모드에서는 볼 것이 없다.
            guard mode == .register else { return }
            verificationCode = ""
            // ⚠ **'인증 완료' 도 내린다.** 가입(`POST /auth/register`)이 코드를 거절했을 때 이게
            // 남으면 코드 줄이 숨은 채 이메일 옆 '인증됨' 버튼만 꺼져 있어, "다시 받아 주세요" 를
            // 읽고도 다시 받을 길이 없다. 내리면 코드 줄과 `다시 받기` 가 되돌아온다.
            // 인증 확인 단계에서 온 신호라면 이미 false 다.
            verificationCompleted = false
            verifiedEmail = ""
        }
    }

    // MARK: - Sections

    /// 형식 오류는 **이메일 칸 아래**에 붙는다. 나머지 로그인 실패(`auth.loginError`)는
    /// 비밀번호 칸 아래지만, 이건 이메일을 고쳐야 하는 일이라 고칠 칸 옆에 있어야 한다.
    /// 앱이 잡은 것이든 서버가 잡은 것이든(`AUTH_EMAIL_INVALID`) 자리는 하나다.
    /// 안드로이드도 같은 자리다(`ui/auth/AuthScreen.kt` 의 이메일 `supportingText`).
    private var emailField: some View {
        VStack(alignment: .leading, spacing: 6) {
            // 가입에서는 '인증 받기' 가 칸 **옆**에 붙는다(칸 안이 아니다 — 긴 주소를 가리고, 아래 코드 줄의 [칸][확인] 과
            // 모양이 갈린다. 캔버스 proposal-09). 아래 정렬인 이유는 `verificationCodeRow` 와 같다 — 칸 위에 라벨이 붙어 있다.
            HStack(alignment: .bottom, spacing: 8) {
                VocaTextField(
                    title: "이메일",
                    text: $email,
                    keyboardType: .emailAddress,
                    submitLabel: .next,
                    enabled: !auth.isBusy,
                    isError: showsEmailFormatError,
                    // 로그인은 칸 안 안내 글자만, 가입은 칸 위 이름표(안드로이드 `AuthTextField.placeholderOnly` 와 같다).
                    placeholderOnly: mode == .login
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                if mode == .register {
                    emailVerifyButton
                }
            }
            .onChange(of: email) { _, _ in
                // 고쳐 치기 시작하면 형식 경고를 지운다(안드로이드의 `onValueChange` 와 같은 시점).
                emailFormatError = false
                // 서버가 준 로그인 오류는 화면 바깥 `.onChange(of: email)` 이 지운다.
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

    /// 가입의 이메일 칸 옆 버튼 — `인증 받기` → (보낸 뒤) `다시 받기` → (확인되면) `✓ 인증됨`. 안드로이드 짝은
    /// `AuthScreen.kt` 의 `EmailVerifyButton`.
    ///
    /// ⚠ **형식으로 죽이지 않는다** — 가입에서 실질적인 제출 버튼이 이것이다.
    /// 예전에는 `emailLooksValid` 로 잠가 놔서, 주소를 잘못 친 사람은 눌리지 않는
    /// '이메일 인증' 앞에서 **무엇이 잘못됐는지 들을 길이 없었다.** 빈 칸일 때만 흐리다.
    private var emailVerifyButton: some View {
        let verified = isEmailVerifiedForCurrentInput
        return AuthEmailVerifyButton(
            verified: verified,
            codeSent: verificationSent,
            enabled: !auth.isBusy && AuthEmailFormat.canRequestEmailCode(email) && !verified
        ) {
            guard AuthEmailFormat.submitOutcome(email: email) == .submit else {
                emailFormatError = true
                return
            }
            Task {
                // 발송이 성공했을 때만 코드 입력 단계를 노출한다. 중복 이메일(AUTH_EMAIL_TAKEN)
                // 등으로 발송이 실패하면 verificationSent 가 켜지지 않아 6자리 코드 입력칸이
                // 뜨지 않는다. Android 는 codeSentForEmail 을 발송 성공 시에만 세팅한다.
                //
                // ⚠ **결과를 그대로 대입하지 말 것 — 실패로 닫지도 않는다.** 예전에는
                // `verificationSent = await …` 라, '인증 코드 다시 받기' 가 실패하면 코드 줄이
                // 사라지고 버튼이 '이메일 인증' 으로 되돌아갔다. 상한·만료로 "…다시 받아 주세요" 를
                // 읽고 누른 사람이 코드 줄과 그 아래의 답을 함께 잃었다(2026-10-11 리뷰). 안드로이드도
                // 실패에서는 `registerEmailVerificationSentTo` 를 건드리지 않는다.
                if await auth.requestEmailVerification(email: normalizedEmail) {
                    verificationSent = true
                }
            }
        }
    }

    private var verificationCodeRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            // ⚠ **아래로 정렬한다**(2026-09-17 실기기). 입력칸은 라벨('인증 코드')이 위에 붙은
            // 세로 묶음이라 중앙 정렬이면 버튼이 라벨까지 포함한 높이의 가운데로 올라가
            // **입력칸과 한 줄로 안 맞는다.** 높이도 입력칸과 같은 값(`AuthControlHeight`)으로
            // 고정해 두 상자의 위·아래가 맞물리게 한다.
            AuthCodeConfirmRow(
                code: $verificationCode,
                busy: auth.isBusy,
                // 고쳐 치기 시작하면 옛 경고를 지운다. ⚠ 빈 값에서는 지우지 않는다 — 거절된 숫자를 화면이
                // 비운 것(`emailCodeFieldClearTick`)이지 고쳐 친 것이 아니다. 거기서 지우면 문장이 뜨자마자 사라진다.
                onEdited: { auth.clearEmailCodeError() }
            ) {
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
            }

            // 다시 받기·인증 확인·가입의 실패는 **이 줄 바로 아래**, 안내 문구의 자리에 뜬다.
            // ⚠ 하단 `statusMessage` 로 보내지 말 것 — 비밀번호 칸과 제출 버튼을 지난 맨 아래라
            // 숫자 키패드 뒤에 놓이고, 이 키패드에는 닫는 키가 없다(`AuthViewModel.emailCodeError`).
            if auth.emailCodeError != nil {
                emailCodeErrorText
            } else {
                Text("메일로 받은 6자리 코드를 입력해 주세요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(AuthSceneColors.textDim)
            }
        }
    }

    /// 코드 요청·인증 확인·가입의 실패 문장(`AuthViewModel.emailCodeError`). 자리는 이메일 인증 묶음
    /// 안이다 — 코드 줄이 있으면 그 아래, 없으면 이메일 줄(칸 + '인증 받기') 바로 아래. 안드로이드의 같은
    /// 자리는 `ui/auth/AuthScreen.kt` 의 `registerError` 다.
    @ViewBuilder
    private var emailCodeErrorText: some View {
        if let message = auth.emailCodeError {
            Text(message)
                .font(theme.typography.bodySmall)
                .foregroundStyle(AuthSceneColors.error)
        }
    }

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
                isError: showsLoginError,
                placeholderOnly: mode == .login
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
        PasswordRules(atLeastMin: passwordAtLeastMin, hasLetterAndDigit: passwordHasLetterAndDigit, matches: passwordMatches)
    }

    private var confirmPasswordField: some View {
        ConfirmPasswordField(
            text: $confirmPassword,
            isVisible: $isConfirmPasswordVisible,
            enabled: !auth.isBusy,
            matches: passwordMatches
        )
    }

    private var submitButton: some View {
        GradientCta(
            // 가입 버튼 글자는 안드로이드 `auth_create_account` 와 같은 '회원가입' 이다(2026-11-22 — 예전에는 iOS 만 '계정 만들기').
            title: mode == .login ? "로그인" : "회원가입",
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
                        verificationCode: verificationCode
                    )
                }
            }
        }
        .padding(.top, 4)
    }

    /// 가입 → 로그인 전환(`이미 계정이 있나요? 로그인`) — 가입 모드에서만 그린다. 안드로이드 `AuthScreen` 의 하단 행.
    private var modeSwitchRow: some View {
        HStack(spacing: 2) {
            Spacer(minLength: 0)
            Text(String(localized: "이미 계정이 있나요?"))
                .font(theme.typography.bodyMedium)
                .foregroundStyle(AuthSceneColors.textMuted)
            Button(String(localized: "로그인")) {
                handleModeChange(.login)
            }
            .font(theme.typography.bodyMedium)
            .tint(AuthSceneColors.accent)
            .disabled(auth.isBusy)
            Spacer(minLength: 0)
        }
        .padding(.top, 6)
    }

    /// 이메일 로그인 아래 한 줄 — `비밀번호 찾기 | 회원가입`(2026-11-22 오너). 실제 서비스(무신사·오늘의집·컬리·쿠팡, 앱 웨이브·
    /// 밀리의서재)가 모두 로그인 버튼 근처 한 줄이었다. 예전에는 '비밀번호를 잊으셨나요? 비밀번호 찾기' 와 '처음 사용하시나요?
    /// 회원가입' 두 줄로 떨어져 있었다. 둘은 같은 무게다. 안드로이드 짝 `ui/auth/AuthScreen.kt` 의 `AuthLoginLinksRow`.
    private var loginLinksRow: some View {
        HStack(spacing: 0) {
            Button("비밀번호 찾기") { showPasswordReset = true }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            Rectangle()
                .fill(AuthSceneColors.line)
                .frame(width: 1, height: 12)
            Button("회원가입") { handleModeChange(.register) }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .font(theme.typography.bodyMedium)
        .buttonStyle(.plain)
        .foregroundStyle(AuthSceneColors.textDim)
        .disabled(auth.isBusy)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    #if DEBUG
    /// 화면 확인용 — `-UIPreviewRegisterStep code|rejected|verified|invalid`. 이메일을 넣은 **뒤** 한 박자 쉬고 단계를 놓는다 —
    /// 이메일이 바뀌면 `.onChange(of: email)` 가 인증 상태와 오류를 지우기 때문이다. 릴리스에는 없다.
    private func applyRegisterPreviewStep(_ step: String) async {
        email = step == "invalid" ? "preview@alarm" : "preview@alarm-talk.com"
        try? await Task.sleep(nanoseconds: 300_000_000)
        switch step {
        case "code":
            verificationSent = true
        case "rejected":
            verificationSent = true
            auth.setPreviewEmailCodeError(APIErrorMessages.message(for: "AUTH_EMAIL_CODE_INVALID"))
        case "verified":
            verificationSent = true
            verificationCompleted = true
            verifiedEmail = normalizedEmail
        case "invalid":
            emailFormatError = true
        default:
            break
        }
    }
    #endif

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

// MARK: - 로그인 수단 고르기

/// '시작하기' 다음 화면 — 로그인 수단을 **먼저** 고른다(2026-11-22 오너). 카카오 → Apple → 이메일로 계속하기.
///
/// 실제 앱 캡처 10개 중 7개가 이 모양이었다(조사와 출처는 `docs/spec/session-and-auth.md` 「로그인 화면」). 예전에는 이 버튼들
/// 아래에 이메일 칸까지 한 화면(`LoginView`)에 펼쳐 두었다(2026-11-14).
/// - 카카오·Apple 은 처음이면 곧 가입이라 이 화면에 가입 갈래가 따로 없다. 이메일을 고르면 `LoginView(.login)` 으로 가고,
///   가입은 거기 아래 '회원가입' 이다.
/// - 세 버튼은 같은 높이(`AuthControlHeight`)·같은 모서리(12)다. Apple 은 'Apple로 로그인' 을 다른 로그인 버튼보다 작게 두지
///   말라고 하고, 카카오는 다른 버튼을 카카오보다 눈에 띄게 두지 말라고 한다 — 이메일은 옅은 유리 바탕이다.
/// - 안드로이드 짝 `ui/auth/AuthMethodsScreen.kt` 의 `AuthMethodsScreen`(Apple 자리에 구글).
struct AuthMethodsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var pendingRawNonce: String?
    @State private var showEmailLogin = false

    var body: some View {
        AuthBackdrop {
            VStack(alignment: .leading, spacing: 0) {
                // 제목 줄은 이메일 로그인(`LoginView`)과 같다 — 원형 뒤로가기 + 위쪽 가운데 제목, 스크롤 밖.
                WakerTopBar(
                    title: "로그인/회원가입",
                    onBack: { dismiss() },
                    tint: AuthSceneColors.text
                )
                .padding(.top, 18)

                ScrollView {
                    VStack(spacing: 12) {
                        KakaoLoginButton(enabled: !auth.isBusy) {
                            Task { await auth.loginWithKakao() }
                        }
                        appleSignInButton
                        emailButton
                    }
                    .padding(.horizontal, 22)
                    // 제목 줄(`WakerTopBar`)이 아래 24 를 이미 갖는다 — 여기는 위 8 만 띄운다(안드로이드 `AuthScreen` 과 같은 32).
                    .padding(.top, 8)
                    .padding(.bottom, 18)
                }
            }
        }
        // 간편 로그인 실패 안내(`statusMessage`)는 위쪽 토스트다 — 이메일 화면과 같은 자리(`LoginView`).
        .authToast(message: auth.statusMessage, isError: auth.statusIsError) { auth.statusMessage = nil }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        // 위에서 직접 그리므로 시스템 것은 숨긴다(둘 다 뜨면 화살표가 두 개가 된다).
        .navigationBarBackButtonHidden(true)
        .navigationDestination(isPresented: $showEmailLogin) {
            LoginView(initialMode: .login)
        }
    }

    /// 'Apple로 계속하기' — 이 화면은 로그인과 가입을 함께 받으므로 `.continue` 다(카카오 글자는 가이드대로 '카카오 로그인').
    private var appleSignInButton: some View {
        SignInWithAppleButton(.continue) { request in
            let raw = NonceGenerator.makeNonce()
            pendingRawNonce = raw
            // 이름은 묻지 않는다(2026-10-29 닉네임 삭제 — 받아도 쓰지 않는다).
            request.requestedScopes = [.email]
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
        .frame(height: AuthControlHeight)
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous))
        .disabled(auth.isBusy)
    }

    /// '이메일로 계속하기' — 카카오·Apple 버튼과 같은 골격(아이콘 + 글자를 한 덩어리로 가운데, 높이·모서리 같음)이라 세 버튼이
    /// 한 묶음으로 읽힌다. 바탕은 입력 칸과 같은 옅은 유리다. 안드로이드 짝 `AuthMethodsScreen` 의 `EmailContinueButton`.
    private var emailButton: some View {
        Button {
            showEmailLogin = true
        } label: {
            HStack(spacing: AuthSignInIconGap) {
                Image(systemName: "envelope")
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(AuthSceneColors.text)
                    .accessibilityHidden(true)
                Text("이메일로 계속하기")
                    .font(.system(.body, weight: .medium))
                    .foregroundStyle(AuthSceneColors.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: AuthControlHeight)
            .background(
                AuthSceneColors.fieldGlass,
                in: RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous)
                    .stroke(AuthSceneColors.line, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(AuthPlainButtonStyle())
        .opacity(auth.isBusy ? 0.38 : 1)
        .disabled(auth.isBusy)
    }
}

// MARK: - Mode

/// 로그인/회원가입 두 모드. `AuthMethodsView` 가 `LoginView(initialMode: .login)` 으로 넘기고, 화면 아래 한 줄
/// ('회원가입' / '로그인')로 전환한다.
enum LoginMode: Hashable, Identifiable {
    case login
    case register

    var id: Self { self }
}

// MARK: - Inputs

/// 칸 안 안내 글자 — `placeholderOnly` 일 때만 보인다. 아닐 때는 빈 글자를 넘겨 이름(`title`)이 칸 안에 또 뜨지 않게
/// 한다. 어느 쪽이든 `title` 은 VoiceOver 가 칸 이름으로 읽는다.
private func authFieldPrompt(_ title: LocalizedStringKey, shown: Bool) -> Text {
    shown ? Text(title).foregroundStyle(AuthSceneColors.textMuted) : Text(verbatim: "")
}

/// 인증 화면 한 줄 입력칸 — 위 이름표 + 유리판 칸(높이 `AuthControlHeight`). 안드로이드 짝 `ui/auth/AuthScreen.kt` 의
/// `AuthTextField`.
///
/// `placeholderOnly` 면 이름표를 칸 위에 두지 않고 칸 **안** 안내 글자로 쓴다 — 이메일 로그인 화면이 그렇다(2026-11-22
/// 오너. 실제 서비스 로그인 다섯 곳 모두 칸 위 이름표가 없었다). 가입·재설정처럼 칸이 여럿인 폼은 위 이름표를 둔다 — 글자를
/// 치면 안내 글자가 사라져 어느 칸인지 남지 않는다.
struct VocaTextField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    // 라벨은 `LocalizedStringKey` — `String` 이면 번역이 죽는다(`GradientCta.title` 주석).
    let title: LocalizedStringKey
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var submitLabel: SubmitLabel = .next
    var enabled: Bool = true
    // 테두리를 빨갛게 — `VocaSecureField` 와 같은 규칙이다. 안드로이드는
    // `AuthTextField(isError:)` 가 같은 일을 한다(`ui/auth/AuthScreen.kt`).
    var isError: Bool = false
    var placeholderOnly: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !placeholderOnly {
                Text(title)
                    .font(theme.typography.labelMedium)
                    .foregroundStyle(AuthSceneColors.textMuted)
            }
            TextField(title, text: $text, prompt: authFieldPrompt(title, shown: placeholderOnly))
                .keyboardType(keyboardType)
                .submitLabel(submitLabel)
                .disabled(!enabled)
                .foregroundStyle(AuthSceneColors.text)
                .tint(AuthSceneColors.accent)
                // 옆에 붙는 버튼(`AuthEmailVerifyButton`·코드 줄 `확인`)도 같은 값이다 — 따로 두면 글꼴 크기 설정에 따라
                // 둘이 어긋난다(2026-09-17). 글자를 아주 키우면 함께 자란다(`minHeight`).
                .frame(minHeight: AuthControlHeight)
                .padding(.horizontal, 14)
                // ⚠ 인증 화면은 고정 다크라 테마 `outline` 만 두면 남색 배경에서 테두리가
                // 거의 안 보이고 입력칸이 어디부터인지 모른다. 안드로이드는 글라스 채움
                // (`AuthFieldGlass`) + `AuthLine` 테두리다(`ui/auth/AuthScreen.kt`).
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

/// 비밀번호 칸 — `VocaTextField` 와 같은 골격(이름표·높이·`placeholderOnly`)에 보기/숨기기 버튼이 붙는다.
struct VocaSecureField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    // 라벨은 `LocalizedStringKey` — `String` 이면 번역이 죽는다(`GradientCta.title` 주석).
    let title: LocalizedStringKey
    @Binding var text: String
    @Binding var isVisible: Bool
    var enabled: Bool = true
    var isError: Bool = false
    var placeholderOnly: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !placeholderOnly {
                Text(title)
                    .font(theme.typography.labelMedium)
                    .foregroundStyle(AuthSceneColors.textMuted)
            }
            HStack(spacing: 8) {
                Group {
                    if isVisible {
                        TextField(title, text: $text, prompt: authFieldPrompt(title, shown: placeholderOnly))
                    } else {
                        SecureField(title, text: $text, prompt: authFieldPrompt(title, shown: placeholderOnly))
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
                .accessibilityLabel(isVisible ? String(localized: "비밀번호 숨기기") : String(localized: "비밀번호 보기"))
            }
            .frame(minHeight: AuthControlHeight)
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

/// 이메일 칸 옆 `인증 받기` — 가입·비밀번호 재설정 두 화면이 같은 모양으로 쓴다(안드로이드 `EmailVerifyButton`).
/// 보낸 뒤 `다시 받기`, 확인 뒤 `✓ 인증됨`. 칸 **옆**에 붙는다(칸 안이 아니다 — 긴 주소를 가리고 코드 줄과 모양이 갈린다).
///
/// ⚠ **형식으로 죽이지 않는다** — 가입에서 실질적인 제출 버튼이 이것이다. 예전에는 `emailLooksValid` 로 잠가 놔서,
/// 주소를 잘못 친 사람은 눌리지 않는 '이메일 인증' 앞에서 **무엇이 잘못됐는지 들을 길이 없었다.** 빈 칸일 때만 흐리다.
struct AuthEmailVerifyButton: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let verified: Bool
    let codeSent: Bool
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if verified {
                    Image(systemName: "checkmark.circle")
                }
                Text(label)
                    .lineLimit(1)
            }
            .font(theme.typography.labelLarge)
            // 인증됨은 눌리지 않지만 '꺼진 버튼' 이 아니라 '마친 상태' 로 읽혀야 한다 — 강조색.
            .foregroundStyle(verified ? AuthSceneColors.accent : (enabled ? AuthSceneColors.text : Color.white.opacity(0x8C / 255.0)))
            .frame(minWidth: 56)
            .frame(minHeight: AuthControlHeight)
            .padding(.horizontal, 16)
            // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
            .contentShape(Rectangle())
        }
        .buttonStyle(AuthPlainButtonStyle())
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(
                    verified ? AuthSceneColors.accent.opacity(0.3) : (enabled ? AuthSceneColors.line : AuthSceneColors.lineSoft),
                    lineWidth: 1
                )
        )
        .disabled(!enabled)
        // 칸이 줄어들지 버튼 글자가 잘리지 않는다.
        .fixedSize(horizontal: true, vertical: false)
    }

    // 셋 다 `String(localized:)` 로 번역한 뒤 넘긴다 — 날 리터럴을 `String` 으로 돌려주면 `Text(변수)` 가 번역하지 않아
    // en/ja 기기에서 한국어가 그대로 뜬다.
    // ⚠ '다시 받기' 는 **키를 따로 둔다**(`auth.email.resendShort`). 글자 그대로를 키로 쓰면 같은 글자의 다른 버튼('다시
    //   내려받기' — en "Download again")과 번역을 함께 써, 영어·일본어 기기에서 코드 재발송이 '다시 다운로드' 가 됐다.
    private var label: String {
        if verified { return String(localized: "인증됨") }
        if codeSent { return String(localized: "auth.email.resendShort", defaultValue: "다시 받기") }
        return String(localized: "인증 받기")
    }
}

/// 인증 코드 칸과 `확인` — 가입·비밀번호 재설정 두 화면이 같은 모양으로 쓴다(안드로이드 두 화면의 코드 줄).
///
/// ⚠ **아래로 정렬한다**(2026-09-17 실기기). 입력칸은 라벨('인증 코드')이 위에 붙은 세로 묶음이라 중앙 정렬이면 버튼이
/// 라벨까지 포함한 높이의 가운데로 올라가 **입력칸과 한 줄로 안 맞는다.** 높이도 입력칸과 같은 값(`AuthControlHeight`)이다.
struct AuthCodeConfirmRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var code: String
    let busy: Bool
    /// 새니타이저를 거친 값이 비어 있지 않게 바뀔 때.
    var onEdited: () -> Void = {}
    let onConfirm: () -> Void

    /// 6자리가 찼을 때만 눌린다 — 거절 뒤에 칸이 비면 같은 숫자를 다시 보낼 수 없다.
    private var confirmEnabled: Bool {
        !busy && LoginValidator.isValidVerificationCode(code)
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VocaTextField(
                title: "인증 코드",
                text: $code,
                // ASCII 숫자만 내는 키패드로 못 박는다 — 서버의 형식 검사는 ASCII 만 받는데
                // `.numberPad` 에는 그 보장이 없다. 붙여 넣은 값은 아래 새니타이저가 받는다.
                keyboardType: .asciiCapableNumberPad,
                submitLabel: .next,
                enabled: !busy
            )
            .onChange(of: code) { _, newValue in
                // 숫자 규칙은 새니타이저 한 곳이다(붙여 넣은 값·다른 키보드까지 같은 규칙).
                let cleaned = InputSanitizer.sanitizeVerificationCode(newValue)
                if cleaned != newValue { code = cleaned }
                if !cleaned.isEmpty { onEdited() }
            }

            Button(action: onConfirm) {
                Text("확인")
                    .font(theme.typography.labelLarge)
                    // 꺼진 글자는 55% — 다른 인증 버튼(`AuthEmailVerifyButton`)·안드로이드 `authOutlinedButtonColors` 와 같다.
                    // 35% 는 대비 3.15:1 로 읽기 어려워 2026-08-17 에 올렸는데 이 버튼만 빠져 있었다(2026-11-22).
                    .foregroundStyle(confirmEnabled ? AuthSceneColors.text : Color.white.opacity(0x8C / 255.0))
                    .frame(minHeight: AuthControlHeight)
                    // 좌우 24 — 안드로이드 `OutlinedButton` 기본 여백과 같다(예전 iOS 만 18).
                    .padding(.horizontal, 24)
                    // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                    .contentShape(Rectangle())
            }
            .buttonStyle(AuthPlainButtonStyle())
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(confirmEnabled ? AuthSceneColors.line : AuthSceneColors.lineSoft, lineWidth: 1)
            )
            .disabled(!confirmEnabled)
        }
    }
}

/// 비밀번호 확인 칸 — 가입·비밀번호 재설정 두 화면이 같은 모양으로 쓴다(안드로이드 `auth_label_confirm_password`).
struct ConfirmPasswordField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var text: String
    @Binding var isVisible: Bool
    let enabled: Bool
    let matches: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            VocaSecureField(
                title: "비밀번호 확인",
                text: $text,
                isVisible: $isVisible,
                enabled: enabled,
                isError: !text.isEmpty && !matches
            )
            if !text.isEmpty && !matches {
                Text("비밀번호가 일치하지 않아요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
            }
        }
    }
}

/// 비밀번호 규칙 세 줄 — 가입·비밀번호 재설정 두 화면이 같은 모양으로 쓴다(안드로이드 `PasswordRules`).
struct PasswordRules: View {
    let atLeastMin: Bool
    let hasLetterAndDigit: Bool
    let matches: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RuleRow(text: "8자 이상", satisfied: atLeastMin)
            RuleRow(text: "영문·숫자 포함", satisfied: hasLetterAndDigit)
            RuleRow(text: "비밀번호 확인 일치", satisfied: matches)
        }
    }
}

// MARK: - Validation helpers

/// 본 화면이 직접 사용하는 작은 검증 helper.
///
/// ⚠ **이메일 형식 규칙을 여기 다시 박지 말 것.** 단일 출처는 `AuthEmailFormat` 이고(서버 `@alarmtalk/shared` 의
/// `EMAIL_PATTERN` 과 같은 문자열), 비밀번호 규칙은 `PasswordPolicy` 다 — 화면과 테스트가 그 둘을 직접 부른다.
enum LoginValidator {
    /// 인증코드 = 정확히 **ASCII 숫자** 6자리 — 서버 `EmailVerificationCodeSchema` 가 받는 모양이다.
    /// 가입·재설정 두 화면의 확인 버튼이 이 판정으로 열린다(`AuthCodeConfirmRow.confirmEnabled`·
    /// `PasswordResetView.canConfirm`).
    ///
    /// 예전에는 `allSatisfy(\.isNumber)` 였고 **부르는 화면이 없었다**(테스트만 불렀다). 그 판정은
    /// 아라비아-인도 숫자·분수·원문자도 통과시켜 서버가 형식에서 떨어뜨릴 값을 '유효' 라고 했다.
    /// 숫자 규칙은 새니타이저 한 곳이다 — 이미 정리된 여섯 자만 유효하다.
    static func isValidVerificationCode(_ value: String) -> Bool {
        value.utf8.count == InputSanitizer.verificationCodeLength
            && InputSanitizer.sanitizeVerificationCode(value) == value
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
