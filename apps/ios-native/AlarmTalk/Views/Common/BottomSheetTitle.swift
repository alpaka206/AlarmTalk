import SwiftUI

/// 바텀시트 맨 위의 제목 — **모든 바텀시트가 이걸 쓴다.**
///
/// ⚠ **제목을 직접 그리지 말 것.** 예전에는 `SelectionSheet`·`WeatherCityPickerSheet`·
/// `VoiceSelectionSheet` 셋이 같은 구성을 **각자 손으로 베껴** 갖고 있었고, 그중 하나만
/// 고쳐도 나머지가 남았다. 실제로 셋 다 `.padding(.top, 4)` 를 갖고 있었는데 — 바로 그
/// 값이 "드래그 핸들과 붙어 제목이 잘려 보인다" 며 **금지돼 있던 값**이다(2026-08-10 지적
/// "모달 위에 여백이 없어 잘리려고 한다"). 주석은 18 을 쓰라고 했지만 코드는 4 였다.
///
/// ⚠ **네비게이션 스택 + 인라인 타이틀로 바꾸지 말 것.** 안드로이드 `WakerSelectionSheet`
/// 는 드래그 핸들 아래에 좌측 정렬 `titleLarge`(22, Bold)를 두고 상단바가 없다. 네비게이션
/// 바를 두면 가운데 작은 제목 + 시트 배경 위 바 재질이 겹쳐 **같은 시트가 두 앱에서 전혀
/// 다르게** 보인다.
struct BottomSheetTitle: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let text: String

    /// 제목 위 여백. 시스템 드래그 인디케이터가 시트 맨 위에 그려지므로 그만큼 비켜선다.
    /// 안드로이드는 핸들이 위 12 + 아래 10 을 갖고 그 뒤에 제목이 온다 — 같은 간격이다.
    static let topPadding: CGFloat = 18
    /// 시트 안 좌우 여백. 행 목록도 같은 값을 쓴다.
    static let horizontalPadding: CGFloat = 20
    /// 제목과 그 아래 내용 사이. 시트 루트 `VStack` 의 spacing 으로 쓴다.
    static let titleToContentSpacing: CGFloat = 14

    var body: some View {
        Text(text)
            // 안드로이드 titleLarge = 22 Bold.
            .font(.system(size: 22, weight: .bold))
            .foregroundStyle(theme.palette.onSurface)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Self.horizontalPadding)
            .padding(.top, Self.topPadding)
    }
}
