import SwiftUI
import UIKit

/// 비밀번호 재설정 — 가입한 이메일로 6자리 코드를 받아 **먼저 확인하고**, 그다음 새 비밀번호를 정한다
/// (2026-11-16 오너: "인증 코드 받고 확인한 다음에 넘어가게"). 비밀번호를 찾아 주는 것이 아니라 바꾸는 것이다 —
/// 서버에는 비밀번호 원문이 없다(bcrypt 해시만 있다).
///
/// Android `apps/android-native/.../ui/auth/PasswordResetScreen.kt` 의 `PasswordResetScreen` 과 같은 순서다. 이메일·코드
/// 줄은 가입 화면(`LoginView`)과 같은 부품이다 — 이메일 칸 옆 `AuthEmailVerifyButton`(보낸 뒤 `다시 받기`, 확인 뒤
/// `✓ 인증됨`), `AuthCodeConfirmRow`. 새 비밀번호·`ConfirmPasswordField`·`PasswordRules` 도 가입과 같다. 확인
/// (`verifyPasswordResetCode`)은 코드를 쓰지 않고, 확정(`confirmPasswordReset`)에서 서버가 같은 코드를 한 번 더 판정한다.
///
/// `LoginView` 의 로그인 모드에서 "비밀번호 찾기" 링크로 push 된다.
struct PasswordResetView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var email: String = ""
    @State private var code: String = ""
    @State private var password: String = ""
    @State private var confirmPassword: String = ""
    @State private var isPasswordVisible = false
    @State private var isConfirmPasswordVisible = false
    /// `인증 받기` 를 눌렀는데 이메일이 형식에 안 맞았는가 — **누른 뒤에만** 뜬다.
    /// 치는 도중에 빨갛게 만들면 아직 다 치지도 않은 주소를 틀렸다고 하는 셈이다.
    /// 안드로이드 `ui/auth/PasswordResetScreen.kt` 의 `emailFormatError` 와 같은 규칙이다.
    @State private var emailFormatError = false

    /// 정규화도 형식 규칙과 같은 출처를 쓴다 — 여기만 자체 `trimming`/`lowercased` 로
    /// 두면 규칙이 갈라지고, 갈라진 줄 모른 채 한쪽만 고치게 된다.
    private var normalizedEmail: String {
        AuthEmailFormat.normalize(email)
    }

    /// 코드 발송 여부 — VM 의 `passwordResetCodeSentTo` 가 현재 입력 이메일과 같을 때만 코드 줄을 노출한다.
    /// 보낸 것도 확인한 것도 **그 주소에** 묶인다 — 주소를 고치면 `인증 받기` 로 돌아간다(가입과 같다).
    private var codeSent: Bool {
        guard let sentTo = auth.passwordResetCodeSentTo else { return false }
        return sentTo == normalizedEmail
    }

    /// 코드를 확인했는가 — 그때만 새 비밀번호 단계다. Android `verifiedEmail == normalizedEmail`.
    private var verified: Bool {
        codeSent && auth.passwordResetVerifiedEmail == normalizedEmail
    }

    // 서버 정책(@alarmtalk/shared PasswordSchema)과 같은 규칙이다 — 판정은 가입 화면과 같은 한 벌(`PasswordPolicy`).
    private var passwordAtLeastMin: Bool { password.count >= PasswordPolicy.lengthRange.lowerBound }
    private var passwordHasLetterAndDigit: Bool { PasswordPolicy.hasLetter(password) && PasswordPolicy.hasDigit(password) }
    private var passwordMatches: Bool { !password.isEmpty && password == confirmPassword }

    private var canConfirm: Bool {
        !auth.isBusy && verified && LoginValidator.isValidVerificationCode(code)
            && PasswordPolicy.isValid(password) && passwordMatches
    }

    var body: some View {
        AuthBackdrop {
            VStack(alignment: .leading, spacing: 0) {
            // 제목 줄은 로그인·가입과 같다(`WakerTopBar` — 원형 뒤로가기 + 위쪽 가운데 제목, 스크롤 밖. 2026-11-22). 예전에는
            // 이 화면만 시스템 네비게이션 바(작은 제목 + 시스템 화살표)였다. 안드로이드 짝 `PasswordResetScreen` 의 `AuthTopBar`.
            WakerTopBar(
                title: "비밀번호 재설정",
                onBack: { dismiss() },
                tint: AuthSceneColors.text
            )
            .padding(.top, 18)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // 제목 아래 안내('가입한 이메일로 인증 코드를 보내드려요.')는 뺐다(2026-11-16 오너) — 칸과 버튼이 같은 말을 한다.
                    emailRow
                    // 형식 오류는 **고쳐야 할 칸 바로 아래**에 붙는다(로그인 화면과 같은 자리).
                    if emailFormatError {
                        Text(APIErrorMessages.emailInvalid)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(AuthSceneColors.error)
                    }

                    if codeSent && !verified {
                        VStack(alignment: .leading, spacing: 6) {
                            AuthCodeConfirmRow(code: $code, busy: auth.isBusy) {
                                Task { await auth.verifyPasswordResetCode(email: normalizedEmail, code: code) }
                            }
                            Text("메일로 받은 6자리 코드를 입력해 주세요.")
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(AuthSceneColors.textDim)
                        }
                    }

                    if verified {
                        newPasswordField
                        // 비밀번호 확인 칸 — 가입 화면과 같다(2026-11-16 오너 "비밀번호 찾기에는 비밀번호 확인 일치가 왜 없어").
                        // 잘못 친 채 바꾸면 그 비밀번호로는 로그인할 수 없어 재설정을 한 번 더 해야 한다.
                        ConfirmPasswordField(
                            text: $confirmPassword,
                            isVisible: $isConfirmPasswordVisible,
                            enabled: !auth.isBusy,
                            matches: passwordMatches
                        )
                        PasswordRules(atLeastMin: passwordAtLeastMin, hasLetterAndDigit: passwordHasLetterAndDigit, matches: passwordMatches)
                        confirmButton
                    }

                    // 코드 발송 안내·오류는 위쪽 토스트로 뜬다(아래 `.authToast` — 로그인 화면과 같다, 2026-11-15).
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
        // 제목은 화면 **안**(`WakerTopBar`)에 있다 — 네비게이션 바에 또 그리면 같은 말이 두 번 나온다(`LoginView` 와 같다).
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        // ⚠ **화면을 나갈 때 발송·확인 상태를 지운다.** 예전에는 `passwordResetCodeSentTo` 와
        // `statusMessage` 가 뷰모델에 남아, 뒤로 갔다가 다시 들어오면 아무것도 안 했는데
        // "인증 코드를 보냈어요" 가 떠 있고 코드 단계가 **이미 열린 채**였다. 사용자는 오지도 않은 코드를 기다리게 된다.
        //
        // ⚠ 지우는 시점은 `onDisappear`(화면 이탈)여야 한다 — `scenePhase` 로 지우면
        // **메일 앱에 다녀오는 사이에** 상태가 날아가, 방금 받은 코드를 넣을 화면이
        // 초기화된다. 앱 전환은 이탈이 아니다.
        .onDisappear {
            auth.passwordResetCodeSentTo = nil
            auth.passwordResetVerifiedEmail = nil
            auth.statusMessage = nil
        }
        // 코드 칸을 비우라는 신호 — 서버가 코드를 거절했거나(틀림·만료·시도 상한) 다시 받기가
        // 성공했다. 칸은 6자에서 잘리므로, 비우지 않으면 새로 받은 코드를 쳐도 한 글자도 안
        // 들어가고 옛 숫자가 다시 나간다(`AuthViewModel.emailCodeFieldClearTick`).
        .onChange(of: auth.emailCodeFieldClearTick) { _, _ in code = "" }
        #if DEBUG
        .task { applyPreviewStep() }
        #endif
        // ⚠ **뒤로가기는 `WakerTopBar` 하나다 — 시스템 것을 숨긴 채로 둘 것**(`.navigationBarBackButtonHidden`). 예전에는
        // 시스템 뒤로가기 위에 `ToolbarItem(.topBarLeading)` 로 `chevron.backward` 를 하나 더 얹어서 왼쪽 위에 화살표가
        // 나란히 두 개 보였다(둘 다 같은 `dismiss()` 를 했다).
    }

    // MARK: - Sections

    /// 이메일 칸과 그 옆 `인증 받기` — 가입 화면의 이메일 줄과 같다(아래 정렬: 칸 위에 라벨이 붙어 있다).
    ///
    /// ⚠ **보낸 뒤에도 잠그지 않는다 — `다시 받기` 로 눌린다**(가입 화면과 같은 말). 코드가 만료되거나 시도 상한에 닿으면
    /// 할 일이 '다시 받기' 하나인데, 예전에는 그러려면 화면을 나갔다 와야 했다
    /// (`docs/spec/session-and-auth.md` 「거절 뒤에 할 일이 화면에 있어야 한다」). 잠그는 것은 빈 칸과 확인을 마친 뒤뿐이다.
    private var emailRow: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VocaTextField(
                title: "이메일",
                text: $email,
                keyboardType: .emailAddress,
                enabled: !auth.isBusy,
                isError: emailFormatError
            )
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            // 고쳐 치기 시작하면 경고를 지운다 — 남겨 두면 이미 고친 값 아래에 옛 경고가 붙어 있다.
            .onChange(of: email) { _, _ in emailFormatError = false }

            AuthEmailVerifyButton(
                verified: verified,
                codeSent: codeSent,
                enabled: !auth.isBusy && AuthEmailFormat.canRequestEmailCode(email) && !verified
            ) {
                guard AuthEmailFormat.submitOutcome(email: email) == .submit else {
                    emailFormatError = true
                    return
                }
                Task { await auth.requestPasswordReset(email: normalizedEmail) }
            }
        }
    }

    private var newPasswordField: some View {
        VocaSecureField(
            title: "새 비밀번호",
            text: $password,
            isVisible: $isPasswordVisible,
            enabled: !auth.isBusy
        )
    }

    private var confirmButton: some View {
        GradientCta(title: "비밀번호 변경", enabled: canConfirm, loading: auth.isBusy) {
            Task {
                let ok = await auth.confirmPasswordReset(
                    email: normalizedEmail,
                    code: code,
                    newPassword: password
                )
                if ok { dismiss() }
            }
        }
        .padding(.top, 4)
    }

    #if DEBUG
    /// 화면 확인용 — `-UIPreviewResetStep code|password`(함께 `-UIPreviewAuthScreen reset`). 서버 없이 코드 줄·새 비밀번호
    /// 단계를 띄운다. 릴리스에는 없다.
    private func applyPreviewStep() {
        guard let step = UIPreviewSeed.resetStep else { return }
        email = "preview@alarm-talk.com"
        auth.passwordResetCodeSentTo = AuthEmailFormat.normalize(email)
        if step == "password" {
            code = "123456"
            auth.passwordResetVerifiedEmail = AuthEmailFormat.normalize(email)
        }
    }
    #endif
}

#if DEBUG
#Preview("PasswordResetView (light)") {
    NavigationStack {
        PasswordResetView()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("PasswordResetView (dark)") {
    NavigationStack {
        PasswordResetView()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
