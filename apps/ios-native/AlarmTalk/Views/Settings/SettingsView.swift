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
    @State private var themeDialogOpen: Bool = false
    @State private var weatherDialogOpen: Bool = false
    @State private var fortuneDialogOpen: Bool = false
    @State private var holidayDialogOpen: Bool = false
    @State private var promptPreferences: DynamicPromptPreferences = .loadFromDefaults()

    /// Android `SettingsScreen.kt:150,156` 의 약관/방침 외부 링크.
    private static let termsURL = URL(string: "https://alarm-talk.com/ko/terms")!
    private static let privacyURL = URL(string: "https://alarm-talk.com/ko/privacy")!

    /// 사용자가 시트를 닫고 싶을 때(상단 X) 호출.
    let onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Button {
                        onClose()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .foregroundStyle(AlarmTalkTheme.textSecondary)
                            .frame(width: 32, height: 32)
                            .background(AlarmTalkTheme.surfaceVariant, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("닫기"))
                    Text("설정")
                        .font(.title2.weight(.bold))
                }

                // Android `SettingsScreen.kt:104-118` 의 '화면' 카드 — 테마 + 공휴일 달력.
                VStack(alignment: .leading, spacing: 0) {
                    SettingsValueButton(
                        label: "테마",
                        value: currentThemeMode.label,
                        action: { themeDialogOpen = true }
                    )
                    Divider()
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

                    MarketingConsentSection()
                }

                if auth.session?.user != nil {
                    DeleteAccountPanel(onDeleted: onClose)
                }

                HStack(spacing: 6) {
                    Link("서비스 이용약관", destination: Self.termsURL)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(AlarmTalkTheme.textSecondary)

                    Text("·")
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)

                    Link("개인정보 처리방침", destination: Self.privacyURL)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 4)
            }
            .padding(20)
        }
        .background(AlarmTalkTheme.background)
        .onAppear {
            nicknameDraft = auth.session?.user.name ?? ""
            loadPromptPreferences()
        }
        .onChange(of: auth.session?.user.dynamicPromptSettings) { _, _ in
            loadPromptPreferences()
        }
        .sheet(isPresented: $themeDialogOpen) {
            ThemeModePickerSheet(
                current: currentThemeMode,
                onDismiss: { themeDialogOpen = false },
                onSelect: { mode in
                    themeModeRaw = mode.rawValue
                    themeDialogOpen = false
                }
            )
            .presentationDetents([.medium])
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
private struct SettingsValueButton: View {
    let label: String
    var value: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(label)
                    .fontWeight(.medium)
                    .foregroundStyle(AlarmTalkTheme.text)
                Spacer(minLength: 12)
                if let value {
                    Text(value)
                        .font(.subheadline)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.right")
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// 라벨 + 설명 + 스위치 토글 행. Android `SettingsToggleRow`(SettingsScreenComponents.kt:112-143).
private struct SettingsToggleRow: View {
    let label: String
    let description: String
    @Binding var isOn: Bool
    var enabled: Bool = true

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .fontWeight(.medium)
                    .foregroundStyle(AlarmTalkTheme.text)
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(AlarmTalkTheme.primary)
                .disabled(!enabled)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

/// '마케팅 수신' 카드. Android `SettingsScreen.kt:161-190` 의 3-상태(로드 완료·로드 실패·로드 전)를
/// 이식한다. AuthViewModel 의 `loadMarketingConsent`/`updateMarketingConsent` 를 호출하며,
/// 로드 완료 여부(`loaded`)와 쓰기 진행 여부(`busy`)는 화면 로컬 상태로 추적한다.
private struct MarketingConsentSection: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var loaded = false
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if loaded {
                // 로드 완료: 정상 토글. 쓰기 진행 중엔 연속 토글로 인한 opt-out 유실을 막아 비활성화.
                SettingsToggleRow(
                    label: "광고성 정보 수신",
                    description: "혜택·이벤트 소식을 받아요. 언제든 끌 수 있어요.",
                    isOn: Binding(
                        get: { auth.marketingConsentAgreed },
                        set: { newValue in
                            guard newValue != auth.marketingConsentAgreed else { return }
                            Task {
                                busy = true
                                await auth.updateMarketingConsent(newValue)
                                busy = false
                            }
                        }
                    ),
                    enabled: !busy
                )
            } else if auth.marketingConsentLoadFailed {
                // 로드 실패: 'off'로 오인되지 않게 토글 대신 다시 시도 행을 보여준다.
                SettingsValueButton(
                    label: "광고성 정보 수신",
                    value: "불러오지 못했어요 · 다시 시도",
                    action: { Task { await load() } }
                )
            } else {
                // 로드 전: 비활성 토글 + '불러오는 중…'으로 미로드 상태를 명확히 한다.
                SettingsToggleRow(
                    label: "광고성 정보 수신",
                    description: "불러오는 중…",
                    isOn: .constant(false),
                    enabled: false
                )
            }
        }
        .settingsCard(title: "마케팅 수신")
        .task(id: auth.session?.user.id) {
            await load()
        }
    }

    private func load() async {
        loaded = false
        await auth.loadMarketingConsent()
        if !auth.marketingConsentLoadFailed {
            loaded = true
        }
    }
}

/// '공휴일 달력' 국가 선택 시트. Android `HolidayCountryPickerDialog`(SettingsScreen.kt:283-321)
/// 의 라디오 목록을 이식 — 행을 누르면 즉시 적용하고 닫는다.
private struct HolidayCountryPickerSheet: View {
    let current: String
    let onDismiss: () -> Void
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsSheetHeader(title: "공휴일 달력", onDismiss: onDismiss)
            VStack(spacing: 4) {
                ForEach(HolidayStore.supportedCountryCodes, id: \.self) { code in
                    Button {
                        onSelect(code)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: code == current ? "largecircle.fill.circle" : "circle")
                                .font(.title3)
                                .foregroundStyle(code == current ? AlarmTalkTheme.primary : AlarmTalkTheme.textSecondary)
                            Text("\(HolidayCountryFlag.emoji(for: code)) \(HolidayStore.localizedCountryName(code))")
                                .foregroundStyle(AlarmTalkTheme.text)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(AlarmTalkTheme.background)
    }
}

private struct ThemeModePickerSheet: View {
    let current: AlarmTalkThemeMode
    let onDismiss: () -> Void
    let onSelect: (AlarmTalkThemeMode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsSheetHeader(title: "테마 선택", subtitle: "휴대폰 설정과 앱 화면 모드를 선택해요.", onDismiss: onDismiss)
            VStack(spacing: 10) {
                ForEach(AlarmTalkThemeMode.allCases) { mode in
                    Button {
                        onSelect(mode)
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(mode == current ? AlarmTalkTheme.primary : AlarmTalkTheme.surface)
                                    .overlay(
                                        Circle()
                                            .stroke(AlarmTalkTheme.outline, lineWidth: 1)
                                    )
                                Image(systemName: mode.systemImage)
                                    .font(.title3)
                                    .foregroundStyle(mode == current ? Color.white : AlarmTalkTheme.primary)
                            }
                            .frame(width: 42, height: 42)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(mode.pickerTitle)
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(AlarmTalkTheme.text)
                                Text(mode.subtitle)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                            }
                            Spacer()
                            if mode == current {
                                Text("선택됨")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color.white)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(AlarmTalkTheme.primary, in: Capsule())
                            }
                        }
                        .padding(14)
                        .background(
                            mode == current
                                ? AlarmTalkTheme.primary.opacity(0.16)
                                : AlarmTalkTheme.surfaceVariant.opacity(0.42),
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(mode == current ? AlarmTalkTheme.primary.opacity(0.52) : AlarmTalkTheme.outline, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(AlarmTalkTheme.background)
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
        .background(AlarmTalkTheme.background)
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
        .background(AlarmTalkTheme.background)
        .onAppear {
            gender = FortunePromptInputFormat.normalizedGender(initial.fortuneGender)
            birthDate = FortunePromptInputFormat.normalizedBirthDate(initial.fortuneBirthDate)
            birthTime = FortunePromptInputFormat.normalizedBirthTime(initial.fortuneBirthTime)
        }
    }
}

private struct SettingsSheetHeader: View {
    let title: String
    var subtitle: String? = nil
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
