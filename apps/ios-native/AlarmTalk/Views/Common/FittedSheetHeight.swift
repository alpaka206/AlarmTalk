import SwiftUI
import UIKit

/// **바텀시트를 내용 높이에 맞춘다.**
///
/// 안드로이드 `ModalBottomSheet` 는 내용만큼만 올라온다. iOS 는 `.medium` 같은 고정 detent 라
/// 항목이 적으면 아래가 통째로 비고(2026-08-10 "아래에 빈 공간"), 많으면 잘린다.
///
/// ⚠ **상수를 더해서 높이를 계산하지 말 것.** 구성요소 높이가 글꼴 설정·기기마다 달라
/// 맞출 수가 없다 — 상수로 맞추다가 항목 3개짜리는 90pt 남고 10개짜리는 마지막 행이 잘렸다.
///
/// ⚠ **바깥 뷰를 재지 말 것 — 순환이 된다.** 시트 전체에 `GeometryReader` 를 붙이면
/// 그건 이미 시트 높이만큼 눌린 값이라, 그 값으로 다시 시트 높이를 정하면 처음 값에
/// 갇힌다(실제로 목록이 10개인데 7개만 보이는 채로 굳었다).
/// **스크롤 안의 내용**을 재야 한다 — `ScrollView` 안의 뷰는 눌리지 않은 자연 크기를 보고한다.
/// 그래서 재는 쪽은 `.measuredSheetContent()`, 쓰는 쪽은 `.fittedSheetHeight()` 로 나눴다.
/// 스크롤 **밖**에 있는 머리말(제목 블록)의 높이.
///
/// ⚠ 이걸 빼먹으면 그만큼 시트가 짧아져 **마지막 행이 잘린다**(2026-08-10 "미국이 잘려서
/// 보여"). 제목은 스크롤과 함께 밀리면 안 되므로 `ScrollView` 밖에 있고, 그래서 내용
/// 높이에 자동으로 안 잡힌다 — 따로 재서 더한다.
struct SheetHeaderHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

struct SheetContentHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private struct FittedSheetHeight: ViewModifier {
    /// 화면의 몇 %까지 차지할 수 있는가. 넘으면 스크롤한다.
    var maxFraction: CGFloat

    /// 목록 밖 요소(드래그 핸들·제목·간격·아래 여백)의 높이. **실측값이다** —
    /// 시뮬레이터에서 시트 상단→첫 행 71pt, 아래 여백 8pt 를 재고, `.height()` 위에
    /// 시스템이 홈 인디케이터 영역을 따로 얹는 것을 반영해 잡았다.
    private let chrome: CGFloat = 43

    @State private var contentHeight: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .onPreferenceChange(SheetContentHeightKey.self) { contentHeight = $0 }
            .presentationDetents(detents)
            // ⚠ **좌우를 꽉 채운다.** iOS 26 기본 시트는 화면 가장자리에서 들어가 그려지는데,
            // 안드로이드 `ModalBottomSheet` 는 폭을 꽉 채운다(2026-08-10 지적).
            // `.page` 는 '가장자리까지 붙는 전통적 시트' 크기다.
            .presentationSizing(.page)
    }

    private var detents: Set<PresentationDetent> {
        let cap = UIScreen.main.bounds.height * maxFraction
        guard contentHeight > 0 else { return [.medium] }
        let wanted = contentHeight + chrome
        return wanted <= cap ? [.height(wanted)] : [.height(cap), .large]
    }
}

extension View {
    /// **스크롤 내용**에 붙여 자연 높이를 위로 보고한다(`fittedSheetHeight` 와 짝).
    /// 스크롤 **밖** 머리말(제목 블록)에 붙인다.
    func measuredSheetHeader() -> some View {
        background(
            GeometryReader { proxy in
                Color.clear.preference(key: SheetHeaderHeightKey.self, value: proxy.size.height)
            }
        )
    }

    func measuredSheetContent() -> some View {
        background(
            GeometryReader { proxy in
                Color.clear.preference(key: SheetContentHeightKey.self, value: proxy.size.height)
            }
        )
    }

    /// 내용 높이에 맞는 바텀시트로 띄운다. 자세한 이유는 `FittedSheetHeight` 주석 참조.
    func fittedSheetHeight(maxFraction: CGFloat = 0.85) -> some View {
        modifier(FittedSheetHeight(maxFraction: maxFraction))
    }
}
