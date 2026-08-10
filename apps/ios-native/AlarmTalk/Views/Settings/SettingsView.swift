import SwiftUI

/// 프로필 버튼에서 띄우는 설정 시트.
///
/// Android 설정 화면과 동일하게 화면/랜덤 문구/계정 편집만 다룬다.
/// 코드/이용권/공유 이용권 진입은 MainTabsView 의 프로필 메뉴가 맡는다.
struct SettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var holidayStore: HolidayStore
    @AppStorage(AlarmTalkThemeMode.storageKey) private var themeModeRaw = AlarmTalkThemeMode.system.rawValue

    @State private var nicknameDraft: String = ""
    @State private var weatherDialogOpen: Bool = false
    @State private var fortuneDialogOpen: Bool = false
    @State private var holidayDialogOpen: Bool = false
    @State private var promptPreferences: DynamicPromptPreferences = .loadFromDefaults()
    @State private var legalDestination: LegalDestination?

    /// 설정 하단 '법적 정보' 카드가 여는 화면들.
    enum LegalDestination: String, Identifiable, Hashable {
        case consentHistory
        case ossLicenses
        case terms
        case privacy
        var id: String { rawValue }
    }

    /// Android `SettingsScreen.kt:150,156` 의 약관/방침 외부 링크.
    private static let termsURL = URL(string: "https://alarm-talk.com/ko/terms")!
    private static let privacyURL = URL(string: "https://alarm-talk.com/ko/privacy")!

    /// 이 화면을 떠나야 할 때(로그아웃 직후) 호출. **닫기 버튼용이 아니다** — 아래 참조.
    let onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // ⚠ **상단 X 도, 본문 제목도 다시 넣지 말 것.** 이 화면은 시트가 아니라
                // push 라 네비게이션 바가 뒤로가기와 제목을 이미 그린다. X 를 같이 두면
                // 같은 일을 하는 탈출구가 둘이 되고(CLAUDE.md 「모달」), 본문에 제목을 또
                // 두면 '설정' 이 화면에 두 번 나온다. 안드로이드는 상단바가 없어서 본문에
                // 셰브론+제목 행을 직접 그리는 것이고(`ui/settings/SettingsScreen.kt`),
                // iOS 에서 그 자리를 맡는 게 네비게이션 바다 — 같은 것의 두 표현이다.
                // `onClose` 는 로그아웃 뒤 화면을 뜨는 데만 남는다.

                // ⚠ **'테마' 행을 여기 다시 넣지 말 것.** 테마는 더보기 탭에서만 바꾼다
                // (안드로이드 `SettingsScreen.kt:98-107` 주석: "테마·앱 언어는 전체 탭에서
                // 관리한다"). 양쪽에 두면 같은 값을 바꾸는 자리가 둘이 되어, 한쪽만
                // 고쳤을 때 다른 쪽이 옛 값을 보여준다.
                VStack(alignment: .leading, spacing: 0) {
                    SettingsValueButton(
                        label: "공휴일 달력",
                        value: holidayCountryLabel,
                        action: { holidayDialogOpen = true }
                    )
                }
                .settingsCard(title: "화면")

                VStack(alignment: .leading, spacing: 0) {
                    SettingsValueButton(
                        label: "날씨 지역",
                        value: weatherLocationLabel,
                        action: { weatherDialogOpen = true }
                    )
                    Divider()
                    SettingsValueButton(
                        label: "운세 정보",
                        value: fortuneInfoLabel,
                        action: { fortuneDialogOpen = true }
                    )
                }
                .settingsCard(title: "랜덤 문구 정보")

                if let user = auth.session?.user {
                    AccountPanel(
                        nicknameDraft: $nicknameDraft,
                        user: user,
                        onSignOut: onClose
                    )

                    // ⚠ 마케팅 수신 토글은 여기가 아니라 **동의 내역 화면의 '선택 동의'**
                    // 섹션에 있다(안드로이드와 같은 위치). 법정 동의와 나란히 두는 게
                    // 개인정보보호법 제22조의 구분 수령 취지에도 맞는다.
                }

                // ⚠ **회원 탈퇴는 더보기 탭 한 곳뿐이다.** 예전에는 여기와 더보기 양쪽에
                // 있었고 확인 문구까지 서로 달랐다 — 같은 행동을 두 문구로 설명하면
                // 어느 쪽이 진짜인지 알 수 없다(안드로이드는 더보기에만 둔다).

                // 법적 정보 — 처리방침·약관 접근과 오픈소스 고지는 스토어·법적 요구라
                // 앱 안에 유지해야 한다(안드로이드 `SettingsScreen.kt:154-171`).
                // ⚠ 예전에는 여기 웹 `Link` 두 개뿐이었다 — 외부 Safari 로 나가는 데다
                // **동의 내역(생체정보 철회) 경로가 앱에 아예 없었다.**
                VStack(alignment: .leading, spacing: 0) {
                    SettingsValueButton(label: "약관 및 개인정보 처리 동의") {
                        legalDestination = .consentHistory
                    }
                    Divider().padding(.horizontal, 8).padding(.vertical, 4)
                    SettingsValueButton(label: "오픈소스 라이선스") {
                        legalDestination = .ossLicenses
                    }
                }
                .settingsCard(title: "법적 정보")
            }
            .padding(20)
        }
        .homeGradientBackground()
        // 제목은 네비게이션 바가 그린다(본문에 또 두지 않는다 — 위 주석).
        .navigationTitle("설정")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $legalDestination) { destination in
            switch destination {
            case .consentHistory:
                ConsentHistoryView(
                    onOpenTerms: { legalDestination = .terms },
                    onOpenPrivacy: { legalDestination = .privacy }
                )
            case .ossLicenses:
                OssLicensesView()
            case .terms:
                LegalDocumentView(title: "서비스 이용약관", url: Self.termsURL)
            case .privacy:
                LegalDocumentView(title: "개인정보 처리방침", url: Self.privacyURL)
            }
        }
        .onAppear {
            nicknameDraft = auth.session?.user.name ?? ""
            loadPromptPreferences()
        }
        .onChange(of: auth.session?.user.dynamicPromptSettings) { _, _ in
            loadPromptPreferences()
        }
        .sheet(isPresented: $weatherDialogOpen) {
            WeatherLocationPreferenceSheet(
                initial: promptPreferences,
                onDismiss: { weatherDialogOpen = false },
                onSave: { country, city in
                    var next = promptPreferences
                    next.weatherCountry = country
                    next.weatherCity = city
                    savePromptPreferences(next)
                    weatherDialogOpen = false
                }
            )
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $fortuneDialogOpen) {
            FortuneInfoPreferenceSheet(
                initial: promptPreferences,
                onDismiss: { fortuneDialogOpen = false },
                onSave: { gender, birthDate, birthTime in
                    var next = promptPreferences
                    next.fortuneGender = gender
                    next.fortuneBirthDate = birthDate
                    next.fortuneBirthTime = birthTime
                    savePromptPreferences(next)
                    fortuneDialogOpen = false
                }
            )
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $holidayDialogOpen) {
            HolidayCountryPickerSheet(
                current: holidayStore.selectedCountryCode,
                onDismiss: { holidayDialogOpen = false },
                onSelect: { code in
                    holidayStore.selectedCountryCode = code
                    holidayDialogOpen = false
                }
            )
            .presentationDetents([.medium])
        }
    }

    private var currentThemeMode: AlarmTalkThemeMode {
        AlarmTalkThemeMode.normalized(themeModeRaw)
    }

    /// '화면' 카드의 '공휴일 달력' 값 — 국기 + 국가명. Android `holidayCountryDisplayLabel`.
    private var holidayCountryLabel: String {
        let code = holidayStore.selectedCountryCode
        return "\(HolidayCountryFlag.emoji(for: code)) \(HolidayStore.localizedCountryName(code))"
    }

    private var weatherLocationLabel: String {
        promptPreferences.weatherReady
            ? "\(promptPreferences.weatherCountry) \(promptPreferences.weatherCity)"
            : "미설정"
    }

    private var fortuneInfoLabel: String {
        promptPreferences.fortuneReady
            ? [promptPreferences.fortuneGender, promptPreferences.fortuneBirthDate, promptPreferences.fortuneBirthTime].joined(separator: " · ")
            : "미설정"
    }

    private func loadPromptPreferences() {
        let server = DynamicPromptPreferences.from(settings: auth.session?.user.dynamicPromptSettings)
        if server != DynamicPromptPreferences() {
            promptPreferences = server
            server.saveToDefaults()
        } else {
            promptPreferences = .loadFromDefaults()
        }
    }

    private func savePromptPreferences(_ preferences: DynamicPromptPreferences) {
        promptPreferences = preferences
        preferences.saveToDefaults()
        Task {
            await auth.updateProfile(dynamicPromptSettings: preferences.toSettings())
            await socialFeatures.refreshAll(session: auth.session, force: true)
        }
    }
}

