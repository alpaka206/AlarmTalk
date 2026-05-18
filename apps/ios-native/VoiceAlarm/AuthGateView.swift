import AuthenticationServices
import SwiftUI

struct AuthGateView: View {
    @EnvironmentObject private var auth: AuthViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Naro")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundStyle(VoiceAlarmTheme.text)
                Text("실제 알람처럼 울리는 네이티브 음성 알람")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                Text("iOS에서는 Apple 로그인 후 AlarmKit 권한을 허용해야 잠금화면 알람을 예약할 수 있어요.")
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }

            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = [.fullName, .email]
            } onCompletion: { result in
                switch result {
                case .success(let authorization):
                    Task { await auth.handleAppleAuthorization(authorization) }
                case .failure(let error):
                    Task { @MainActor in auth.handleAppleAuthorizationFailure(error) }
                }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .disabled(auth.isBusy)

            if let status = auth.statusMessage {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .background(VoiceAlarmTheme.background)
    }
}
