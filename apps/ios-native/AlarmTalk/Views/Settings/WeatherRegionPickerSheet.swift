import SwiftUI

/// 지역 고르기 — **나라 → 지역** 바텀시트. 직접 입력은 없다(2026-09-30).
///
/// 규칙 원문은 `docs/spec/voice-and-message.md` 「날씨 지역은 목록에서만 고른다」. 목록은
/// `WeatherRegions`(생성 파일 — `packages/shared/src/weather-regions.json` 하나가 원본)이고,
/// 나라(대한민국 · 일본 · 미국)를 고르면 그 나라의 지역이 목록 순서대로 나온다.
///
/// ⚠ **지역을 고르는 UI 는 앱 전체에 이것 하나다**(2026-08-12 통일 규칙 그대로). 쓰는 곳:
/// 설정 화면(`Views/Settings/SettingsView.swift`)과 알람 편집기의 문구 화면
/// (`Views/Editor/MessageSettingsPane.swift`). 새 화면이 지역을 받아야 하면 이걸 가져다 쓴다.
///
/// ⚠ **직접 입력칸을 되살리지 말 것.** 예전에는 도시 9개 + '직접 입력' 이었고, 두 글자
/// 한국어 이름을 서버가 지오코딩하다가 동명 마을을 잡거나(부산 → 경북 의성군) 아무것도
/// 못 찾았다(서울·제주). 지금은 지역마다 좌표를 박아 두고 서버가 미리 계산한다.
///
/// 고른 지역은 **옛 앱이 읽는 표준 글자**(`legacyCountry`·`legacyCity`)로 저장된다 — 호출부가
/// `region.legacyCountry`/`region.legacyCity` 를 적는다. 보이는 이름은 앱 언어로 번역한다.
struct WeatherRegionPickerSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    /// 버전 확인이 받아 온 서버의 날씨 원천 토큰(`AppVersionGate.weatherAttribution`) — 출처 줄을 그릴지 정한다.
    @EnvironmentObject private var versionGate: AppVersionGate

    /// 지금 저장된 값이 가리키는 지역(체크 표시용). 되짚지 못한 옛 값이면 nil.
    let current: WeatherRegion?
    /// 되짚지 못한 옛 값의 글자(직접 입력 시절의 "속초") — 있으면 제목 아래에 "목록에 없어요" 를 말한다.
    /// 안드로이드 `WeatherLocationDialog` 의 부제(`region_picker_legacy_value_hint`)와 같다.
    let legacyLabel: String?
    let onSelect: (WeatherRegion) -> Void

    @State private var country: WeatherCountry
    /// 나라 세그먼트의 실제 높이 — 목록 높이 상한에서 뺀다(`SheetScrollingContent.reservedHeight`).
    @State private var countryBarHeight: CGFloat = 0
    /// 옛 값 안내 줄의 실제 높이 — 같은 이유로 뺀다.
    @State private var legacyNoteHeight: CGFloat = 0
    /// 목록 아래 날씨 출처 줄의 실제 높이 — 같은 이유로 뺀다. Dynamic Type 으로 줄 수가 바뀌어도 실측이라 맞는다.
    @State private var attributionHeight: CGFloat = 0

    init(
        current: WeatherRegion?,
        legacyLabel: String? = nil,
        onSelect: @escaping (WeatherRegion) -> Void
    ) {
        self.current = current
        self.legacyLabel = legacyLabel.nilIfBlank
        self.onSelect = onSelect
        _country = State(initialValue: WeatherRegions.initialPickerCountry(for: current))
    }

    private var language: String { WeatherRegions.currentLanguage() }

    /// 목록 아래 날씨 출처 줄을 그리는가 — 서버가 지금 쓰는 원천을 말할 때만(`WeatherAttribution.showsLine`).
    private var showsAttribution: Bool { WeatherAttribution.showsLine(versionGate.weatherAttribution) }

    /// 목록 높이 상한에서 뺄 몫 — 나라 세그먼트(+ 그 아래 간격), 옛 값 안내 줄, 출처 줄(+ 그 위 간격).
    /// ⚠ 출처 줄은 **그릴 때만** 뺀다. 안 그리는데 빼면 목록이 그만큼 짧아지고, 그리는데 안 빼면 시트가 화면을
    /// 꽉 채워 스크림이 사라진다. 판정은 높이 값이 아니라 `showsAttribution` 이다 — 한 번 그렸다 숨기면
    /// `attributionHeight` 에는 옛 실측이 남는다.
    private var reservedListHeight: CGFloat {
        var reserved = countryBarHeight + BottomSheetTitle.titleToContentSpacing
        if legacyLabel != nil { reserved += legacyNoteHeight + 3 }
        if showsAttribution { reserved += attributionHeight + BottomSheetTitle.titleToContentSpacing }
        return reserved
    }

    var body: some View {
        VStack(alignment: .leading, spacing: BottomSheetTitle.titleToContentSpacing) {
            VStack(alignment: .leading, spacing: 3) {
                BottomSheetTitle(text: String(localized: "지역"))
                // 목록에 없는 것을 고른 채로 둘 수는 없으므로 체크 표시는 없다 — 대신 무엇이 적혀
                // 있는지 말한다(안드로이드 `WakerSelectionSheet` 의 부제 자리).
                if let legacyLabel {
                    Text(String(localized: "‘\(legacyLabel)’은(는) 목록에 없어요. 다시 골라 주세요."))
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, BottomSheetTitle.horizontalPadding)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { legacyNoteHeight = $0 }
                }
            }

            // 나라는 시스템 세그먼트다 — 셋뿐이고, 목록 위에서 한 번에 보여야 한다.
            Picker(String(localized: "나라"), selection: $country) {
                ForEach(WeatherCountry.allCases, id: \.self) { item in
                    Text(verbatim: item.displayName(language: language)).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, BottomSheetTitle.horizontalPadding)
            .accessibilityIdentifier("weather-region-country")
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { countryBarHeight = $0 }

            // ⚠ **`ScrollViewReader` 를 걷어내지 말 것.** 미국은 69곳이라 고른 지역이 화면 밖에
            // 있기 쉽다 — 열 때 거기로 스크롤하지 않으면 무엇이 골라져 있는지 안 보인다.
            ScrollViewReader { proxy in
                // 나라마다 길이가 달라(17 · 47 · 69) 짧은 쪽만 자연 높이로 두면 세그먼트를 바꿀
                // 때마다 시트 높이가 튄다. 셋 다 화면을 넘으므로 늘 스크롤 갈래로 둔다.
                // ⚠ 세그먼트 몫(+ 그 아래 간격)을 **빼지 않으면** 시트가 화면을 꽉 채워 뒤 스크림이
                // 사라진다 — 바깥을 눌러 닫을 곳이 없다(2026-09-30 시뮬레이터 실측).
                // ⚠ 아래 출처 줄(+ 그 위 간격)도 **그릴 때는** 같은 이유로 뺀다(`reservedListHeight`) — 빼먹으면
                // 스크림이 사라진다.
                SheetScrollingContent(
                    alwaysScrolls: true,
                    reservedHeight: reservedListHeight
                ) {
                    // ⚠ `LazyVStack` 으로 바꾸지 말 것 — `SelectionSheet` 주석과 같은 이유다.
                    VStack(spacing: 0) {
                        ForEach(Array(WeatherRegions.byCountry(country).enumerated()), id: \.element.id) { index, region in
                            if index > 0 { Divider() }
                            row(region)
                                .id(region.key)
                        }
                    }
                }
                .onAppear { scrollToCurrent(proxy) }
                // 나라를 바꾸면 곧바로 맨 위로 — 고른 지역이 있는 나라로 돌아와도 같다(2026-09-30
                // 사용자 지시). 안드로이드는 나라마다 목록 상태를 새로 만들어 같은 결과가 된다.
                .onChange(of: country) { _, _ in scrollToTop(proxy) }
            }

            // 날씨 출처 — 목록 **아래 고정**. 원천과 가공해 쓴다는 사실은 기상법(출처 표시)과 気象庁 약관(공공데이터
            // 이용규약 — 가공 시 그 사실을 적는다)이 요구한다. 지역을 고르는 곳이 이 시트 하나라(설정·편집기 공용)
            // 여기 한 곳에만 둔다. 안드로이드 `WeatherLocationDialog` 의 `region_picker_weather_attribution` 과 같은 문장이다.
            // ⚠ **서버가 그 원천을 쓴다고 말할 때만 그린다**(`showsAttribution`). 문장을 늘 그리면 서버의 원천 교체가
            // 늦거나 되돌려진 동안 쓰지 않는 기관을 출처로 적는다(코덱스 #845).
            if showsAttribution {
                Text(String(localized: "날씨 정보: 기상청 · 気象庁 · 미국 기상청(NWS)의 예보를 바탕으로 AlarmTalk가 가공"))
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, BottomSheetTitle.horizontalPadding)
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { attributionHeight = $0 }
            }
        }
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        // 배경·모서리·드래그 핸들은 `BottomSheetHost` 가 그린다.
    }

    /// 시트를 열 때만: 고른 지역이 이 나라에 있으면 거기로, 아니면 맨 위로.
    private func scrollToCurrent(_ proxy: ScrollViewProxy) {
        guard let target = current.flatMap({ $0.country == country ? $0.key : nil }) else {
            scrollToTop(proxy)
            return
        }
        // 목록이 붙은 **다음** 프레임에 스크롤해야 목적지가 존재한다.
        DispatchQueue.main.async { proxy.scrollTo(target, anchor: .center) }
    }

    /// 애니메이션 없이 맨 위로 — 다른 나라 목록을 거슬러 올라가는 모습은 보이지 않게 한다.
    private func scrollToTop(_ proxy: ScrollViewProxy) {
        guard let first = WeatherRegions.byCountry(country).first?.key else { return }
        DispatchQueue.main.async { proxy.scrollTo(first, anchor: .top) }
    }

    @ViewBuilder
    private func row(_ region: WeatherRegion) -> some View {
        Button {
            onSelect(region)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: region.displayName(language: language))
                        .foregroundStyle(theme.palette.onSurface)
                    // 날씨를 재는 대표 도시가 지역 이름과 다를 때만(경기 → 수원, 아이치 → 나고야).
                    // 안드로이드 `region_picker_seat_description`("수원 날씨")과 같은 문장이다.
                    if let seat = region.seatDisplayName(language: language) {
                        Text(String(localized: "\(seat) 날씨"))
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                }
                Spacer(minLength: 0)
                if region.key == current?.key {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(theme.palette.primary)
                }
            }
            // 행 치수는 `SelectionSheet` 와 같다(패딩을 먼저, 그다음 최소 높이 56).
            .padding(.horizontal, BottomSheetTitle.horizontalPadding)
            .padding(.vertical, 10)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(region.key == current?.key ? .isSelected : [])
    }
}

