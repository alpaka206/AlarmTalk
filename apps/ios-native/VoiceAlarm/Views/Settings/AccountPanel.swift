import SwiftUI

/// 계정 카드 — 닉네임 편집, 이메일 표시, 로그아웃.
///
/// ContentView 의 settingsSheet 내 "계정" 섹션을 빼낸 것. 부모(SettingsView)는
/// 로그아웃 시 시트를 닫는 책임만 onSignOut 콜백으로 받는다.
struct AccountPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Binding var nicknameDraft: String
    let user: AuthUser
    let onSignOut: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text("닉네임")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                HStack {
                    TextField("닉네임", text: $nicknameDraft)
                        .textFieldStyle(.roundedBorder)
                    Button("저장") {
                        Task { await auth.updateProfile(name: nicknameDraft) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(nicknameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || auth.isBusy)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            Divider()
            SettingsRow(label: "계정", value: user.email)
            Divider()
            Button {
                auth.signOut()
                onSignOut()
            } label: {
                HStack {
                    Text("로그아웃")
                        .fontWeight(.medium)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
        }
        .settingsCard(title: "계정")
    }
}

/// 회원 탈퇴 카드 — 별도 카드로 분리해 위험 행동을 시각적으로 격리.
struct DeleteAccountPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    let onDeleted: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(role: .destructive) {
                Task {
                    await auth.deleteAccount()
                    onDeleted()
                }
            } label: {
                HStack {
                    Text("회원 탈퇴")
                        .fontWeight(.medium)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
        }
        .settingsCard(title: nil)
    }
}

#if DEBUG
private struct AccountPanelPreviewHost: View {
    @State private var nickname = "Naro"
    var body: some View {
        VStack(spacing: 16) {
            AccountPanel(
                nicknameDraft: $nickname,
                user: AuthUser(
                    id: "u1",
                    email: "preview@voicealarm.app",
                    name: "Naro",
                    plan: "free"
                ),
                onSignOut: {}
            )
            DeleteAccountPanel(onDeleted: {})
        }
        .padding()
    }
}

#Preview("AccountPanel (light)") {
    AccountPanelPreviewHost()
        .voiceAlarmPreviewEnvironment()
}

#Preview("AccountPanel (dark)") {
    AccountPanelPreviewHost()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
