import SwiftUI
import UIKit

/// 비밀번호 재설정 — 가입한 이메일로 6자리 코드를 받고, 코드 + 새 비밀번호로 변경한다.
///
/// Android `apps/android-native/.../ui/auth/PasswordResetScreen.kt:46-201` 를 1:1 포팅했다.
/// 코드 발송 후(`auth.passwordResetCodeSentTo` == 입력 이메일) 코드·새 비밀번호 입력이
/// 노출되며, 확정은 단일 호출(`confirmPasswordReset`)로 검증 + 변경을 한 번에 처리한다.
///
/// `LoginView` 의 로그인 모드에서 "비밀번호 찾기" 링크로 push 된다.
struct PasswordResetView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var email: String = ""
    @State private var code: String = ""
    @State private var password: String = ""
    @State private var isPasswordVisible = false

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var emailLooksValid: Bool {
        LoginValidator.isValidEmail(normalizedEmail)
    }

    /// 코드 발송 여부 — VM 의 `passwordResetCodeSentTo` 가 현재 입력 이메일과 같을 때만
    /// 코드 + 새 비밀번호 단계를 노출한다. Android `codeSentTo == normalizedEmail`.
    private var codeSent: Bool {
        guard let sentTo = auth.passwordResetCodeSentTo else { return false }
        return sentTo == normalizedEmail
    }

    // 서버 정책(@alarmtalk/shared PasswordSchema)·Android 와 동일: 8~128자 + 영문·숫자 각 1자 이상.
    private var passwordPolicyValid: Bool {
        (8...128).contains(password.count) &&
            password.contains(where: { $0.isLetter }) &&
            password.contains(where: { $0.isNumber })
    }

    private var canConfirm: Bool {
        !auth.isBusy && codeSent && code.count == 6 && passwordPolicyValid
    }

    var body: some View {
        AuthBackdrop {

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // Android `auth_reset_subtitle` 와 동일한 문구.
                    Text("가입한 이메일로 인증 코드를 보내드려요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)

                    emailField
                    sendCodeButton

                    if codeSent {
                        codeField
                        newPasswordField
                        // 새 비밀번호 규칙 안내 — Android `auth_reset_password_hint` 와 동일.
                        Text("8자 이상, 영문·숫자 포함")
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                        confirmButton
                    }

                    if let message = auth.statusMessage {
                        // 코드 발송 안내·오류가 모두 여기로 온다 — 중립색으로 뭉뚱그리지
                        // 않고 `statusIsError` 로 갈라 그린다.
                        Text(message)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(auth.statusIsError ? AuthSceneColors.error : AuthSceneColors.notice)
                            .padding(.top, 4)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
            }
        }
        .navigationTitle("비밀번호 재설정")
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
    }

    // MARK: - Sections

    private var emailField: some View {
        VocaTextField(
            title: "이메일",
            text: $email,
            keyboardType: .emailAddress,
            enabled: !auth.isBusy && !codeSent
        )
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
    }

    private var sendCodeButton: some View {
        AuthOutlinedButton(
            title: codeSent ? "코드를 보냈어요" : "인증 코드 받기",
            enabled: !auth.isBusy && emailLooksValid && !codeSent
        ) {
            Task { await auth.requestPasswordReset(email: normalizedEmail) }
        }
    }

    private var codeField: some View {
        VStack(alignment: .leading, spacing: 6) {
            VocaTextField(
                title: "인증 코드",
                text: $code,
                keyboardType: .numberPad,
                enabled: !auth.isBusy
            )
            .onChange(of: code) { _, newValue in
                let digits = newValue.filter(\.isNumber)
                code = String(digits.prefix(6))
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
