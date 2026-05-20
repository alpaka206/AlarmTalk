import SwiftUI

/// 프로필 버튼에서 띄우는 설정 시트.
///
/// ContentView 의 `settingsSheet` 를 옮긴 것. 보조 화면(가족코드/캐릭터/이용권)
/// 진입은 부모(MainTabsView)에 콜백으로 위임한다. 기존의
/// `DispatchQueue.main.asyncAfter(deadline: .now() + 0.25)` 우회는 제거하고,
/// MainTabsView 가 `.sheet(item:).onDismiss` 패턴으로 처리한다.
struct SettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    @State private var nicknameDraft: String = ""
    /// "설정 불가 시간" 편집 모달 표시 플래그.
    @State private var quietDialogOpen: Bool = false

    /// 보조 화면 요청 — 부모가 settingsPresented 를 false 로 만들고,
    /// 시트 dismiss 후 auxiliaryScreen 을 세팅한다.
    let onRequestAuxiliary: (AuxiliaryScreen) -> Void
    /// 사용자가 시트를 닫고 싶을 때(상단 chevron) 호출.
    let onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Button {
                        onClose()
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .buttonStyle(.plain)
                    Text("설정")
                        .font(.title2.weight(.bold))
                }

                VStack(alignment: .leading, spacing: 0) {
                    SettingsRow(label: "화면 모드", value: "시스템")
                }
                .settingsCard(title: "화면")

                VStack(alignment: .leading, spacing: 0) {
                    SettingsActionRow(label: "초대 코드 등록", icon: "qrcode") {
                        onRequestAuxiliary(.people)
                    }
                    Divider()
                    SettingsActionRow(label: "캐릭터", icon: "chart.line.uptrend.xyaxis") {
                        onRequestAuxiliary(.growth)
                    }
                    Divider()
                    SettingsActionRow(label: "이용권", icon: "creditcard") {
                        onRequestAuxiliary(.billing)
                    }
                }
                .settingsCard(title: "프로필")

                AlarmPermissionSection()

                if let user = auth.session?.user {
                    VStack(alignment: .leading, spacing: 0) {
                        SettingsActionRow(
                            label: user.allowFamilyAlarms == true ? "상대방 알람 허용" : "상대방 알람 꺼짐",
                            icon: user.allowFamilyAlarms == true ? "bell.badge" : "bell.slash"
                        ) {
                            Task {
                                await auth.updateProfile(allowFamilyAlarms: !(user.allowFamilyAlarms ?? false))
                                await socialFeatures.refreshAll(session: auth.session)
                            }
                        }
                        Divider()
                        // Android `FamilyAlarmQuietTimeDialog` 와 동등 — 라벨 부분은 현재 값을
                        // 그대로 보여주고, 탭 시 편집 모달을 띄운다.
                        Button {
                            quietDialogOpen = true
                        } label: {
                            HStack {
                                Text("설정 불가 시간")
                                    .fontWeight(.medium)
                                    .foregroundStyle(VoiceAlarmTheme.text)
                                Spacer()
                                Text(HelperFormatters.quietScheduleLabel(user.familyAlarmQuietWindows))
                                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                                    .lineLimit(1)
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .settingsCard(title: "공유 알람")

                    AccountPanel(
                        nicknameDraft: $nicknameDraft,
                        user: user,
                        onSignOut: onClose
                    )

                    DeleteAccountPanel(onDeleted: onClose)
                }
            }
            .padding(20)
        }
        .background(VoiceAlarmTheme.background)
        .onAppear {
            nicknameDraft = auth.session?.user.name ?? ""
        }
        .sheet(isPresented: $quietDialogOpen) {
            FamilyAlarmQuietTimeDialog(
                initialWindows: auth.session?.user.familyAlarmQuietWindows ?? [],
                onCancel: { quietDialogOpen = false },
                onConfirm: { windows in
                    quietDialogOpen = false
                    Task {
                        await auth.updateProfile(quietWindows: windows)
                        await socialFeatures.refreshAll(session: auth.session)
                    }
                }
            )
            .presentationDetents([.large])
        }
    }
}

#if DEBUG
#Preview("SettingsView (light)") {
    NavigationStack {
        SettingsView(
            onRequestAuxiliary: { _ in },
            onClose: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("SettingsView (dark)") {
    NavigationStack {
        SettingsView(
            onRequestAuxiliary: { _ in },
            onClose: {}
        )
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
