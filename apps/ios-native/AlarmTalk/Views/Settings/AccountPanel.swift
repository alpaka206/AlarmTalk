import SwiftUI

/// 계정 카드 — 닉네임 편집, 로그아웃.
///
/// ContentView 의 settingsSheet 내 "계정" 섹션을 빼낸 것. 부모(SettingsView)는
/// 로그아웃 시 시트를 닫는 책임만 onSignOut 콜백으로 받는다.
struct AccountPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Binding var nicknameDraft: String

    /// 상한을 **넘겨 쳤을 때만** true. 정확히 상한이면 false 다 —
    /// 잘라 돌려준 값을 IME 가 되돌려 보내면 경고가 곧바로 꺼져 깜빡이기 때문이다.
    private var nicknameOverLimit: Bool {
        Array(InputSanitizer.sanitizeDisplayName(nicknameDraft).utf16).count
            > InputSanitizer.displayNameMaxLength
    }
    let user: AuthUser
    let onSignOut: () -> Void
    @State private var nicknameDialogOpen = false
    @State private var logoutConfirming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                nicknameDraft = user.name
                nicknameDialogOpen = true
            } label: {
                HStack {
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
                // ⚠ **`.contentShape` 가 없으면 글자만 눌린다.** `HStack` 의 빈 곳
                // (Spacer·여백)은 히트테스트 대상이 아니라, 행처럼 생겼는데 가장자리를
                // 누르면 아무 일도 안 일어난다. 공용 `SettingsValueButton` 은 이미
                // 넣어 두었는데 이 두 행만 직접 만들면서 빠졌다.
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Divider()
            Button {
                // ⚠ **즉시 로그아웃하지 않는다.** 누르는 순간 나가지면 잘못 눌렀을 때
                // 되돌릴 수 없다(안드로이드 `SettingsScreen.kt:143-147` 도 확인을 먼저 띄운다).
                logoutConfirming = true
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
                // ⚠ **`.contentShape` 가 없으면 글자만 눌린다.** `HStack` 의 빈 곳
                // (Spacer·여백)은 히트테스트 대상이 아니라, 행처럼 생겼는데 가장자리를
                // 누르면 아무 일도 안 일어난다. 공용 `SettingsValueButton` 은 이미
                // 넣어 두었는데 이 두 행만 직접 만들면서 빠졌다.
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .settingsCard(title: "계정")
        // ⚠ **확인형 모달은 시스템 `.alert` 다.** 예전에는 커스텀 시트였고, 안드로이드에
        // 없는 부제·아이콘 카드에 **금지된 상시 카운터(N/30)** 까지 달려 있었다.
        // CLAUDE.md: "항상 켜진 카운터는 넘기 전까진 알려 줄 게 없어 두지 않는다."
        .alert("닉네임 수정", isPresented: $nicknameDialogOpen) {
            TextField("예: 규원", text: $nicknameDraft)
                .textInputAutocapitalization(.never)
            Button("저장") {
                let name = InputSanitizer.clampDisplayName(
                    InputSanitizer.sanitizeDisplayName(nicknameDraft)
                )
                guard !name.isEmpty else { return }
                Task { await auth.updateProfile(name: name) }
            }
            .disabled(
                auth.isBusy
                    || InputSanitizer.sanitizeDisplayName(nicknameDraft)
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .isEmpty
            )
            Button("닫기", role: .cancel) {}
        } message: {
            // ⚠ **말없이 자르지 않는다.** 넘겨 친 순간에만 이유를 말한다 —
            // 정확히 상한일 때는 켜지 않는다(잘라 돌려준 값을 IME 가 되돌려 보내면
            // 경고가 곧바로 꺼져 깜빡인다).
            if nicknameOverLimit {
                Text("이름은 \(InputSanitizer.displayNameMaxLength)자까지 쓸 수 있어요.")
            }
        }
        .onChange(of: nicknameDialogOpen) { _, open in
            if open { nicknameDraft = user.name }
        }
        .alert("로그아웃할까요?", isPresented: $logoutConfirming) {
            Button("취소", role: .cancel) { }
            Button("로그아웃", role: .destructive) {
                auth.signOut()
                onSignOut()
            }
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
