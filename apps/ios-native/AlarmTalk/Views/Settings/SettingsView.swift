import SwiftUI

/// 프로필 버튼에서 띄우는 설정 시트.
///
/// Android 설정 화면과 동일하게 화면/랜덤 문구/계정 편집만 다룬다.
/// 코드/이용권/공유 이용권 진입은 MainTabsView 의 프로필 메뉴가 맡는다.
struct SettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var holidayStore: HolidayStore

    @State private var nicknameDraft: String = ""
    @State private var weatherDialogOpen: Bool = false
    @State private var fortuneDialogOpen: Bool = false
    @State private var holidayDialogOpen: Bool = false
    @State private var promptPreferences = DynamicPromptPreferences()
    // 운세 폼의 초안. 상단바의 '저장' 이 눌러야 반영되므로 **모달 밖**에 둔다 —
    // 값이 폼 안에만 있으면 상단바가 그걸 볼 수 없다.
    @State private var fortuneGenderDraft = ""
    @State private var fortuneBirthDateDraft = ""
    @State private var fortuneBirthTimeDraft = ""
    /// 한 번이라도 저장을 눌렀는가. 누르기 전에는 빈 칸 경고를 띄우지 않는다.
    @State private var fortuneSubmitted = false
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
                        action: {
                            // 열 때마다 저장된 값에서 다시 시작한다 — 취소하고 다시 열었을 때
                            // 지난번에 끄적인 값이 남아 있으면 안 된다.
                            fortuneGenderDraft = FortunePromptInputFormat.normalizedGender(promptPreferences.fortuneGender)
                            fortuneBirthDateDraft = FortunePromptInputFormat.normalizedBirthDate(promptPreferences.fortuneBirthDate)
                            fortuneBirthTimeDraft = FortunePromptInputFormat.normalizedBirthTime(promptPreferences.fortuneBirthTime)
                            fortuneSubmitted = false
                            fortuneDialogOpen = true
                        }
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
        .bottomSheet(isPresented: $weatherDialogOpen, onDismiss: { weatherDialogOpen = false }) {
            // ⚠ **국가·도시 입력 폼으로 되돌리지 말 것.** 안드로이드는 도시 목록
            // 바텀시트다 — `WeatherCityPickerSheet` 주석 참조.
            WeatherCityPickerSheet(
                currentCity: promptPreferences.weatherCity,
                onSelect: { country, city in
                    var next = promptPreferences
                    next.weatherCountry = country
                    next.weatherCity = city
                    savePromptPreferences(next)
                    weatherDialogOpen = false
                }
            )
        }
        // ⚠ **가운데 카드 + X 로 되돌리지 말 것.** 아이폰의 폼 모달은 시트로 올라오고
        // 상단바에 취소·제목·저장을 둔다(`FormSheet` 주석 참조).
        .formSheet(
            isPresented: $fortuneDialogOpen,
            title: "운세 정보",
            onCancel: { fortuneDialogOpen = false },
            // ⚠ **저장을 잠그지 않는다.** 잠가 두면 왜 못 누르는지 알 수 없다 — 눌렀을 때
            // 어느 칸이 비었는지 알려 주는 쪽이 낫다(`fortuneSubmitted`).
            onSave: { saveFortuneDraft() }
        ) {
            VStack(alignment: .leading, spacing: 16) {
                // ⚠ 설명 문구를 다시 넣지 말 것(2026-08-11 요청) — 이 화면에 들어온 사람은
                // 이미 '운세 정보' 행을 눌러서 온 것이라, 무엇에 쓰이는지 한 번 더 말하면
                // 폼만 길어진다.
                FortunePromptInputFields(
                    gender: $fortuneGenderDraft,
                    birthDate: $fortuneBirthDateDraft,
                    birthTime: $fortuneBirthTimeDraft,
                    submitted: fortuneSubmitted
                )
            }
        }
        .bottomSheet(isPresented: $holidayDialogOpen, onDismiss: { holidayDialogOpen = false }) {
            HolidayCountryPickerSheet(
                current: holidayStore.selectedCountryCode,
                onDismiss: { holidayDialogOpen = false },
                onSelect: { code in
                    holidayStore.selectedCountryCode = code
                    holidayDialogOpen = false
                }
            )
            // 높이는 `SelectionSheet` 가 내용에 맞춰 잡는다 — 여기서 `.medium` 을 주면
            // 항목 3개짜리 시트가 반 화면을 차지해 아래가 빈다.
        }
    }

    /// '화면' 카드의 '공휴일 달력' 값 — 국기 + 국가명. Android `holidayCountryDisplayLabel`.
    private var holidayCountryLabel: String {
        let code = holidayStore.selectedCountryCode
        return "\(HolidayCountryFlag.emoji(for: code)) \(HolidayStore.localizedCountryName(code))"
    }

    /// ⚠ **나라를 붙이지 말 것**(2026-08-17 통일). 저장은 나라+도시 둘 다 하지만(서버가
    /// 동명 도시를 가르는 단서), 보여주는 것은 도시뿐이다 — 앱의 다른 자리가 전부 도시로
    /// 말한다(`날씨 · 서울`). 안드로이드 `weatherLocationSettingsLabel` 과 같다.
    private var weatherLocationLabel: String {
        promptPreferences.weatherReady ? promptPreferences.weatherCity : "미설정"
    }

    /// ⚠ **'설정됨' 으로 줄이지도, 태어난 시각까지 넣지도 말 것**(2026-08-17 정리).
    /// 이 행은 '넣었나' 와 '제대로 넣었나' 둘 다 답해야 하는데, 셋을 다 넣으면 행이 넘쳐
    /// 값이 잘린다. 시각은 눌러서 여는 화면에 그대로 있다.
    /// 안드로이드 `fortuneInfoSettingsLabel` 과 같은 구성이다.
    private var fortuneInfoLabel: String {
        promptPreferences.fortuneReady
            ? [promptPreferences.fortuneGender, promptPreferences.fortuneBirthDate].joined(separator: " · ")
            : "미설정"
    }

    /// 상단바 '저장'. 빈 칸이 있으면 **닫지 않고** 어느 칸이 비었는지 보여 준다.
    private func saveFortuneDraft() {
        fortuneSubmitted = true
        guard FortunePromptInputFormat.isComplete(
            gender: fortuneGenderDraft,
            birthDate: fortuneBirthDateDraft,
            birthTime: fortuneBirthTimeDraft
        ) else { return }
        var next = promptPreferences
        next.fortuneGender = FortunePromptInputFormat.normalizedGender(fortuneGenderDraft)
        next.fortuneBirthDate = FortunePromptInputFormat.normalizedBirthDate(fortuneBirthDateDraft)
        next.fortuneBirthTime = FortunePromptInputFormat.normalizedBirthTime(fortuneBirthTimeDraft)
        savePromptPreferences(next)
        fortuneDialogOpen = false
    }

    private func loadPromptPreferences() {
        let server = DynamicPromptPreferences.from(settings: auth.session?.user.dynamicPromptSettings)
        let userID = auth.session?.user.id
        if server != DynamicPromptPreferences() {
            promptPreferences = server
            server.save(userID: userID)
        } else {
            promptPreferences = .load(userID: userID)
        }
    }

    private func savePromptPreferences(_ preferences: DynamicPromptPreferences) {
        promptPreferences = preferences
        preferences.save(userID: auth.session?.user.id)
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
                // ⚠ **설명 줄을 되살리지 말 것**(2026-08-17 지시). 아이콘·제목이 이미
                // 말한 것을 되풀이했고, "밤에 보기 편한" 같은 문장은 사용자가 왜 그걸
                // 고르는지를 앱이 넘겨짚는다. 안드로이드에서도 함께 지웠다.
                Text(mode.pickerTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.text)
            }
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