/// 지역 시트의 날씨 출처 줄을 그릴지 — **서버가 원천을 말할 때만**.
///
/// 계약은 `GET /api/app/version` 의 `weather_attribution`(`AppVersionResponse.weatherAttribution` →
/// `AppVersionGate.weatherAttribution`), 백엔드 단일 출처는 `packages/backend/src/lib/weather-attribution.ts`.
/// 출처 문장은 서버가 **실제로 쓰는 원천**을 따라가야 한다 — 앱이 단정하면 서버의 원천 교체가 늦거나 되돌려진
/// 동안 쓰지 않는 기관을 출처로 적는다(코덱스 #845). 규칙 원문은 `docs/spec/voice-and-message.md`
/// 「지역 시트의 날씨 출처 줄 — 서버가 원천을 말할 때만」.
/// 안드로이드는 `showsWeatherAttribution`(`ui/editor/AlarmRandomPromptSettings.kt`)이 같은 판정이다.
enum WeatherAttribution {
    /// 서버의 날씨가 기상청(KR)·気象庁(JP)·NWS(US)의 예보에서 온다는 토큰.
    static let officialForecasts = "kma_jma_nws"

    /// 정확히 그 토큰일 때만 true. 그 밖 — 모르는 값·nil(필드 없는 옛 서버, 버전 확인 실패·응답 전) — 은 숨긴다.
    /// 불투명 토큰이라 대소문자·공백을 고쳐 읽지 않는다.
    static func showsLine(_ token: String?) -> Bool {
        token == officialForecasts
    }
}

#if DEBUG
#Preview("WeatherRegionPickerSheet") {
    WeatherRegionPickerSheet(current: WeatherRegions.byKey("jp-aichi"), onSelect: { _ in })
        .voiceAlarmPreviewEnvironment()
}
#endif
