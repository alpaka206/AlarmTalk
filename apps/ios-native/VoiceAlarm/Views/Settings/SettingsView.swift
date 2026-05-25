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
    @AppStorage(VoiceAlarmThemeMode.storageKey) private var themeModeRaw = VoiceAlarmThemeMode.system.rawValue

    @State private var nicknameDraft: String = ""
    @State private var themeDialogOpen: Bool = false
    @State private var weatherDialogOpen: Bool = false
    @State private var fortuneDialogOpen: Bool = false
    @State private var promptPreferences: DynamicPromptPreferences = .loadFromDefaults()

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
                    SettingsValueButton(
                        label: "테마",
                        value: currentThemeMode.label,
                        icon: currentThemeMode.systemImage,
                        action: { themeDialogOpen = true }
                    )
                }
                .settingsCard(title: "화면")

                VStack(alignment: .leading, spacing: 0) {
                    SettingsValueButton(
                        label: "날씨 지역",
                        value: weatherLocationLabel,
                        icon: "cloud.sun",
                        action: { weatherDialogOpen = true }
                    )
                    Divider()
                    SettingsValueButton(
                        label: "운세 정보",
                        value: fortuneInfoLabel,
                        icon: "sparkles",
                        action: { fortuneDialogOpen = true }
                    )
                }
                .settingsCard(title: "랜덤 문구 정보")

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
    }

    private var currentThemeMode: VoiceAlarmThemeMode {
        VoiceAlarmThemeMode.normalized(themeModeRaw)
    }

    private var weatherLocationLabel: String {
        promptPreferences.weatherReady
            ? "\(promptPreferences.weatherCountry) \(promptPreferences.weatherCity)"
            : "설정 필요"
    }

    private var fortuneInfoLabel: String {
        promptPreferences.fortuneReady
            ? [promptPreferences.fortuneGender, promptPreferences.fortuneBirthDate, promptPreferences.fortuneBirthTime].joined(separator: " · ")
            : "설정 필요"
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
        }
    }
}

private struct SettingsValueButton: View {
    let label: String
    let value: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .frame(width: 24)
                    .foregroundStyle(VoiceAlarmTheme.primaryDark)
                Text(label)
                    .fontWeight(.medium)
                    .foregroundStyle(VoiceAlarmTheme.text)
                Spacer(minLength: 12)
                Text(value)
                    .font(.subheadline)
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
}

private struct ThemeModePickerSheet: View {
    let current: VoiceAlarmThemeMode
    let onDismiss: () -> Void
    let onSelect: (VoiceAlarmThemeMode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsSheetHeader(title: "테마", subtitle: "앱 화면 모드를 선택해요.", onDismiss: onDismiss)
            VStack(spacing: 10) {
                ForEach(VoiceAlarmThemeMode.allCases) { mode in
                    Button {
                        onSelect(mode)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: mode.systemImage)
                                .font(.title3)
                                .frame(width: 28)
                                .foregroundStyle(mode == current ? VoiceAlarmTheme.primary : VoiceAlarmTheme.textSecondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(mode.label)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(VoiceAlarmTheme.text)
                                Text(mode.subtitle)
                                    .font(.caption)
                                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                            }
                            Spacer()
                            if mode == current {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(VoiceAlarmTheme.primary)
                            }
                        }
                        .padding(14)
                        .background(
                            mode == current
                                ? VoiceAlarmTheme.primary.opacity(0.12)
                                : VoiceAlarmTheme.surfaceVariant.opacity(0.5),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(mode == current ? VoiceAlarmTheme.primary.opacity(0.45) : VoiceAlarmTheme.outline, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(VoiceAlarmTheme.background)
    }
}

private struct WeatherLocationPreferenceSheet: View {
    let initial: DynamicPromptPreferences
    let onDismiss: () -> Void
    let onSave: (String, String) -> Void

    @State private var country = ""
    @State private var city = ""
    @State private var submitted = false

    private var countryValue: String { country.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var cityValue: String { city.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsSheetHeader(
                title: "날씨 지역",
                subtitle: "날씨가 들어간 랜덤 깨움말에 사용할 지역이에요.",
                onDismiss: onDismiss
            )
            SettingsTextField(title: "국가 또는 지역", placeholder: "예: 대한민국", text: $country, showError: submitted && countryValue.isEmpty)
            SettingsTextField(title: "도시", placeholder: "예: 서울", text: $city, showError: submitted && cityValue.isEmpty)
            Button("저장") {
                submitted = true
                guard !countryValue.isEmpty, !cityValue.isEmpty else { return }
                onSave(countryValue, cityValue)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(VoiceAlarmTheme.background)
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

    private var birthDateValue: String { birthDate.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var birthTimeValue: String { birthTime.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isValid: Bool {
        !gender.isEmpty &&
            birthDateValue.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil &&
            birthTimeValue.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsSheetHeader(
                title: "운세 정보",
                subtitle: "운세가 들어간 랜덤 깨움말을 만들 때만 사용해요.",
                onDismiss: onDismiss
            )
            VStack(alignment: .leading, spacing: 8) {
                Text("성별")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                Picker("성별", selection: $gender) {
                    Text("선택").tag("")
                    Text("남성").tag("남성")
                    Text("여성").tag("여성")
                }
                .pickerStyle(.segmented)
                if submitted && gender.isEmpty {
                    Text("성별을 선택해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.error)
                }
            }
            SettingsTextField(
                title: "생년월일",
                placeholder: "YYYY-MM-DD",
                text: $birthDate,
                keyboardType: .numbersAndPunctuation,
                showError: submitted && birthDateValue.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) == nil,
                errorText: "YYYY-MM-DD 형식으로 입력해 주세요."
            )
            SettingsTextField(
                title: "태어난 시간",
                placeholder: "HH:mm",
                text: $birthTime,
                keyboardType: .numbersAndPunctuation,
                showError: submitted && birthTimeValue.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) == nil,
                errorText: "HH:mm 형식으로 입력해 주세요."
            )
            Button("저장") {
                submitted = true
                guard isValid else { return }
                onSave(gender, birthDateValue, birthTimeValue)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(VoiceAlarmTheme.background)
        .onAppear {
            gender = initial.fortuneGender
            birthDate = initial.fortuneBirthDate
            birthTime = initial.fortuneBirthTime
        }
    }
}

private struct SettingsSheetHeader: View {
    let title: String
    let subtitle: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    .frame(width: 32, height: 32)
                    .background(VoiceAlarmTheme.surfaceVariant, in: Circle())
            }
            .buttonStyle(.plain)
        }
    }
}

private struct SettingsTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var showError: Bool
    var errorText: String = "꼭 입력해 주세요."

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(keyboardType)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .onChange(of: text) { _, newValue in
                    if newValue.count > 80 {
                        text = String(newValue.prefix(80))
                    }
                }
            if showError {
                Text(errorText)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.error)
            }
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
