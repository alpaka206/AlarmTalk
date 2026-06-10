import SwiftUI

/// 계정 카드 — 닉네임 편집, 로그아웃.
///
/// ContentView 의 settingsSheet 내 "계정" 섹션을 빼낸 것. 부모(SettingsView)는
/// 로그아웃 시 시트를 닫는 책임만 onSignOut 콜백으로 받는다.
struct AccountPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Binding var nicknameDraft: String
    let user: AuthUser
    let onSignOut: () -> Void
    @State private var nicknameDialogOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                nicknameDraft = user.name
                nicknameDialogOpen = true
            } label: {
                HStack {
                    Image(systemName: "person.text.rectangle")
                        .frame(width: 24)
                        .foregroundStyle(AlarmTalkTheme.primaryDark)
                    Text("닉네임")
                        .fontWeight(.medium)
                        .foregroundStyle(AlarmTalkTheme.text)
                    Spacer()
                    Text(user.name.isEmpty ? "이름 없음" : user.name)
                        .font(.subheadline)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .lineLimit(1)
                    Image(systemName: "chevron.right")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
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
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
        }
        .settingsCard(title: "계정")
        .sheet(isPresented: $nicknameDialogOpen) {
            NicknameEditSheet(
                initialName: user.name,
                isBusy: auth.isBusy,
                onDismiss: { nicknameDialogOpen = false },
                onSave: { name in
                    nicknameDraft = name
                    nicknameDialogOpen = false
                    Task { await auth.updateProfile(name: name) }
                }
            )
            .presentationDetents([.medium])
            .interactiveDismissDisabled(auth.isBusy)
        }
    }
}

private struct NicknameEditSheet: View {
    let initialName: String
    let isBusy: Bool
    let onDismiss: () -> Void
    let onSave: (String) -> Void

    @State private var name = ""
    @State private var submitted = false

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var normalizedInitialName: String {
        initialName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        !isBusy && !trimmedName.isEmpty && trimmedName != normalizedInitialName
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("닉네임 수정")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text("공유 이용권과 메시지에서 표시되는 이름이에요.")
                        .font(.subheadline)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                Spacer()
                Button {
                    if !isBusy {
                        onDismiss()
                    }
                } label: {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .frame(width: 32, height: 32)
                        .background(AlarmTalkTheme.surfaceVariant, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(isBusy)
            }

            HStack(spacing: 12) {
                Image(systemName: "person")
                    .font(.title3)
                    .foregroundStyle(AlarmTalkTheme.primary)
                    .frame(width: 42, height: 42)
                    .background(AlarmTalkTheme.surface, in: Circle())
                    .overlay(
                        Circle()
                            .stroke(AlarmTalkTheme.outline, lineWidth: 1)
                    )
                VStack(alignment: .leading, spacing: 4) {
                    Text("앱에서 보일 이름")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text("알람, 메시지, 공유 이용권 화면에서 이 이름을 사용해요.")
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
            .background(AlarmTalkTheme.surfaceVariant.opacity(0.42), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(AlarmTalkTheme.outline, lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("닉네임")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                TextField("예: 규원", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .disabled(isBusy)
                    .onChange(of: name) { _, newValue in
                        if newValue.count > 30 {
                            name = String(newValue.prefix(30))
                        }
                    }
                Text("\(name.count)/30")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                if submitted && trimmedName.isEmpty {
                    Text("닉네임을 입력해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.error)
                }
            }

            // Android `NicknameEditDialog` 처럼 저장 중에는 "저장 중" 으로 표시.
            Button(isBusy ? "저장 중" : "저장") {
                submitted = true
                guard canSave else { return }
                onSave(trimmedName)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .frame(maxWidth: .infinity)
            .disabled(!canSave)

            Spacer(minLength: 0)
        }
        .padding(20)
        .background(AlarmTalkTheme.background)
        .onAppear {
            name = initialName
        }
    }
}

/// 회원 탈퇴 카드 — 별도 카드로 분리해 위험 행동을 시각적으로 격리.
struct DeleteAccountPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    let onDeleted: () -> Void
    @State private var confirming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(role: .destructive) {
                confirming = true
            } label: {
                HStack {
                    Text("회원 탈퇴")
                        .fontWeight(.medium)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            .disabled(auth.isBusy)
        }
        .settingsCard(title: nil)
        // Android `DeleteAccountDialog` (HomeComponents.kt:480) 와 동일한 안내 + 30일 유예 탈퇴.
        .alert("회원 탈퇴", isPresented: $confirming) {
            Button("탈퇴", role: .destructive) {
                Task {
                    await auth.requestAccountDeletion()
                    onDeleted()
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text(
                "정말 탈퇴할까요? 신청 후 30일이 지나면 알람, 음성, 메시지 등 모든 데이터가 "
                    + "영구 삭제돼요. 그 전에 다시 로그인해 탈퇴를 취소하면 복구할 수 있어요."
            )
        }
    }
}

#if DEBUG
private struct AccountPanelPreviewHost: View {
    @State private var nickname = "AlarmTalk"
    var body: some View {
        VStack(spacing: 16) {
            AccountPanel(
                nicknameDraft: $nickname,
                user: AuthUser(
                    id: "u1",
                    email: "preview@alarmtalk.app",
                    name: "AlarmTalk",
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
