import SwiftUI

/// '더보기' 탭. 안드로이드 `MenuTabPanel`(`ui/home/HomeComponents.kt`) 미러.
/// (⚠ `MenuScreen` 이라는 파일·컴포저블은 안드로이드에 없다 — 옛 주석이 틀렸다.)
///
/// 카드 구성(위→아래)은 스크린샷 그대로다:
///   1. 프로필 — 이름 + "내 정보 · 앱 설정"
///   2. 화면 테마 · 앱 언어
///   3. 이용권
///   4. 회원 탈퇴
///   5. 앱 버전
///
/// ⚠ 이 화면은 **라우팅만** 한다. 실제 설정 항목(공휴일 달력·문구 정보·알림 등)은
/// 프로필 카드가 여는 `SettingsView` 안에 있다 — 여기에 옮겨 오지 말 것.
struct MenuView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @AppStorage(AlarmTalkThemeMode.storageKey) private var themeModeRaw = AlarmTalkThemeMode.system.rawValue

    /// 프로필(내 정보 · 앱 설정) 진입.
    let onOpenSettings: () -> Void
    /// 이용권 화면 진입.
    let onOpenBilling: () -> Void

    @State private var themeDialogOpen = false
    @State private var deleteConfirming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            profileCard

            VStack(alignment: .leading, spacing: 0) {
                SettingsValueButton(
                    label: "화면 테마",
                    value: currentThemeMode.label,
                    action: { themeDialogOpen = true }
                )
                Divider()
                SettingsValueButton(
                    label: "앱 언어",
                    value: appLanguageLabel,
                    // iOS 는 앱별 언어를 시스템 설정에서만 바꾼다 — 앱 안에 고르는 화면이 없다.
                    action: { openAppSettings() }
                )
            }
            .settingsCard(title: nil)

            VStack(alignment: .leading, spacing: 0) {
                // 코드를 넣는 행을 두지 않는다 — 유료 기능은 스토어 결제로만 연다(`docs/spec/plan-gates.md`).
                SettingsValueButton(label: "이용권", action: onOpenBilling)
            }
            .settingsCard(title: nil)

            VStack(alignment: .leading, spacing: 0) {
                Button {
                    deleteConfirming = true
                } label: {
                    HStack {
                        Text(String(localized: "회원 탈퇴"))
                            .fontWeight(.medium)
                            .foregroundStyle(theme.palette.onSurface)
                        Spacer(minLength: 12)
                        Image(systemName: "chevron.right")
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // 탈퇴 신청 실패 — 알럿은 이미 닫혔으니 그 행 아래에 빨간 글자로 남긴다(다시 신청하면 지운다).
                if let message = auth.actionErrorMessage(for: .accountDeletion) {
                    Text(message)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.error)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                }
            }
            .settingsCard(title: nil)

            Text(String(localized: "앱 버전 \(Self.appVersion)"))
                .font(.footnote)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .bottomSheet(isPresented: $themeDialogOpen, onDismiss: { themeDialogOpen = false }) {
            ThemeModePickerSheet(
                current: currentThemeMode,
                onSelect: { mode in
                    themeModeRaw = mode.rawValue
                    themeDialogOpen = false
                }
            )
            // 높이는 `SelectionSheet` 가 내용에 맞춰 잡는다(위 주석 참조).
        }
        // 30일 유예 탈퇴. 즉시 삭제가 아니라는 것을 문구가 분명히 말해야 한다.
        .alert(String(localized: "정말 탈퇴할까요?"), isPresented: $deleteConfirming) {
            Button(String(localized: "탈퇴"), role: .destructive) {
                Task { await auth.requestAccountDeletion() }
            }
            Button(String(localized: "취소"), role: .cancel) {}
        } message: {
            Text(String(localized: "30일 뒤에 계정과 모든 데이터가 영구 삭제돼요. 그 전에 다시 로그인하면 탈퇴를 취소할 수 있어요."))
        }
    }

    private var profileCard: some View {
        Button(action: onOpenSettings) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(theme.palette.onSurface)
                        .lineLimit(1)
                    Text(String(localized: "내 정보 · 앱 설정"))
                        .font(.subheadline)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer(minLength: 12)
                Image(systemName: "chevron.right")
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .settingsCard(title: nil)
    }

    private var displayName: String {
        // 닉네임은 없앴다(2026-10-29) — 로그인한 계정의 이메일을 보인다(안드로이드 더보기 머리도 같다).
        auth.session?.user.email.nilIfBlank ?? String(localized: "내 계정")
    }

    private var currentThemeMode: AlarmTalkThemeMode {
        AlarmTalkThemeMode.normalized(themeModeRaw)
    }

    /// 지금 앱이 실제로 쓰는 언어. iOS 는 앱별 언어를 시스템 설정에서 바꾸므로
    /// 여기서는 **현재 값을 보여주기만** 한다.
    private var appLanguageLabel: String {
        switch VoiceStudioViewModel.appVoiceLanguage() {
        case "en": return "English"
        case "ja": return "日本語"
        default: return "한국어"
        }
    }

    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
}

#if DEBUG
#Preview("더보기") {
    ScrollView {
        MenuView(onOpenSettings: {}, onOpenBilling: {})
            .padding()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("더보기 (dark)") {
    ScrollView {
        MenuView(onOpenSettings: {}, onOpenBilling: {})
            .padding()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
