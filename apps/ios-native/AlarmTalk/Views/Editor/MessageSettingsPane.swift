import SwiftUI

/// 「문구」 선택 화면 — 안드로이드 `ui/editor/AlarmRandomPromptSettings.kt` 의
/// `RandomPromptSettingsPane`.
///
/// ⚠ **인라인 토글 + 드롭다운으로 되돌리지 말 것.** iOS 는 '랜덤 문구 사용' 스위치와
/// `.menu` 픽커로 대신하고 있었는데, 그 구조에는 **'직접 입력' 이 들어갈 자리가 없다**
/// (스위치를 꺼야 나오는 숨은 상태가 된다). 안드로이드는 직접 입력을 목록의 한 항목으로
/// 두어 여섯 갈래가 같은 층위에 있다.
///
/// 규칙 셋(CLAUDE.md 「알람 편집기 기본값」):
/// 1. **이미 등록한 정보는 다시 묻지 않는다.** 날씨 지역·운세 사주·직접 입력 문구는
///    값이 **없을 때만** 고르는 순간 입력창이 뜬다. 있으면 선택만 되고, 고치는 길은
///    아래 상세 카드의 '변경하기' 하나다.
/// 2. **모달은 자기만 닫는다.** 확인해도 이 목록을 닫지 않는다 — 예전 안드로이드는
///    확인이 곧 저장이라 도시 하나 바꾸려다 화면 밖으로 튕겼다.
/// 3. **최종 반영은 이 화면의 저장 버튼 한 곳.**
struct MessageSettingsPane: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    /// 현재 값(직접 입력이면 `manual`).
    let initialContext: String
    let initialManualText: String
    /// 이번 달 직접 입력 여유 — 유료이고 limit > 0 일 때만 보여준다.
    var manualRemaining: Int?
    var manualLimit: Int?
    /// 저장된 날씨·운세 값(없으면 고르는 순간 입력창을 띄운다).
    let savedWeatherCountry: String
    let savedWeatherCity: String
    let savedFortuneGender: String
    let savedFortuneBirthDate: String
    let savedFortuneBirthTime: String

    let onSave: (MessageSettingsResult) -> Void

    @State private var draftContext: String = "preset"
    @State private var draftManualText: String = ""
    /// 「직접 입력」 알럿 안에서만 쓰는 임시 값. '저장' 을 눌러야 `draftManualText` 로 간다.
    @State private var manualAlertDraft: String = ""

    /// 알람 문구 길이 상한. 서버와 같은 값이어야 한다.
    private static let manualTextMaxLength = 200
    @State private var draftWeatherCountry: String = ""
    @State private var draftWeatherCity: String = ""
    @State private var draftFortuneGender: String = ""
    @State private var draftFortuneBirthDate: String = ""
    @State private var draftFortuneBirthTime: String = ""

    @State private var weatherDialogOpen = false
    @State private var fortuneDialogOpen = false
    @State private var manualDialogOpen = false

    /// 안드로이드 `EditorMessageContexts`(`AlarmEditorControls.kt:502-509`) 순서 그대로.
    private static let options: [(id: String, label: String)] = [
        ("preset", "기본 인사말"),
        ("wake_weather", "날씨"),
        ("wake_fortune", "운세"),
        ("love", "사랑"),
        ("medication", "약"),
        (MessageSettingsResult.manualContext, "직접 입력"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    EditorCard(verticalPadding: 0) {
                        ForEach(Array(Self.options.enumerated()), id: \.element.id) { index, option in
                            if index > 0 { AlarmSettingDivider() }
                            RadioRow(label: rowLabel(option), selected: draftContext == option.id) {
                                select(option.id)
                            }
                        }
                    }

                    detailCard
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            // ⚠ **입력창 밖을 눌러 키보드를 닫을 길을 둔다.** iOS 는 바깥 탭으로 키보드가
            // 자동으로 닫히지 않아서, 없으면 키보드가 화면 절반을 가린 채 버튼에 닿지 못한다
            // (2026-08-10 사용자 보고 — 편집기에는 이미 있었고 나머지 화면만 빠져 있었다).
            .scrollDismissesKeyboard(.interactively)

            // 최종 반영은 여기 한 곳이다 — 라디오를 누르는 즉시 알람이 바뀌면
            // 둘러보다가 실수로 바꾼 것도 저장된다.
            EditorActionBar(
                saveTitle: "저장",
                saving: false,
                savingLabel: "",
                saveEnabled: saveEnabled,
                onCancel: { dismiss() },
                onSave: {
                    onSave(result)
                    dismiss()
                }
            )
        }
        .homeGradientBackground()
        .navigationTitle("문구")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .onAppear(perform: loadDraft)
        // ⚠ 확인해도 **이 목록은 닫지 않는다** — 도시 하나 바꾸려다 화면 밖으로 튕기면
        // 안 된다. 최종 반영은 이 화면의 저장 버튼 한 곳이다.
        .sheet(isPresented: $weatherDialogOpen) {
            NavigationStack {
                ScrollView {
                    WeatherLocationInputFields(country: $draftWeatherCountry, city: $draftWeatherCity)
                        .padding(20)
                }
                .homeGradientBackground()
                .navigationTitle("날씨 지역")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("확인") { weatherDialogOpen = false }
                            .disabled(draftWeatherCity.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $fortuneDialogOpen) {
            NavigationStack {
                ScrollView {
                    FortunePromptInputFields(
                        gender: $draftFortuneGender,
                        birthDate: $draftFortuneBirthDate,
                        birthTime: $draftFortuneBirthTime
                    )
                    .padding(20)
                }
                .homeGradientBackground()
                .navigationTitle("사주 정보")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("확인") { fortuneDialogOpen = false }
                            .disabled(draftFortuneBirthDate.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        // ⚠ **`$draftManualText` 에 직접 바인딩하지 말 것.** 그러면 타이핑이 곧바로
        // 화면 draft 에 반영돼 **'취소' 가 취소가 아니게 된다**(두 버튼 body 가 비어
        // 있어도 이미 값이 바뀐 뒤다). 알럿 전용 상태에 받아 '저장' 에서만 대입한다.
        .alert("직접 입력", isPresented: $manualDialogOpen) {
            TextField("알람에서 읽어 줄 문구", text: $manualAlertDraft)
            Button("취소", role: .cancel) { }
            Button("저장") {
                // 새니타이즈·길이 상한은 여기서 건다 — 서버도 막지만, 앱이 1차
                // 방어선이라 제어문자·제로폭이 문구에 남으면 TTS 낭독이 망가진다.
                draftManualText = InputSanitizer.clamp(
                    InputSanitizer.sanitizeUserText(manualAlertDraft),
                    max: Self.manualTextMaxLength
                )
            }
            .disabled(
                InputSanitizer.sanitizeUserText(manualAlertDraft)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .isEmpty
            )
        } message: {
            Text("이 문구를 그대로 읽어 드려요.")
        }
        .onChange(of: manualDialogOpen) { _, open in
            // 열 때만 현재 값으로 시드한다. 닫힐 때는 건드리지 않는다 —
            // '저장' 이 이미 반영했거나, '취소' 라 반영하지 않아야 한다.
            if open { manualAlertDraft = draftManualText }
        }
    }

    // MARK: - 상세 카드

    @ViewBuilder
    private var detailCard: some View {
        switch draftContext {
        case "wake_weather":
            DetailCard(
                title: "날씨 지역",
                value: weatherSummary,
                onChange: { weatherDialogOpen = true }
            )
        case "wake_fortune":
            DetailCard(
                title: "사주 정보",
                value: fortuneSummary,
                onChange: { fortuneDialogOpen = true }
            )
        case MessageSettingsResult.manualContext:
            // ⚠ **문구를 반드시 함께 보여준다.** 생성형은 내용이 매번 새로 만들어져 틀릴
            // 일이 없지만 직접 입력은 글자가 그대로다 — 안 보이면 어제 문구를 물고 온
            // 새 알람을 알아챌 방법이 없다.
            DetailCard(
                title: "문구",
                value: draftManualText.isEmpty ? "아직 입력하지 않았어요" : draftManualText,
                onChange: { manualDialogOpen = true }
            )
        default:
            EmptyView()
        }
    }

    private struct DetailCard: View {
        @Environment(\.voiceAlarmTheme) private var theme
        let title: String
        let value: String
        let onChange: () -> Void

        var body: some View {
            EditorCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text(title)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                    HStack(alignment: .top, spacing: 12) {
                        Text(value)
                            .font(theme.typography.bodyLarge)
                            .foregroundStyle(theme.palette.onSurface)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        // ⚠ 이 액션을 지우면 등록한 값을 영영 못 바꾼다.
                        Button("변경하기", action: onChange)
                            .font(theme.typography.bodyMedium.weight(.semibold))
                            .buttonStyle(.plain)
                            .foregroundStyle(theme.palette.primary)
                    }
                }
                .padding(.vertical, 12)
            }
        }
    }

    // MARK: - 상태

    private func loadDraft() {
        draftContext = initialContext
        draftManualText = initialManualText
        draftWeatherCountry = savedWeatherCountry
        draftWeatherCity = savedWeatherCity
        draftFortuneGender = savedFortuneGender
        draftFortuneBirthDate = savedFortuneBirthDate
        draftFortuneBirthTime = savedFortuneBirthTime
    }

    private func select(_ id: String) {
        draftContext = id
        // 값이 **없을 때만** 고르는 순간 입력창을 띄운다. 이미 있으면 선택만 된다 —
        // 매번 물으면 이미 등록한 사람에게 같은 걸 또 묻는 화면이 된다.
        switch id {
        case "wake_weather" where draftWeatherCity.trimmingCharacters(in: .whitespaces).isEmpty:
            weatherDialogOpen = true
        case "wake_fortune" where draftFortuneBirthDate.trimmingCharacters(in: .whitespaces).isEmpty:
            fortuneDialogOpen = true
        case MessageSettingsResult.manualContext where draftManualText.trimmingCharacters(in: .whitespaces).isEmpty:
            manualDialogOpen = true
        default:
            break
        }
    }

    private func rowLabel(_ option: (id: String, label: String)) -> String {
        guard option.id == MessageSettingsResult.manualContext,
              let remaining = manualRemaining, let limit = manualLimit, limit > 0
        else { return option.label }
        // 이번 달 남은 만들기 횟수 — 고르기 전에 몇 번 남았는지 먼저 보인다.
        return "\(option.label) (\(max(remaining, 0))/\(limit))"
    }

    private var weatherSummary: String {
        let city = draftWeatherCity.trimmingCharacters(in: .whitespaces)
        guard !city.isEmpty else { return "아직 정하지 않았어요" }
        let country = draftWeatherCountry.trimmingCharacters(in: .whitespaces)
        return country.isEmpty ? city : "\(country) · \(city)"
    }

    private var fortuneSummary: String {
        let date = draftFortuneBirthDate.trimmingCharacters(in: .whitespaces)
        guard !date.isEmpty else { return "아직 정하지 않았어요" }
        var parts = [date]
        let time = draftFortuneBirthTime.trimmingCharacters(in: .whitespaces)
        if !time.isEmpty { parts.append(time) }
        let gender = draftFortuneGender.trimmingCharacters(in: .whitespaces)
        if !gender.isEmpty { parts.append(gender == "male" ? "남성" : "여성") }
        return parts.joined(separator: " · ")
    }

    /// 필요한 값이 비어 있으면 저장을 막는다 — 저장한 뒤 울릴 때 실패하면 되돌릴 수 없다.
    ///
    /// ⚠ **판정은 설정 화면·서버와 같아야 한다.** 예전 편집기는 운세를 **생년월일 하나만**
    /// 보고 통과시켰는데(설정 화면은 `FortunePromptInputFormat.isComplete` 로 성별·
    /// 생년월일·시간 셋을 다 본다), 그래서 편집기로 넣은 값은 서버의
    /// `fortune_ready`(`lib/dynamic-prompt-settings.ts` — 셋 다 있어야 true)를 만족하지
    /// 못해 **어디에도 반영되지 않았다.** 사용자는 저장했다고 믿고 알람을 맞추는데
    /// 울릴 때 운세 문구가 안 나온다.
    /// 규칙을 새로 쓰지 말고 `isComplete` 를 그대로 가져다 쓴다.
    private var saveEnabled: Bool {
        switch draftContext {
        case "wake_weather":
            return !draftWeatherCity.trimmingCharacters(in: .whitespaces).isEmpty
        case "wake_fortune":
            return FortunePromptInputFormat.isComplete(
                gender: draftFortuneGender,
                birthDate: draftFortuneBirthDate,
                birthTime: draftFortuneBirthTime
            )
        case MessageSettingsResult.manualContext:
            return !draftManualText.trimmingCharacters(in: .whitespaces).isEmpty
        default:
            return true
        }
    }

    private var result: MessageSettingsResult {
        MessageSettingsResult(
            context: draftContext,
            manualText: draftManualText,
            weatherCountry: draftWeatherCountry,
            weatherCity: draftWeatherCity,
            fortuneGender: draftFortuneGender,
            fortuneBirthDate: draftFortuneBirthDate,
            fortuneBirthTime: draftFortuneBirthTime
        )
    }
}

/// 문구 화면이 돌려주는 값 묶음.
struct MessageSettingsResult {
    /// '직접 입력' 을 나타내는 컨텍스트 id. 안드로이드 `ManualMessageContext`.
    static let manualContext = "manual"

    var context: String
    var manualText: String
    var weatherCountry: String
    var weatherCity: String
    var fortuneGender: String
    var fortuneBirthDate: String
    var fortuneBirthTime: String

    var isManual: Bool { context == Self.manualContext }
}

/// 문구 요약 행 — 편집기 목소리 카드 안에 놓인다.
///
/// ⚠ **직접 입력일 때는 문구까지 보여준다.** 생성형은 내용이 매번 새로 만들어져 틀릴
/// 일이 없지만 직접 입력은 글자가 그대로다.
struct MessageModeSummaryRow: View {
    let context: String
    let manualText: String
    let onTap: () -> Void

    private var summary: String {
        let label: String
        switch context {
        case "wake_weather": label = "날씨"
        case "wake_fortune": label = "운세"
        case "love": label = "사랑"
        case "medication": label = "약"
        case MessageSettingsResult.manualContext: label = "직접 입력"
        default: label = "기본 인사말"
        }
        guard context == MessageSettingsResult.manualContext else { return label }
        let text = manualText.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? label : "\(label) · \(text)"
    }

    var body: some View {
        AlarmSettingRow(title: "문구", subtitle: summary, onTap: onTap)
    }
}
