import SwiftUI

/// 계정 카드 — 로그아웃. 닉네임은 2026-10-29 에 없앴다(오너 — 혼자 쓰는 앱이라 부를 이름이 필요 없다).
///
/// ContentView 의 settingsSheet 내 "계정" 섹션을 빼낸 것. 부모(SettingsView)는
/// 로그아웃 시 시트를 닫는 책임만 onSignOut 콜백으로 받는다.
struct AccountPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    let user: AuthUser
    let onSignOut: () -> Void
    @State private var logoutConfirming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                // ⚠ **즉시 로그아웃하지 않는다.** 누르는 순간 나가지면 잘못 눌렀을 때
                // 되돌릴 수 없다(안드로이드 `SettingsScreen.kt:135-139` 도 확인을 먼저 띄운다).
                logoutConfirming = true
            } label: {
                HStack {
                    Text(String(localized: "로그아웃"))
                        .fontWeight(.medium)
                        // ⚠ **행을 빨갛게 칠하지 말 것**(2026-08-17 지시 "굳이 밖에서부터
                        // 강조를 해야 해?"). 이 행은 문일 뿐이고, 되돌릴 수 없는 일은
                        // 아래 알럿의 `role: .destructive` 액션에서 벌어진다.
                        // 안드로이드도 같다(`SettingsScreen.kt` 의 로그아웃 행).
                        .foregroundStyle(AlarmTalkTheme.text)
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
        .settingsCard(title: String(localized: "계정"))
        // ⚠ **확인형 모달은 시스템 `.alert` 다.** 예전에는 커스텀 시트였고, 안드로이드에
        // 없는 부제·아이콘 카드에 **금지된 상시 카운터(N/30)** 까지 달려 있었다.
        // CLAUDE.md: "항상 켜진 카운터는 넘기 전까진 알려 줄 게 없어 두지 않는다."
        .alert(String(localized: "로그아웃할까요?"), isPresented: $logoutConfirming) {
            Button(String(localized: "취소"), role: .cancel) { }
            Button(String(localized: "로그아웃"), role: .destructive) {
                auth.signOutExplicitly()
                onSignOut()
            }
        }
    }
}

#if DEBUG
private struct AccountPanelPreviewHost: View {
    var body: some View {
        VStack(spacing: 16) {
            AccountPanel(
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