/// 라벨 + (선택) 값 + chevron 클릭 행. Android `SettingsRow`(SettingsScreenComponents.kt:77-110)
/// 와 동일하게 선행 아이콘은 두지 않는다.
/// 라벨 + (선택) 값 + chevron 행. 설정·더보기 두 화면이 함께 쓴다.
struct SettingsValueButton: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let label: LocalizedStringKey
    var value: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(label)
                    .fontWeight(.medium)
                    .foregroundStyle(theme.palette.onSurface)
                Spacer(minLength: 12)
                if let value {
                    // ⚠ **값은 primary 로 강조한다.** 라벨과 값이 둘 다 무채색이면
                    // 어느 쪽이 현재 설정값인지 안 읽힌다(안드로이드
                    // `SettingsScreenComponents.kt:111-121` 도 primary + SemiBold).
                    Text(value)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(theme.palette.primary)
                        .lineLimit(1)
                        .multilineTextAlignment(.trailing)
                }
                Image(systemName: "chevron.right")
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// 라벨 + 설명 + 스위치 토글 행.
/// (⚠ 안드로이드에 `SettingsToggleRow` 라는 이름은 없다 — 옛 주석이 틀렸다.
///  같은 모양의 행은 `ui/settings/ConsentHistoryScreen.kt` 의 `ConsentToggleRow` 다.)
/// '마케팅 수신' 카드. Android `ui/settings/SettingsScreen.kt` 의 3-상태(로드 완료·로드 실패·로드 전)를
/// 이식한다. AuthViewModel 의 `loadMarketingConsent`/`updateMarketingConsent` 를 호출하며,
/// 로드 완료 여부(`loaded`)와 쓰기 진행 여부(`busy`)는 화면 로컬 상태로 추적한다.
/// '공휴일 달력' 국가 선택 시트. Android `HolidayCountryPickerDialog`(`ui/settings/SettingsScreen.kt`)
/// 의 라디오 목록을 이식 — 행을 누르면 즉시 적용하고 닫는다.
/// 선택 시트는 공용 껍데기(`SelectionSheet`)를 쓴다 — 라디오 원·'선택됨' 알약을
/// 화면마다 새로 만들지 않는다(자세한 이유는 `SelectionSheet` 주석).
private struct HolidayCountryPickerSheet: View {
    let current: String
    let onDismiss: () -> Void
    let onSelect: (String) -> Void

