import XCTest
@testable import AlarmTalk

/// **바텀시트 치수가 시트마다 갈라지지 않게** 고정한다.
///
/// 2026-08-12 사용자 지적: "왜 할 때마다 너무 작든 너무 여백을 많이 주든 하는 거야."
/// 파 보니 원인이 둘이었다:
///  1. 높이 상한을 **호출부마다** 들고 있었다 — 날씨 시트만 0.9 로 올려서 같은 종류의
///     시트끼리 높이가 달라졌다.
///  2. 제목 블록을 세 시트가 **각자 손으로 베껴** 갖고 있었고, 셋 다 `.padding(.top, 4)`
///     였다. 그 값은 바로 위 주석이 "드래그 핸들과 붙어 제목이 잘려 보인다" 며 **금지한
///     값**이었다 — 주석은 18 을 쓰라고 했는데 코드는 4 였다.
final class BottomSheetMetricsTests: XCTestCase {

    /// 제목이 드래그 핸들에 닿지 않을 만큼은 떨어져 있어야 한다.
    ///
    /// 안드로이드 `WakerSelectionSheet` 는 핸들이 위 12 + 아래 10 을 갖고 그 뒤에 제목이
    /// 온다. 같은 간격이 되도록 18 이다. **4 로 되돌리면 제목이 잘려 보인다.**
    func testTitleTopPaddingClearsTheDragHandle() {
        XCTAssertEqual(BottomSheetTitle.topPadding, 18)
        XCTAssertGreaterThanOrEqual(
            BottomSheetTitle.topPadding, 12,
            "드래그 인디케이터 높이보다 작으면 제목이 핸들에 닿는다"
        )
    }

    /// 좌우 여백은 제목과 행 목록이 **같아야** 한다 — 다르면 제목만 들여쓰인 것처럼 보인다.
    func testHorizontalPaddingIsTheSharedValue() {
        XCTAssertEqual(BottomSheetTitle.horizontalPadding, 20)
    }

    /// 높이 상한은 **하나뿐**이다. 시트별로 다른 값을 주면 같은 종류의 시트끼리 높이가
    /// 달라진다 — 짧은 시트는 어차피 자연 높이라 상한에 닿지도 않으므로, 낮게 잡을 이유가 없다.
    func testHeightCapIsSingleSourced() {
        XCTAssertEqual(BottomSheetMetrics.maxFraction, 0.9)
        XCTAssertGreaterThan(
            BottomSheetMetrics.maxFraction, 0.5,
            "0.5 면 도시 목록처럼 긴 시트가 반쪽만 보이고 스크롤된다"
        )
        XCTAssertLessThan(
            BottomSheetMetrics.maxFraction, 1.0,
            "뒤 화면이 조금은 보여야 '시트' 로 읽힌다"
        )
    }
}
