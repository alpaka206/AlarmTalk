import SwiftUI
import UIKit

/// 날씨 지역 고르기 — **도시 목록 바텀시트**.
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
        VStack(alignment: .leading, spacing: 14) {
            Text("원하는 지역")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(theme.palette.onSurface)
                .padding(.horizontal, 20)
                .padding(.top, 4)

            // ⚠ **`ScrollViewReader` 를 걷어내지 말 것.** 도시 목록(9개)만으로 이미 시트
            // 상한(화면 절반)을 넘겨서 스크롤 상태다. '직접 입력' 은 **맨 아래 행**이라,
            // 눌러서 열리는 입력칸은 보이는 영역 **밖**에 생긴다 — 화면이 그대로여서
            // **누른 게 아무 일도 안 한 것처럼 보인다**(2026-08-11 지적 "지역에서 직접
            // 입력 눌렀을 때 아무 효과가 없다"). 열면서 거기로 스크롤해 줘야 한다.
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
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
                                TextField("예: 서울", text: $draftCity)
                                    .alarmTalkFieldStyle()
                                    .focused($draftFocused)
                                    .onChange(of: draftCity) { _, new in
                                        let cleaned = InputSanitizer.sanitizeDisplayName(new)
                                        if cleaned != new { draftCity = cleaned }
                                    }
                                Button("저장") {
                                    onSelect(Self.defaultCountry, cleanedDraft)
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
                    .measuredSheetContent()
                }
                .sheetScrollFit()
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
            }
        }
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        // 배경·모서리·드래그 핸들은 `BottomSheetHost` 가 그린다.
    }

    /// 프리셋 도시는 전부 국내다 — 국가를 따로 묻지 않는 이유다.
    private static let defaultCountry = "대한민국"

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
