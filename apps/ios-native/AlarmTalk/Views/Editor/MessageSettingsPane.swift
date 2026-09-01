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

    /// 이 목소리로 **실제로 고를 수 있는** 문구 종류(`Self.options` 의 id 부분집합).
    ///
    /// 등록(클론) 목소리는 다섯 종류가 모두 사전렌더되므로 전부 들어온다. 기본(시스템)
    /// 목소리는 서버에 구워 둔 스톡 클립이 있는 카테고리만 들어온다 — 시딩 중이면 그
    /// 종류만 잠깐 빠져 보이고, 다 구워지면 앱 수정 없이 나타난다.
    ///
    /// ⚠ **여기서 '무료라서' 빼지 않는다.** 2026-09-02 전에는 무료·기본 목소리에 아예 다른
    /// 화면(`FreeBucketSettingsPane`)을 보여 주며 목록을 날씨·약으로 잘랐는데, 그건 등급
    /// 정책이 아니라 **클립이 없다**는 사정이었다. 등급으로 갈리는 것은 [manualLocked] 하나다.
    var availableContexts: [String] = MessageSettingsPane.allContextIDs

    /// **직접 입력이 잠기는가.** ⚠ 판정은 **무료 플랜 단독**이다 — 기본(시스템) 목소리를
    /// 골랐다는 것은 이유가 되지 않는다. 유료면 기본 목소리로도 직접 입력을 쓸 수 있고
    /// 횟수만 차감된다(2026-08-11 확정).
    var manualLocked: Bool = false

    /// 잠긴 '직접 입력' 행을 눌렀을 때 — 호출부가 유료 안내로 보낸다.
    ///
    /// ⚠ **이 행을 목록에서 빼지 말 것.** 빼면 유료에 무엇이 있는지 알 길이 없다 —
    /// 안드로이드도 잠긴 행을 남긴다("유료 전환 동기 중 가장 강한 것을 잃는다").
    var onManualLocked: () -> Void = {}

    let onSave: (MessageSettingsResult) -> Void

    /// 화면에 들어온 순간의 값 — 나갈 때 바뀐 게 있는지 판단하는 기준.
    @State private var openedWith: MessageSettingsResult?

    @State private var draftContext: String = "preset"
    @State private var draftManualText: String = ""
    /// 「직접 입력」 알럿 안에서만 쓰는 임시 값. '저장' 을 눌러야 `draftManualText` 로 간다.
    @State private var manualAlertDraft: String = ""

    /// 알람 문구 길이 상한. 서버와 같은 값이어야 한다.
    /// 직접 입력 문구 상한. ⚠ 무료·기본목소리 화면(`AlarmEditorSheet` 의 직접 입력 알럿)도
    /// 같은 값을 쓴다 — 두 화면이 다른 상한을 갖지 않게 여기 한 곳에 둔다.
    static let manualTextMaxLength = 200
    @State private var draftWeatherCountry: String = ""
    @State private var draftWeatherCity: String = ""
    @State private var draftFortuneGender: String = ""
    @State private var draftFortuneBirthDate: String = ""
    @State private var draftFortuneBirthTime: String = ""

    /// 「사주 정보」 시트 안에서만 쓰는 임시 값. '확인' 을 눌러야 `draftFortune*` 로 간다.
    /// ⚠ 아래 「직접 입력」 알럿과 **같은 이유**로 있다 — 직접 바인딩하면 취소가 취소가 아니다.
    @State private var fortuneSheetGender: String = ""
    @State private var fortuneSheetBirthDate: String = ""
    @State private var fortuneSheetBirthTime: String = ""

    @State private var weatherDialogOpen = false
    @State private var fortuneDialogOpen = false
    @State private var manualDialogOpen = false
    /// 다이얼로그를 띄우기 **직전**의 문구 종류. 취소하면 여기로 되돌린다(`select(_:)` 주석).
    @State private var contextBeforeDialog: String?

    /// 안드로이드 `EditorMessageContexts`(`AlarmEditorControls.kt:502-509`) 순서 그대로.
    private static let options: [(id: String, label: String)] = [
        ("preset", "기본 인사말"),
        ("wake_weather", "날씨"),
        ("wake_fortune", "운세"),
        ("love", "사랑"),
        ("medication", "약"),
        (MessageSettingsResult.manualContext, "직접 입력"),
    ]

    /// 목록에 둘 수 있는 모든 종류의 id — [availableContexts] 의 기본값.
    static let allContextIDs: [String] = options.map(\.id)

    /// 잠긴 '직접 입력' 행 — 라디오 대신 자물쇠 배지를 그린다.
    ///
    /// ⚠ **잠기지 않았는데 자물쇠를 그리지 말 것.** 예전에는 플랜과 무관하게 늘 자물쇠였고,
    /// 유료 사용자가 눌러도 "기본 목소리로는 직접 입력을 쓸 수 없어요" 로 막혔다.
    @ViewBuilder
    private func lockedManualRow(label: String) -> some View {
        Button(action: onManualLocked) {
            HStack(spacing: 10) {
                Text(label)
                    .font(theme.typography.bodyLarge)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Spacer()
                // ⚠ 라디오 점보다 크게 둔다(2026-08-15 지시). 안드로이드 `SnoozeLockedRow` 와 같은 값.
                FeatureLockBadge(size: 24, iconSize: 14)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// 실제로 그릴 행. '직접 입력' 은 잠겨 있어도 **언제나 남는다**([onManualLocked] 주석).
    private var visibleOptions: [(id: String, label: String)] {
        Self.options.filter {
            $0.id == MessageSettingsResult.manualContext || availableContexts.contains($0.id)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    EditorCard(verticalPadding: 0) {
                        ForEach(Array(visibleOptions.enumerated()), id: \.element.id) { index, option in
                            if index > 0 { AlarmSettingDivider() }
                            if option.id == MessageSettingsResult.manualContext, manualLocked {
                                lockedManualRow(label: option.label)
                            } else {
                                RadioRow(label: rowLabel(option), selected: draftContext == option.id) {
                                    select(option.id)
                                }
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

        }
        .homeGradientBackground()
        .navigationTitle("문구")
        // ⚠ 부모(편집기)가 상단바를 숨기므로 여기서 명시적으로 켠다 —
        // 번지면 뒤로갈 길이 사라진다(`AlarmSettingsPanes.PaneScaffold` 주석 참조).
        .toolbar(.visible, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            loadDraft()
            // 들어온 순간의 값. 나갈 때 이것과 다를 때만 반영한다(아래 `onDisappear`).
            openedWith = result
        }
        // ⚠ **[취소][저장] 바를 되살리지 말 것**(2026-08-15 지시 — 다른 상세 화면처럼
        // 위 뒤로가기 하나로 나간다). 반영은 화면을 나갈 때 한 번 한다.
        //
        // ⚠ **바뀐 게 없으면 반영하지 않는다.** `applyMessageSettings` 는 테마 선택
        // (`selectedBucketDraft`)과 준비된 음원을 함께 비우므로, 구경만 하고 나온 사람의
        // 테마 알람이 조용히 생성형으로 바뀐다.
        .onDisappear {
            guard let openedWith, result != openedWith else { return }
            onSave(result)
        }
        // ⚠ 확인해도 **이 목록은 닫지 않는다** — 도시 하나 바꾸려다 화면 밖으로 튕기면
        // 안 된다. 최종 반영은 이 화면의 저장 버튼 한 곳이다.
        //
        // ⚠ **설정 화면과 같은 컴포넌트를 쓴다**(2026-08-12 지시). 예전에는 여기만
        // `WeatherLocationInputFields`(국가·도시를 나란히 받는 폼 + '현재 위치 사용')를
        // 썼고 설정은 `WeatherCityPickerSheet`(도시 목록 바텀시트)를 썼다 — **같은 값을
        // 고르는 화면이 앱 안에서 두 가지**였고, 한쪽을 고쳐도 다른 쪽은 그대로였다.
        // 2026-08-10 에 설정만 목록형으로 고치면서 이쪽이 남았다.
        // 도시는 목록에서 **고르는 순간 확정**이라 중간 draft 가 필요 없다(고르지 않고 닫으면
        // 아무것도 쓰이지 않는다). 대신 고르지 않고 닫았으면 종류를 되돌린다.
        .bottomSheet(
            isPresented: $weatherDialogOpen,
            onDismiss: {
                weatherDialogOpen = false
                cancelContextSelection()
            }
        ) {
            WeatherCityPickerSheet(
                currentCity: draftWeatherCity,
                onSelect: { country, city in
                    draftWeatherCountry = country
                    draftWeatherCity = city
                    contextBeforeDialog = nil
                    weatherDialogOpen = false
                }
            )
        }
        // ⚠ **`$draftFortune*` 에 직접 바인딩하지 말 것.** 아래 「직접 입력」 알럿과 같은
        // 이유다 — 직접 바인딩하면 타이핑이 곧바로 화면 draft 에 반영돼 **취소가 취소가
        // 아니게 된다.** 시트 전용 상태에 받아 '확인' 에서만 대입한다.
        // (2026-08-18 전에는 여기만 직접 바인딩이었다. 스와이프로 닫아도 값이 남았다.)
        .sheet(isPresented: $fortuneDialogOpen, onDismiss: { cancelContextSelection() }) {
            NavigationStack {
                ScrollView {
                    FortunePromptInputFields(
                        gender: $fortuneSheetGender,
                        birthDate: $fortuneSheetBirthDate,
                        birthTime: $fortuneSheetBirthTime
                    )
                    .padding(20)
                }
                .homeGradientBackground()
                .navigationTitle("사주 정보")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("취소") { fortuneDialogOpen = false }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("확인") {
                            draftFortuneGender = fortuneSheetGender
                            draftFortuneBirthDate = fortuneSheetBirthDate
                            draftFortuneBirthTime = fortuneSheetBirthTime
                            contextBeforeDialog = nil
                            fortuneDialogOpen = false
                        }
                        // ⚠ **셋을 다 본다** — 서버 `fortune_ready` 와 같은 선이다
                        // (`needsInput(for:)` 주석). 생년월일만 보면 저장은 되는데
                        // 울릴 때 운세 문구가 안 나온다.
                        .disabled(
                            !FortunePromptInputFormat.isComplete(
                                gender: fortuneSheetGender,
                                birthDate: fortuneSheetBirthDate,
                                birthTime: fortuneSheetBirthTime
                            )
                        )
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
            Button("취소", role: .cancel) { cancelContextSelection() }
            Button("저장") {
                // 새니타이즈·길이 상한은 여기서 건다 — 서버도 막지만, 앱이 1차
                // 방어선이라 제어문자·제로폭이 문구에 남으면 TTS 낭독이 망가진다.
                draftManualText = InputSanitizer.clamp(
                    InputSanitizer.sanitizeUserText(manualAlertDraft),
                    max: Self.manualTextMaxLength
                )
                contextBeforeDialog = nil
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

    // ⚠ **상세 카드에서 열 때는 되돌릴 것이 없다.** 이건 이미 고른 종류의 값을 **고치는**
    // 길이지 종류를 새로 고르는 것이 아니다 — 취소했다고 종류까지 바꾸면 안 된다.
    // 그래서 열기 전에 `contextBeforeDialog` 를 비운다(안드로이드 `onChange` 와 같은 규칙).
    @ViewBuilder
    private var detailCard: some View {
        switch draftContext {
        case "wake_weather":
            PromptDetailCard(
                title: "날씨 지역",
                value: weatherSummary,
                onChange: {
                    contextBeforeDialog = nil
                    weatherDialogOpen = true
                }
            )
        case "wake_fortune":
            PromptDetailCard(
                title: "사주 정보",
                value: fortuneSummary,
                onChange: {
                    contextBeforeDialog = nil
                    openFortuneSheet()
                }
            )
        case MessageSettingsResult.manualContext:
            // ⚠ **문구를 반드시 함께 보여준다.** 생성형은 내용이 매번 새로 만들어져 틀릴
            // 일이 없지만 직접 입력은 글자가 그대로다 — 안 보이면 어제 문구를 물고 온
            // 새 알람을 알아챌 방법이 없다.
            PromptDetailCard(
                title: "문구",
                value: draftManualText.isEmpty ? "아직 입력하지 않았어요" : draftManualText,
                onChange: {
                    contextBeforeDialog = nil
                    manualDialogOpen = true
                }
            )
        default:
            EmptyView()
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

    /// 필요한 값이 아직 없어 **고르는 순간 물어야 하는** 종류인가.
    ///
    /// ⚠ **운세는 셋을 다 본다.** 예전에는 **생년월일 하나만** 보고 통과시켰는데, 설정 화면과
    /// 서버는 성별·생년월일·시간 셋을 다 본다(`FortunePromptInputFormat.isComplete` /
    /// 서버 `lib/dynamic-prompt-settings.ts` 의 `fortune_ready`). 그래서 생년월일만 채운
    /// 사람은 **저장은 되는데 울릴 때 운세 문구가 안 나왔다** — 사용자는 저장했다고 믿는다.
    /// 규칙을 새로 쓰지 말고 `isComplete` 를 그대로 가져다 쓴다.
    private func needsInput(for id: String) -> Bool {
        switch id {
        case "wake_weather":
            return draftWeatherCity.trimmingCharacters(in: .whitespaces).isEmpty
        case "wake_fortune":
            return !FortunePromptInputFormat.isComplete(
                gender: draftFortuneGender,
                birthDate: draftFortuneBirthDate,
                birthTime: draftFortuneBirthTime
            )
        case MessageSettingsResult.manualContext:
            return draftManualText.trimmingCharacters(in: .whitespaces).isEmpty
        default:
            return false
        }
    }

    /// ⚠ **미완성 종류는 선택되지 않는다**(2026-08-18. 안드로이드 `AlarmRandomPromptSettings`
    /// 의 `contextBeforeDialog` 와 같은 규칙).
    ///
    /// 그전에는 **먼저 고르고 나중에 물어서**, 다이얼로그를 취소하면 **값 없는 종류**가 선택된
    /// 채로 남았다. 이 화면은 나갈 때 자동 반영(`onDisappear`)이라 그대로 편집기에 실리고,
    /// 사용자는 고른 적 없는 미완성 상태로 저장을 시도하게 된다.
    ///
    /// nil = 되돌릴 것이 없다(같은 종류를 다시 누른 경우, 또는 상세 카드 '변경하기').
    private func rollbackTarget(from previous: String, to id: String) -> String? {
        previous != id ? previous : nil
    }

    private func select(_ id: String) {
        let previous = draftContext
        draftContext = id
        // 값이 **없을 때만** 고르는 순간 입력창을 띄운다. 이미 있으면 선택만 된다 —
        // 매번 물으면 이미 등록한 사람에게 같은 걸 또 묻는 화면이 된다.
        guard needsInput(for: id) else {
            contextBeforeDialog = nil
            return
        }
        contextBeforeDialog = rollbackTarget(from: previous, to: id)
        switch id {
        case "wake_weather": weatherDialogOpen = true
        case "wake_fortune": openFortuneSheet()
        case MessageSettingsResult.manualContext: manualDialogOpen = true
        default: break
        }
    }

    /// 다이얼로그를 확인 없이 닫았을 때 — 그 종류를 고르기 전으로 되돌린다.
    private func cancelContextSelection() {
        if let previous = contextBeforeDialog { draftContext = previous }
        contextBeforeDialog = nil
    }

    /// 사주 시트를 연다. ⚠ **여는 자리는 전부 이걸 부른다** — 시드를 `.onChange(of:)` 에
    /// 맡기면 시트 content 가 만들어지는 시점과의 순서에 기대게 된다(알럿과 달리 시트는
    /// 표시 시점에 한 번 만들어진다). 여는 쪽에서 직접 채워 그 의존을 없앤다.
    private func openFortuneSheet() {
        fortuneSheetGender = draftFortuneGender
        fortuneSheetBirthDate = draftFortuneBirthDate
        fortuneSheetBirthTime = draftFortuneBirthTime
        fortuneDialogOpen = true
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
        // ⚠ **`"male"` 과 비교하지 말 것 — 저장값은 `"남성"`/`"여성"` 이다.**
        // 그렇게 비교하던 시절에는 조건이 절대 참이 되지 않아 **남성을 고른 사람에게도
        // 요약이 "여성" 으로** 떴다. 값 계약의 단일 출처는 `FortunePromptInputFormat` 이고,
        // 정규화를 거치면 옛 표기("male"·"M"·"남" 등)도 올바르게 풀린다.
        let normalizedGender = FortunePromptInputFormat.normalizedGender(gender)
        if !normalizedGender.isEmpty { parts.append(normalizedGender) }
        return parts.joined(separator: " · ")
    }

    // ⚠ **`saveEnabled` 를 되살리지 말 것**(2026-08-18 삭제). 이 화면에는 [취소][저장] 바가
    // 없고 나갈 때 자동 반영이라(`onDisappear`) 막을 버튼 자체가 없었다 — 정의만 있고
    // 아무도 읽지 않는 죽은 코드였고, 그 사이 판정이 `select(_:)` 와 갈라져 있었다.
    // 미완성 상태를 막는 일은 이제 `needsInput(for:)` + `contextBeforeDialog` 롤백이 한다:
    // **애초에 미완성 종류가 선택되지 않으므로** 나중에 저장을 막을 일이 없다.
    // 완성도 판정이 필요하면 `needsInput(for:)` 를 쓸 것 — 두 벌로 만들지 말 것.

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
struct MessageSettingsResult: Equatable {
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
/// 편집기 본문의 '문구' 요약 행.
///
/// ⚠ **알람이 읽어 줄 문장을 여기 싣지 말 것**(2026-08-15 지시 "요약 행이고, 가져오는 건
/// 가져오는 거고, 왜 화면에 띄워야 하냐"). 이 행은 **무엇을 골랐는지**만 말한다 —
/// 문장은 문구 화면에서 본다. 예전에는 `"직접 입력 · <문장>"` 으로 붙였다.
/// 안드로이드 `VoiceAudioCard.MessageModeSummaryRow` 와 같은 규약이다.
struct MessageModeSummaryRow: View {
    let context: String
    /// 날씨를 골랐을 때 함께 보여줄 도시. 비면 종류 이름만 나온다.
    var weatherCity: String = ""
    /// 아직 아무것도 정해지지 않았는가(고른 테마도 없고 문구도 없음).
    ///
    /// ⚠ **[context] 보다 먼저 본다.** 스톡 클립을 쓰는 목소리에서 클립이 아직 안 붙은
    /// 창에는 context 가 기본값으로 읽혀, 먼저 보지 않으면 아직 아무것도 못 골랐는데
    /// 행이 '기본 인사말' 이라고 단정한다.
    var nothingChosenYet: Bool = false
    let onTap: () -> Void

    @ObservedObject private var network = NetworkMonitor.shared

    private var summary: String {
        // ⚠ **오프라인이면 '준비 중' 이라고 속이지 않는다.** 비행기모드에서는 영원히 오지
        // 않을 것을 기다린다고 말하는 셈이다(안드로이드도 두 문구를 나눠 갖는다).
        if nothingChosenYet {
            return network.isOnline ? "문구를 준비하고 있어요" : "오프라인이라 문구를 불러오지 못했어요"
        }
        let label: String
        switch context {
        case "wake_weather": label = "날씨"
        case "wake_fortune": label = "운세"
        case "love": label = "사랑"
        case "medication": label = "약"
        case MessageSettingsResult.manualContext: label = "직접 입력"
        default: label = "기본 인사말"
        }
        // 날씨는 어느 도시 기준인지 함께 보여준다(예: "날씨 · 서울").
        let city = weatherCity.trimmingCharacters(in: .whitespaces)
        if context == "wake_weather", !city.isEmpty { return "\(label) · \(city)" }
        return label
    }

    var body: some View {
        AlarmSettingRow(title: "문구", subtitle: summary, onTap: onTap)
    }
}
