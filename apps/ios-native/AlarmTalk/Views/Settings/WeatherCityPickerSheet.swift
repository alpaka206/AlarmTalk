import SwiftUI
import UIKit

/// 날씨 지역 고르기 — **도시 목록 바텀시트**.
///
/// ⚠ **지역을 고르는 UI 는 앱 전체에 이것 하나다**(2026-08-12 통일). 쓰는 곳:
/// 설정 화면(`Views/Settings/SettingsView.swift`)과 알람 편집기의 문구 화면
/// (`Views/Editor/MessageSettingsPane.swift`). 안드로이드도 마찬가지로
/// `ui/editor/AlarmRandomPromptSettings.kt` 의 `WeatherLocationDialog` **하나**를
/// 설정·유료 문구 pane·무료 pane 셋이 나눠 쓴다.
///
/// 새 화면이 지역을 받아야 하면 **이걸 가져다 쓴다.** 전용 입력 폼을 새로 만들지 말 것 —
/// 2026-08-10 에 설정만 목록형으로 고치고 문구 화면에 폼이 남는 바람에, 같은 값을 고르는
/// 화면이 앱 안에서 두 가지였고 한쪽을 고쳐도 다른 쪽은 그대로였다.
///
/// 안드로이드 `ui/editor/AlarmRandomPromptSettings.kt` 의 `WeatherLocationDialog` 와 같은
/// 구조다: `WakerSelectionSheet` 안에 프리셋 도시 행들 + 마지막 '직접 입력' 행, 직접 입력을
/// 고르면 그 아래로 입력칸과 저장 버튼이 열린다.
///
/// ⚠ **국가·도시를 나란히 받는 폼으로 되돌리지 말 것.** iOS 에만 그런 폼이 있었고
/// (`WeatherLocationPreferenceSheet`), 같은 설정을 두 앱에서 전혀 다른 화면으로 하고 있었다
/// (2026-08-10 지적 "날씨 지역 고르는 것도 안드로이드랑 아예 다르네").
/// 나라는 목록에서 고른 도시로 정해지므로 따로 물을 이유가 없다.
///
/// ⚠ **직접 입력칸은 항상 빈칸으로 시작한다** — 안드로이드 주석 그대로 "기본값 없음" 규칙이다.
/// 지금 저장된 지역은 뒤 화면의 '날씨 지역' 행에 이미 보인다.
struct WeatherCityPickerSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    /// 지금 저장된 도시(체크 표시용).
    let currentCity: String
    /// 고른 도시를 (국가, 도시)로 돌려준다. 국가는 프리셋이면 대한민국이다.
    let onSelect: (String, String) -> Void

    /// 안드로이드 `hs_weather_preset_cities` 와 같은 순서·같은 목록.
    static let presetCities = ["서울", "부산", "인천", "대구", "대전", "광주", "울산", "수원", "제주"]

    @State private var customMode = false
    @State private var draftCity = ""
    @FocusState private var draftFocused: Bool

    /// 열린 입력칸으로 스크롤할 때 쓰는 목적지 표식.
    private static let customFieldID = "weather-city-custom-field"

    private var cleanedDraft: String {
        InputSanitizer.sanitizeDisplayName(draftCity)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: BottomSheetTitle.titleToContentSpacing) {
            BottomSheetTitle(text: "원하는 지역")

            // ⚠ **`ScrollViewReader` 를 걷어내지 말 것.** 도시 목록(9개)만으로 이미 시트
            // 상한(화면 절반)을 넘겨서 스크롤 상태다. '직접 입력' 은 **맨 아래 행**이라,
            // 눌러서 열리는 입력칸은 보이는 영역 **밖**에 생긴다 — 화면이 그대로여서
            // **누른 게 아무 일도 안 한 것처럼 보인다**(2026-08-11 지적 "지역에서 직접
            // 입력 눌렀을 때 아무 효과가 없다"). 열면서 거기로 스크롤해 줘야 한다.
            ScrollViewReader { proxy in
                // ⚠ **입력칸이 열렸을 때만** 스크롤을 고정한다.
                // 늘 켜 두면 목록만 보고 있을 때도 시트가 상한까지 늘어나 **아래가 텅 빈다**
                // (2026-08-13 지적). 반대로 열렸을 때 안 켜면 키보드가 올라와도 입력칸이
                // 따라 올라오지 못한다(스크롤뷰가 없으면 `scrollTo` 가 듣지 않는다).
                SheetScrollingContent(alwaysScrolls: customMode) {
                    // ⚠ **`LazyVStack` 으로 되돌리지 말 것.** 게으른 스택은 제안된 높이를 그대로 먹어서
                    // `ViewThatFits` 가 "안 들어간다" 고 판단한다 — 짧은 목록도 늘 스크롤 갈래로 떨어진다.
                    // 이 목록들은 많아야 열 몇 행이라 게으를 이유도 없다.
                    VStack(spacing: 0) {
                        ForEach(Array(Self.presetCities.enumerated()), id: \.element) { index, preset in
                            if index > 0 { Divider() }
                            row(title: preset, selected: !customMode && currentCity == preset) {
                                onSelect(Self.defaultCountry, preset)
                                dismiss()
                            }
                        }
                        Divider()
                        // 탭하면 아래로 입력칸이 열린다(안드로이드도 같은 토글이다).
                        row(title: "직접 입력", selected: customMode) {
                            customMode.toggle()
                        }

                        if customMode {
                            VStack(alignment: .leading, spacing: 12) {
                                TextField(Self.customPlaceholder, text: $draftCity)
                                    .alarmTalkFieldStyle()
                                    .focused($draftFocused)
                                    .onChange(of: draftCity) { _, new in
                                        let cleaned = InputSanitizer.sanitizeDisplayName(new)
                                        if cleaned != new { draftCity = cleaned }
                                    }
                                Button("저장") {
                                    let parsed = Self.parseLocation(cleanedDraft)
                                    onSelect(parsed.country, parsed.city)
                                    dismiss()
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(theme.palette.primary)
                                .frame(maxWidth: .infinity)
                                .disabled(cleanedDraft.isEmpty)
                            }
                            .padding(.horizontal, 20)
                            .padding(.top, 12)
                            .id(Self.customFieldID)
                        }
                    }
                }
                .onChange(of: customMode) { _, opened in
                    guard opened else { return }
                    // 입력칸이 붙은 **다음** 프레임에 스크롤해야 목적지가 존재한다.
                    DispatchQueue.main.async {
                        withAnimation(.snappy(duration: 0.25)) {
                            proxy.scrollTo(Self.customFieldID, anchor: .bottom)
                        }
                        // 스크롤이 끝난 뒤 커서를 준다 — 바로 칠 수 있어야 한 번에 끝난다.
                        draftFocused = true
                    }
                }
                // ⚠ **키보드가 올라온 뒤 한 번 더 스크롤한다.**
                // 위 스크롤은 커서를 주기 **전**에 끝나므로, 그 시점 화면에는 키보드가 없다.
                // 그 뒤 키보드가 올라오면 방금 맞춰 둔 자리를 다시 덮어 — 입력칸은 보이는데
                // 바로 아래 '저장' 이 가려진다(2026-08-13 실측). 올라온 뒤 다시 맞춘다.
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: UIResponder.keyboardDidShowNotification
                    )
                ) { _ in
                    guard customMode else { return }
                    withAnimation(.snappy(duration: 0.2)) {
                        proxy.scrollTo(Self.customFieldID, anchor: .bottom)
                    }
                }
            }
        }
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        // 배경·모서리·드래그 핸들은 `BottomSheetHost` 가 그린다.
    }

    /// 프리셋 도시는 전부 국내다 — 목록에서 고를 때 국가를 따로 묻지 않는 이유다.
    private static let defaultCountry = "대한민국"

    /// 직접 입력칸의 예시.
    ///
    /// ⚠ **프리셋에 이미 있는 도시를 예로 들지 말 것.** 예전에는 "예: 서울" 이었는데,
    /// 서울은 바로 위 목록 첫 줄에 있다 — 직접 입력이 **왜 있는지**를 설명하지 못한다.
    /// 이 칸은 목록에 없는 곳(= 다른 나라)에 사는 사람을 위한 것이므로, 예시도 그래야
    /// 하고 **'나라 도시' 형식**을 함께 보여줘야 한다(2026-08-13 지적).
    ///
    /// 앱 언어가 한국어면 바깥 예(미국 뉴욕), 아니면 한국 예를 든다 — 어느 쪽이든
    /// "여기는 목록 밖 지역을 적는 칸" 이라는 뜻이 전달된다. 번역 카탈로그가 언어별로
    /// 값을 갖는다.
    private static var customPlaceholder: String { String(localized: "예: 미국 뉴욕") }

    /// 직접 입력한 한 줄을 (나라, 도시)로 가른다.
    ///
    /// 공백이 있으면 **첫 낱말이 나라, 나머지가 도시**다("미국 뉴욕" → 미국 / 뉴욕,
    /// "미국 뉴욕 브루클린" → 미국 / 뉴욕 브루클린). 공백이 없으면 국내로 본다 —
    /// 프리셋과 같은 뜻이라 "속초" 처럼 도시만 적어도 그대로 동작한다.
    ///
    /// ⚠ 나라를 안 가르면 뉴욕이 **대한민국 뉴욕**으로 저장돼 서버가 날씨를 못 찾는다.
    static func parseLocation(_ raw: String) -> (country: String, city: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let separator = trimmed.firstIndex(of: " ") else {
            return (defaultCountry, trimmed)
        }
        let country = String(trimmed[trimmed.startIndex..<separator])
        let city = trimmed[trimmed.index(after: separator)...]
            .trimmingCharacters(in: .whitespaces)
        // 뒷부분이 비면(끝에 공백만 있던 경우) 나라 이름만 남으므로 도시로 되돌린다.
        guard !city.isEmpty else { return (defaultCountry, country) }
        return (country, city)
    }

    @ViewBuilder
    private func row(title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(title)
                    .foregroundStyle(theme.palette.onSurface)
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(theme.palette.primary)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .frame(minHeight: 55)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