    private struct CountryCode: Identifiable { let id: String }

    var body: some View {
        SelectionSheet(
            title: "공휴일 달력",
            items: HolidayStore.supportedCountryCodes.map(CountryCode.init),
            selectedID: current,
            onSelect: { onSelect($0.id) }
        ) { item in
            Text("\(HolidayCountryFlag.emoji(for: item.id)) \(HolidayStore.localizedCountryName(item.id))")
                .foregroundStyle(AlarmTalkTheme.text)
        }
    }
}

/// 테마 선택 — 공용 시트를 쓴다(아이콘 + 제목 + 설명 라벨).
struct ThemeModePickerSheet: View {
    let current: AlarmTalkThemeMode
    let onDismiss: () -> Void
    let onSelect: (AlarmTalkThemeMode) -> Void

    var body: some View {
        SelectionSheet(
            title: "화면 테마",
            items: AlarmTalkThemeMode.allCases,
            selectedID: current.id,
            onSelect: onSelect
        ) { mode in
            HStack(spacing: 12) {
                Image(systemName: mode.systemImage)
                    .font(.title3)
                    .foregroundStyle(AlarmTalkTheme.primary)
                    .frame(width: 32)
                VStack(alignment: .leading, spacing: 3) {
                    Text(mode.pickerTitle)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text(mode.subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }
        }
    }
}

private struct WeatherLocationPreferenceSheet: View {
    let initial: DynamicPromptPreferences
    let onDismiss: () -> Void
    let onSave: (String, String) -> Void

    @State private var country = ""
    @State private var city = ""
    @State private var submitted = false

    private var countryValue: String { WeatherLocationInputFields.clean(country) }
    private var cityValue: String { WeatherLocationInputFields.clean(city) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsSheetHeader(
                title: "날씨 지역",
                onDismiss: onDismiss
            )
            WeatherLocationInputFields(
                country: $country,
                city: $city,
                submitted: submitted
            )
            Button("저장") {
                submitted = true
                guard !countryValue.isEmpty, !cityValue.isEmpty else { return }
                onSave(countryValue, cityValue)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(20)
        .homeGradientBackground()
        .onAppear {
            country = initial.weatherCountry
            city = initial.weatherCity
        }
    }
}

private struct FortuneInfoPreferenceSheet: View {
    let initial: DynamicPromptPreferences
    let onDismiss: () -> Void
    let onSave: (String, String, String) -> Void

    @State private var gender = ""
    @State private var birthDate = ""
    @State private var birthTime = ""
    @State private var submitted = false

    private var birthDateValue: String { FortunePromptInputFormat.normalizedBirthDate(birthDate) }
    private var birthTimeValue: String { FortunePromptInputFormat.normalizedBirthTime(birthTime) }
    private var isValid: Bool {
        FortunePromptInputFormat.isComplete(
            gender: gender,
            birthDate: birthDate,
            birthTime: birthTime
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsSheetHeader(
                title: "운세 정보",
                subtitle: "운세가 들어간 랜덤 깨움말을 만들 때만 사용해요.",
                onDismiss: onDismiss
            )
            FortunePromptInputFields(
                gender: $gender,
                birthDate: $birthDate,
                birthTime: $birthTime,
                submitted: submitted
            )
            Button("저장") {
                submitted = true
                guard isValid else { return }
                onSave(FortunePromptInputFormat.normalizedGender(gender), birthDateValue, birthTimeValue)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(20)
        .homeGradientBackground()
        .onAppear {
            gender = FortunePromptInputFormat.normalizedGender(initial.fortuneGender)
            birthDate = FortunePromptInputFormat.normalizedBirthDate(initial.fortuneBirthDate)
            birthTime = FortunePromptInputFormat.normalizedBirthTime(initial.fortuneBirthTime)
        }
    }
}

private struct SettingsSheetHeader: View {
    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey? = nil
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(AlarmTalkTheme.text)
                if let subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                    .frame(width: 32, height: 32)
                    .background(AlarmTalkTheme.surfaceVariant, in: Circle())
            }
            .buttonStyle(.plain)
        }
    }
}

#if DEBUG
#Preview("SettingsView (light)") {
    NavigationStack {
        SettingsView(
            onClose: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("SettingsView (dark)") {
    NavigationStack {
        SettingsView(
            onClose: {}
        )
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
