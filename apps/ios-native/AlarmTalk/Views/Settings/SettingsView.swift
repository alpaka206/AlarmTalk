import SwiftUI

/// 프로필 버튼에서 띄우는 설정 시트.
///
/// Android 설정 화면과 동일하게 문구 정보(지역·운세)/계정/법적 정보만 다룬다.
/// 코드/이용권/공유 이용권 진입은 MainTabsView 의 프로필 메뉴가 맡는다.
struct SettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var holidayStore: HolidayStore

    @State private var weatherDialogOpen: Bool = false
    @State private var fortuneDialogOpen: Bool = false
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

    /// 약관/방침 외부 링크. Android 는 `AlarmTalkApp.kt` 의 `LegalDocumentScreen` 라우트가 같은 주소를 쓴다.
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
                // (안드로이드 `ui/settings/SettingsScreen.kt` 주석: "테마·앱 언어는 전체 탭에서
                // 관리한다"). 양쪽에 두면 같은 값을 바꾸는 자리가 둘이 되어, 한쪽만
                // 고쳤을 때 다른 쪽이 옛 값을 보여준다.
                //
                // ⚠ **'공휴일 달력' 행(과 그것뿐이던 '화면' 카드)을 되살리지 말 것**(2026-09-30).
                // 공휴일 국가는 **지역의 나라**를 따른다 — 고르는 자리는 아래 '지역' 하나다
                // (`HolidayStore.adoptCountry(ofWeatherRegion:)`, 스펙 alarm-lifecycle.md
                // 「공휴일 국가는 지역의 나라다」). 행을 따로 두면 날씨는 도쿄인데 공휴일은 한국인
                // 알람이 생기고, 어느 쪽이 맞는지 앱이 말해 줄 수 없다.

                VStack(alignment: .leading, spacing: 0) {
                    SettingsValueButton(
                        label: "지역",
                        value: weatherLocationLabel,
                        note: weatherLegacyNote,
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
                .settingsCard(title: "문구 정보")

                if let user = auth.session?.user {
                    AccountPanel(
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
                // 앱 안에 유지해야 한다(안드로이드 `SettingsScreen.kt:146-163`).
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
            loadPromptPreferences()
        }
        // ⚠ **축은 값이 아니라 응답이다**(`PromptObservation`, Codex #837 11차) — 앱 루트의 받아 적기
        //   (`AlarmTalkApp.accountPromptSettingsKey`)와 같은 축. 값만 보면, 같은 내용의 `/auth/me` 가 기기 값을 바꿔도
        //   (앞서 키체인 받아 적기가 실패했다가 이번에 성공했다 등) 화면은 옛 스냅샷에 남는다.
        .onChange(of: promptObservation) { _, _ in
            loadPromptPreferences()
        }
        .bottomSheet(isPresented: $weatherDialogOpen, onDismiss: { weatherDialogOpen = false }) {
            // ⚠ **입력 폼·직접 입력으로 되돌리지 말 것** — 나라 → 지역 목록뿐이다
            // (`WeatherRegionPickerSheet` 주석 참조).
            WeatherRegionPickerSheet(
                current: promptPreferences.weatherRegion,
                legacyLabel: WeatherRegions.unresolvedLegacyLabel(
                    country: promptPreferences.weatherCountry,
                    city: promptPreferences.weatherCity
                ),
                onSelect: { region in
                    var next = editBase()
                    // 옛 앱이 읽는 표준 글자로 적는다 — 키는 이 글자에서 되짚힌다(`toSettings`).
                    next.weatherCountry = region.legacyCountry
                    next.weatherCity = region.legacyCity
                    // 공휴일 국가 = 지역의 나라. 서버 저장이 실패해도(오프라인) 이 기기는 곧바로 맞춘다 —
                    // 성공하면 `AlarmTalkApp` 의 계정 설정 관찰이 같은 값으로 한 번 더 부르고, 같으면 쓰지 않는다.
                    // ⚠ 기기에 적었을 때만이다 — 못 적었으면 달력만 새 나라로 가고 기기 값은 옛 지역에 남는다.
                    if savePromptPreferences(next) {
                        holidayStore.adoptCountry(ofWeatherRegion: region.key)
                    }
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
    }

    /// '지역' 행의 값 — 앱 언어의 지역 이름(`WeatherRegions.displayName`).
    ///
    /// ⚠ **나라를 붙이지 말 것**(2026-08-17 통일). 저장은 나라+도시 둘 다 하지만, 보여주는 것은
    /// 지역 이름뿐이다 — 앱의 다른 자리가 전부 그렇게 말한다(`날씨 · 서울`).
    /// 되짚지 못한 옛 값(직접 입력 시절의 "속초")은 적힌 글자 그대로 보인다(아래 안내가 붙는다).
    private var weatherLocationLabel: String {
        guard promptPreferences.weatherReady,
              let name = WeatherRegions.displayName(
                  country: promptPreferences.weatherCountry,
                  city: promptPreferences.weatherCity
              )
        else { return String(localized: "미설정") }
        return name
    }

    /// 되짚지 못한 옛 값에만 붙는 짧은 안내. 고르게 강요하지 않는다 — 바꾸기 전까지는 서버의
    /// 옛 경로로 계속 돈다(스펙 「날씨 지역은 목록에서만 고른다」).
    private var weatherLegacyNote: String? {
        // 값 칸과 같은 판정(`weatherReady`)을 먼저 본다 — '미설정' 옆에 "다시 골라 주세요" 가 붙으면 안 된다.
        promptPreferences.weatherReady && WeatherRegions.isUnresolvedLegacy(
            country: promptPreferences.weatherCountry,
            city: promptPreferences.weatherCity
        ) ? String(localized: "목록에서 다시 골라 주세요") : nil
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
        var next = editBase()
        next.fortuneGender = FortunePromptInputFormat.normalizedGender(fortuneGenderDraft)
        next.fortuneBirthDate = FortunePromptInputFormat.normalizedBirthDate(fortuneBirthDateDraft)
        next.fortuneBirthTime = FortunePromptInputFormat.normalizedBirthTime(fortuneBirthTimeDraft)
        savePromptPreferences(next)
        fortuneDialogOpen = false
    }

    /// 화면이 기기 값을 다시 읽을 때 — 계정·그 계정의 설정, 그리고 **계정 응답 순번**이 축이다.
    /// 안드로이드 설정 화면의 `accountSettingsReceipt` 축과 같다.
    struct PromptObservation: Equatable {
        var userID: String?
        var settings: DynamicPromptSettings?
        var answerRevision: Int
    }

    private var promptObservation: PromptObservation {
        Self.observation(of: auth)
    }

    /// 관찰 값 — 화면(`onChange`)과 회귀 테스트가 같은 함수를 쓴다(`AuthViewModelTests`).
    @MainActor
    static func observation(of auth: AuthViewModel) -> PromptObservation {
        PromptObservation(
            userID: auth.session?.user.id,
            settings: auth.session?.user.dynamicPromptSettings,
            answerRevision: auth.accountAnswerRevision
        )
    }

    /// 고칠 때의 출발점 — 화면의 스냅샷이 아니라 **지금 이 기기 값**(받아 적은 뒤)이다(Codex #837 11차).
    /// 한 묶음(지역·사주)만 고쳐도 기기에는 설정 전체를 적고 그대로 올리므로, 스냅샷이 낡았으면 고치지 않은
    /// 묶음이 옛 값으로 되돌아가 다른 기기가 고친 지역·사주를 지운다. 안드로이드는 고친 묶음만 적고 올릴 값을
    /// 차례가 온 뒤 기기에서 다시 읽는다(`saveWeatherLocation`·`pendingUploadSnapshot`) — 같은 결과다.
    private func editBase() -> DynamicPromptPreferences {
        let fresh = Self.editBase(userID: auth.session?.user.id, server: auth.session?.user.dynamicPromptSettings)
        promptPreferences = fresh
        return fresh
    }

    /// `editBase()` 의 규칙 — 받아 적은 뒤의 이 기기 값(`DynamicPromptPreferences.current` 와 같은 순서).
    /// 화면 상태를 건드리지 않으므로 `nonisolated` 다 — 뷰의 메인 액터 격리를 물려받으면 비격리 유닛 테스트가
    /// `defaults` 를 넘길 수 없다(Swift 6 "sending risks causing data races").
    nonisolated static func editBase(
        userID: String?,
        server: DynamicPromptSettings?,
        defaults: UserDefaults = .standard
    ) -> DynamicPromptPreferences {
        DynamicPromptPreferences.adoptAccount(userID: userID, server: server, defaults: defaults)
        return DynamicPromptPreferences.load(userID: userID)
    }

    /// 계정 설정을 이 기기에 받아 적은 **뒤의** 기기 값을 보인다(`DynamicPromptPreferences.current`).
    /// ⚠ 서버 값을 그대로 보이지 말 것 — 이 기기에서 고친 값의 저장이 실패했으면(오프라인) 서버 값은
    /// 그보다 옛것이고, 서버에 사주만 있을 때 기기에만 있는 지역까지 '미설정' 이 된다. 규칙은
    /// `AccountPromptSettingsAdoption.swift`, 안드로이드 `SettingsScreen` 의 `adoptAccountSettings` → `read` 와 같다.
    /// 다시 올리는 일은 `AlarmTalkApp` 의 계정 설정 관찰이 한다 — 여기서는 읽기만 맞춘다.
    private func loadPromptPreferences() {
        promptPreferences = .current(
            userID: auth.session?.user.id,
            server: auth.session?.user.dynamicPromptSettings
        )
    }

    /// - Returns: 기기에 적었는가. ⚠ 못 적었으면(키체인 쓰기 실패) 화면도 서버도 공휴일 국가도 바꾸지 않는다 —
    ///   기기 값(알람·편집기가 읽는 것)과 갈라진다(`DynamicPromptPreferences.commitLocalEdit`, Codex #837).
    @discardableResult
    private func savePromptPreferences(_ preferences: DynamicPromptPreferences) -> Bool {
        // '아직 안 올라간 변경' 표시와 함께 적는다 — 아래 저장이 실패해도 다음에 받는 서버의 옛 값이
        // 이 값을 덮지 않고, 앱이 다시 올린다(`AlarmTalkApp`).
        let wrote = preferences.commitLocalEdit(userID: auth.session?.user.id) {
            promptPreferences = preferences
            // 프로필 저장이 끝나면 `updateProfile` 이 사용자를 다시 읽는다(`refreshUser`) — 그걸로
            // 끝이다. 이용권 새로고침은 부르지 않는다: 날씨 지역·사주는 이용권과 무관하고, 그
            // 새로고침이 `/auth/me` 를 한 번 더 부른다(스펙 plan-gates §4).
            Task {
                await auth.updateProfile(dynamicPromptSettings: preferences.toSettings())
            }
        }
        if !wrote {
            // 적힌 값(옛것)을 그대로 보인다.
            loadPromptPreferences()
        }
        return wrote
    }
}

/// 라벨 + (선택) 값 + chevron 행. 설정·더보기 두 화면이 함께 쓴다.
/// Android `SettingsRow`(`ui/settings/SettingsScreenComponents.kt`)와 같이 선행 아이콘은 두지 않는다.
struct SettingsValueButton: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let label: LocalizedStringKey
    var value: String? = nil
    /// 행 아래 작은 안내(예: 되짚지 못한 옛 지역의 "목록에서 다시 골라 주세요"). 없으면 안 그린다.
    var note: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label)
                        .fontWeight(.medium)
                        .foregroundStyle(theme.palette.onSurface)
                    Spacer(minLength: 12)
                    if let value {
                        // ⚠ **값은 primary 로 강조한다.** 라벨과 값이 둘 다 무채색이면
                        // 어느 쪽이 현재 설정값인지 안 읽힌다(안드로이드
                        // `SettingsScreenComponents.kt:100-110` 도 primary + SemiBold).
                        Text(value)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(theme.palette.primary)
                            .lineLimit(1)
                            .multilineTextAlignment(.trailing)
                    }
                    Image(systemName: "chevron.right")
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                if let note {
                    // ⚠ **왼쪽 정렬, 라벨과 같은 시작선**이다 — 안드로이드 `SettingsRow` 의 `supportingText`
                    // (`TextAlign.Start`, 행 안쪽 시작 여백)와 같다. 오른쪽 정렬은 이 앱에서 **값**만의
                    // 자리라, 값 밑에 오른쪽으로 붙이면 안내가 값의 일부처럼 읽힌다. 값 칸 안에 넣지 않는
                    // 이유: 값은 한 줄로 잘리는 자리라 안내가 먼저 잘려 사라진다.
                    Text(verbatim: note)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleButtonStyle())
    }
}

/// 테마 선택 — 공용 시트를 쓴다(아이콘 + 제목).
struct ThemeModePickerSheet: View {
    let current: AlarmTalkThemeMode
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
