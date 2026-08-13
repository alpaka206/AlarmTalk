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

/// **짧으면 그대로, 길면 스크롤.** 바텀시트 안 목록은 이걸로 감싼다.
///
/// ⚠ **높이를 재서 묶는 방식으로 되돌리지 말 것.** 예전에는 스크롤 안 내용의 높이를
/// `PreferenceKey` 로 위에 보고하고(`measuredSheetContent`) 그 값으로 `ScrollView` 를
/// 묶었다(`sheetScrollFit`). 그런데 **그 보고가 실제로 도착하지 않아** 묶을 값이 0 이었고,
/// `ScrollView` 는 세로로 탐욕스러워서 상한(90%)을 그대로 먹었다 — 행이 셋뿐인 시트가
/// 화면을 꽉 채운 채 위아래가 텅 비었다(2026-08-13 실기기·시뮬레이터 실측 57%).
/// 상한이 0.5 이던 시절에는 절반만 비어서 덜 눈에 띄었을 뿐 그때도 깨져 있었다.
///
/// `ViewThatFits` 는 **재지 않는다.** 제안된 높이에 첫 번째 후보가 들어가면 그걸 쓰고,
/// 안 들어가면 다음 후보로 넘어간다. 그래서 짧은 내용은 자연 높이로, 긴 내용은 스크롤로
/// 알아서 갈린다 — 우리가 숫자를 다룰 일이 없다.
struct SheetScrollingContent<Content: View>: View {
    @ViewBuilder var content: () -> Content

    /// 내용 영역 높이 상한. 시트 전체가 아니라 **여기**에 건다 —
    /// 시트 전체에 걸면 `ScrollView` 가 그 높이를 통째로 먹어 상한이 곧 시트 높이가 된다.
    /// 핸들·홈인디케이터 몫을 빼고 잡아, 시트 전체가 `BottomSheetMetrics.maxFraction` 언저리에
    /// 머물게 한다.
    private var maxContentHeight: CGFloat {
        UIScreen.main.bounds.height * BottomSheetMetrics.maxFraction - 80
    }

    var body: some View {
        ViewThatFits(in: .vertical) {
            // ① 그대로 넣어 본다 — 화면에 들어가면 시트가 내용만큼만 올라온다.
            //    ⚠ **여기에 `frame(maxHeight:)` 를 걸지 말 것.** 상한을 걸면 그 값이 곧
            //    높이가 되어(아래 ②와 같은 이유) 짧은 시트도 상한까지 늘어난다.
            content()
            // ② 안 들어가면 스크롤한다. 상한은 **이 갈래에만** 건다 — 스크롤뷰는 세로로
            //    탐욕스러워서 제안받은 만큼 다 먹으므로, 여기서 상한이 곧 높이가 된다.
            ScrollView { content() }
                .frame(maxHeight: maxContentHeight)
        }
    }
}
