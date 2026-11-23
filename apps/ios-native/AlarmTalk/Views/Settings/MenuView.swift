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
        // 카드 사이 16 — 안드로이드 `MenuTabPanel` 의 `spacedBy(16.dp)`.
        VStack(alignment: .leading, spacing: 16) {
            profileCard

            VStack(alignment: .leading, spacing: 0) {
                SettingsValueButton(
                    label: "화면 테마",
                    value: currentThemeMode.label,
                    verticalPadding: 8,
                    action: { themeDialogOpen = true }
                )
                // 좌우 8·위아래 4 들인 선 — 안드로이드 `MenuTabPanel` 의 테마·언어 사이 `HorizontalDivider` 와 같다.
                SettingsDivider()
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                SettingsValueButton(
                    label: "앱 언어",
                    value: appLanguageLabel,
                    verticalPadding: 8,
                    // iOS 는 앱별 언어를 시스템 설정에서만 바꾼다 — 앱 안에 고르는 화면이 없다.
                    action: { openAppSettings() }
                )
            }
            .settingsCard(title: nil)

            VStack(alignment: .leading, spacing: 0) {
                // 코드를 넣는 행을 두지 않는다 — 유료 기능은 스토어 결제로만 연다(`docs/spec/plan-gates.md`).
                SettingsValueButton(label: "이용권", verticalPadding: 8, action: onOpenBilling)
            }
            .settingsCard(title: nil)

            VStack(alignment: .leading, spacing: 0) {
                // ⚠ **행을 빨갛게 칠하지 말 것**(2026-08-17 지시). 탈퇴도 이 행에서는 아무 일도 일어나지 않는다 — 확인 알럿의
                // [탈퇴] 가 빨강이고, 거기서만 되돌릴 수 없는 일이 벌어진다(안드로이드 `MenuTabPanel` 의 탈퇴 행도 같다).
                // 신청이 도는 동안(`auth.isBusy`)에는 행을 잠그고 꺾쇠 자리에 진행 표시를 그린다 — 안드로이드는 확인 창을 연 채
                // 버튼을 잠그는데(`DeleteAccountConfirmDialog` 의 `busy`), 시스템 알럿은 누르는 순간 닫혀 그 자리가 없다.
                SettingsValueButton(
                    label: "회원 탈퇴",
                    verticalPadding: 8,
                    showsProgress: auth.isBusy,
                    action: { deleteConfirming = true }
                )
                .disabled(auth.isBusy)
                // 탈퇴 신청 실패 — 알럿은 이미 닫혔으니 그 행 아래에 빨간 글자로 남긴다(다시 신청하면 지운다).
                // 행 이름과 같은 시작선이다(행 안쪽 12).
                if let message = auth.actionErrorMessage(for: .accountDeletion) {
                    Text(message)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.error)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 10)
                }
            }
            .settingsCard(title: nil)

            // 버전 줄 — 안드로이드 `MenuTabPanel` 과 같은 bodySmall(12)·위 4.
            Text(String(localized: "앱 버전 \(Self.appVersion)"))
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 4)
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

    /// 프로필 카드 — 안드로이드 `MenuTabPanel` 의 프로필 `Surface` 와 같은 값이다: 안쪽 여백 16, 이메일 titleMedium Bold
    /// (길면 줄을 바꿔 다 보인다), 부제 bodySmall(12), 꺾쇠 칸 22, 사이 14. 카드 하나가 곧 행 하나라 설정 카드의 안쪽 여백(8)을
    /// 거치지 않는다(`settingsSurface`).
    private var profileCard: some View {
        Button(action: onOpenSettings) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName)
                        .font(theme.typography.titleMedium)
                        .fontWeight(.bold)
                        .foregroundStyle(theme.palette.onSurface)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(String(localized: "내 정보 · 앱 설정"))
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                SettingsChevron(size: 22)
            }
            .padding(16)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleButtonStyle())
        .settingsSurface()
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
