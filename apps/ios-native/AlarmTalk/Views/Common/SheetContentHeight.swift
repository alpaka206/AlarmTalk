import SwiftUI

/// **바텀시트를 내용 높이에 맞추려고 재는 자.** 쓰는 쪽은 `BottomSheetHost` 다.
///
/// 안드로이드 `ModalBottomSheet` 는 내용만큼만 올라온다. iOS 기본 시트는 `.medium` 같은
/// 고정 detent 라 항목이 적으면 아래가 통째로 비고, 많으면 잘린다.
///
/// ⚠ **바깥 뷰를 재지 말 것 — 순환이 된다.** 시트 전체에 `GeometryReader` 를 붙이면
/// 그건 이미 시트 높이만큼 눌린 값이라, 그 값으로 다시 시트 높이를 정하면 처음 값에
/// 갇힌다(실제로 목록이 10개인데 7개만 보이는 채로 굳었다).
/// **스크롤 안의 내용**을 재야 한다 — `ScrollView` 안의 뷰는 눌리지 않은 자연 크기를 보고한다.
///
/// ⚠ **부분 높이를 더해서 시트 높이를 계산하지 말 것**(2026-08-11 "화면 테마 모달이 아직도
/// 작은가봐, 내부 요소가 스크롤 되어야 해"). 예전에는 `BottomSheetHost` 가
/// `내용 + 머리말 + 핸들 + 홈인디케이터` 를 **직접 더해** 높이를 정했는데, 그 식에는 시트가
/// 실제로 쓰는 여백이 빠져 있었다 — 제목과 목록 사이 `spacing: 14` 와 시트 아래
/// `padding(.bottom, 8)`. 딱 **22pt 가 모자라** 항목이 3개뿐인 테마 시트조차 안에서
/// 스크롤됐다. 여백은 레이아웃이 정하는 것이라 상수로 따라 적으면 반드시 어긋난다.
///
/// 지금 방식은 더하지 않는다:
/// - `ScrollView` 가 **자기 내용보다 커지지 않게** 묶는다(`sheetScrollFit`).
/// - 그러면 시트 전체가 자연 높이를 갖는다 — 여백·간격은 레이아웃이 알아서 넣는다.
/// - `BottomSheetHost` 는 거기에 **상한만** 씌운다(`maxHeight`). 내용이 짧으면 그대로 두고,
///   길면 그때 `ScrollView` 가 눌리며 스크롤이 생긴다.

/// 스크롤 **안** 내용의 자연 높이.
struct SheetContentHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

extension View {
    /// **스크롤 내용**에 붙여 자연 높이를 위로 보고한다. 짝은 `sheetScrollFit()` 이다.
    func measuredSheetContent() -> some View {
        background(
            GeometryReader { proxy in
                Color.clear.preference(key: SheetContentHeightKey.self, value: proxy.size.height)
            }
        )
    }

    /// **`ScrollView` 자신**에 붙인다 — 안의 내용보다 커지지 않게 한다.
    ///
    /// `ScrollView` 는 세로로 탐욕스러워서 주는 만큼 다 먹는다. 그대로 두면 항목이 3개여도
    /// 시트가 상한까지 늘어나 **아래가 텅 빈다.** 여기서 내용 높이로 묶어 두면 시트가
    /// 자연 높이를 갖고, 내용이 상한을 넘길 때만 눌려서 스크롤된다.
    func sheetScrollFit() -> some View {
        modifier(SheetScrollFit())
    }
}

private struct SheetScrollFit: ViewModifier {
    @State private var contentHeight: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .onPreferenceChange(SheetContentHeightKey.self) { contentHeight = $0 }
            // 아직 못 쟀으면(0) 묶지 않는다 — 0으로 묶으면 첫 프레임에 시트가 사라진다.
            .frame(maxHeight: contentHeight > 0 ? contentHeight : nil)
    }
}
