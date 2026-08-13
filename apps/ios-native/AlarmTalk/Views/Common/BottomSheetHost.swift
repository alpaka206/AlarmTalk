import SwiftUI

/// 바텀시트 치수의 **단일 출처**.
enum BottomSheetMetrics {
    /// 높이 **상한**. `SheetScrollingContent` 의 **스크롤 갈래에만** 걸린다 — 짧은 시트는
    /// 자연 높이라 여기 닿지 않는다. 화면을 거의 덮되 뒤가 남아 '시트' 로 읽히는 값이다.
    ///
    /// ⚠ **시트마다 다른 값을 주지 말 것.** 2026-08-12 에 날씨 시트만 0.9 로 올렸다가
    /// 같은 종류의 시트끼리 높이가 달라졌다. 상한을 낮게 잡을 이유가 없다 —
    /// 낮추면 **긴 목록만 반쪽으로 잘린다.**
    static let maxFraction: CGFloat = 0.9
}
import UIKit

/// **화면 폭을 꽉 채우는 바텀시트** — 안드로이드 `ModalBottomSheet` 와 같은 모양이다.
///
/// ⚠ **시스템 `.sheet` 로 되돌리지 말 것.** iOS 26 의 기본 시트는 화면 가장자리에서 안쪽으로
/// 들어가 뜨고 **아래 모서리까지 둥글다**(떠 있는 카드). 안드로이드 바텀시트는 좌우를 꽉
/// 채우고 위 모서리만 둥글다 — 같은 화면이 두 앱에서 다르게 보인다
/// (2026-08-10 지적 "좌우에 여백이 있는데 여백 없는 게 맞지 않나").
/// `.presentationSizing(.page)` 로도 없어지지 않는다(시뮬레이터에서 확인) — iOS 26 시트의
/// 표현 자체라 끄는 공개 API 가 없다. 그래서 직접 그린다.
///
/// 규칙(안드로이드 `WakerSelectionSheet` 와 같다):
/// - 좌우 여백 0, **위 모서리만** 둥글다(`WakerSheetShape`).
/// - 위에 드래그 핸들(36×4, `onSurfaceVariant` 38%).
/// - 스크림 탭 또는 아래로 끌어 닫는다.
/// - 높이는 **내용만큼**. 화면의 50% 를 넘으면 그 안에서 스크롤한다.
///
/// ⚠ **부분 높이를 더해 시트 높이를 계산하지 말 것.** 왜 그러면 안 되는지는
/// `SheetContentHeight.swift` 주석 참조 — 22pt 가 모자라 3항목짜리 시트도 스크롤됐다.
struct BottomSheetHost<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let onDismiss: () -> Void
    /// 화면의 몇 %까지 차지할 수 있는가. 넘으면 안에서 스크롤한다.
    ///
    /// ⚠ **호출부마다 다른 값을 주지 말 것.** 2026-08-12 에 날씨 시트만 0.9 로 올렸다가
    /// 같은 종류의 시트끼리 높이가 달라졌다. 상한을 낮게 잡을 이유도 없다 —
    /// 짧은 시트는 어차피 자연 높이고, 낮추면 **긴 목록만 반쪽으로 잘린다.**
    var maxFraction: CGFloat = BottomSheetMetrics.maxFraction
    @ViewBuilder var content: () -> Content

    @State private var dragOffset: CGFloat = 0
    @State private var appeared = false

    var body: some View {
        ZStack(alignment: .bottom) {
            AlarmTalkTheme.scrim
                .ignoresSafeArea()
                .opacity(appeared ? 1 : 0)
                .onTapGesture { close() }

            VStack(spacing: 0) {
                handle
                content()
                // ⚠ **홈 인디케이터 영역만큼 시트 자신이 깔린다.** 이걸 빼면 시트 표면이
                // 화면 맨 아래에서 34pt 위에 끊기고 그 아래로 앱 배경(거의 검정)이 비쳐
                // **띠처럼 다른 색**이 보인다(2026-08-10 지적). 안드로이드도 시트가 끝까지
                // 깔리고 내용만 `navigationBarsPadding` 으로 비켜선다.
                Color.clear.frame(height: safeBottomInset)
            }
            .frame(maxWidth: .infinity)
            // ⚠ **여기에 `maxHeight` 상한을 걸지 말 것 — 그게 곧 시트 높이가 된다.**
            // `maxHeight` 는 자식에게 그 높이를 **제안**한다. 그런데 시트 안에는 `ScrollView`
            // 가 있고 스크롤뷰는 세로로 탐욕스러워서 제안받은 만큼 **다 먹는다.** 그러면
            // 프레임도 그 크기가 되어, 행이 셋뿐인 시트가 상한(90%)을 꽉 채운 채 위아래가
            // 텅 빈다(2026-08-13 실측 — 상한을 지우니 곧바로 붙었다).
            // 상한은 이제 `SheetScrollingContent` 안에서, **스크롤 갈래에만** 걸린다.
            .background(theme.palette.surface)
            // ⚠ **위 모서리만** 둥글다 — 아래까지 둥글리면 iOS 기본 시트처럼 떠 보인다.
            .clipShape(TopRoundedRectangle(radius: theme.shapes.extraLarge))
            .offset(y: max(dragOffset, 0) + (appeared ? 0 : 600))
            .gesture(
                DragGesture()
                    .onChanged { dragOffset = $0.translation.height }
                    .onEnded { value in
                        // 충분히 내렸거나 아래로 튕기면 닫는다.
                        if value.translation.height > 120 || value.predictedEndTranslation.height > 240 {
                            close()
                        } else {
                            withAnimation(.snappy(duration: 0.2)) { dragOffset = 0 }
                        }
                    }
            )
        }
        // ⚠ **ZStack 이 안전영역을 무시해야** 아래 정렬된 시트가 화면 진짜 바닥에 닿는다.
        // 시트에만 `.ignoresSafeArea` 를 걸면 정렬 기준은 여전히 안전영역이라 뜬다.
        .ignoresSafeArea()
        .onAppear {
            if reduceMotion { appeared = true }
            else { withAnimation(.snappy(duration: 0.28)) { appeared = true } }
        }
    }

    /// 홈 인디케이터 영역. 시트가 여기까지 깔리고, 내용은 그 위에서 끝난다.
    private var safeBottomInset: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow?.safeAreaInsets.bottom }
            .first ?? 0
    }


    private var handle: some View {
        // 안드로이드 `WakerSheetDragHandle`: 36×4, 위 12 · 아래 10.
        Capsule()
            .fill(theme.palette.onSurfaceVariant.opacity(0.38))
            .frame(width: 36, height: 4)
            .padding(.top, 12)
            .padding(.bottom, 10)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
    }

    private func close() {
        if reduceMotion {
            onDismiss()
            return
        }
        withAnimation(.snappy(duration: 0.22)) {
            appeared = false
            dragOffset = 600
        }
        // 애니메이션이 끝난 뒤 실제로 없앤다.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) { onDismiss() }
    }
}

/// 위 두 모서리만 둥근 사각형.
struct TopRoundedRectangle: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        Path(
            UIBezierPath(
                roundedRect: rect,
                byRoundingCorners: [.topLeft, .topRight],
                cornerRadii: CGSize(width: radius, height: radius)
            ).cgPath
        )
    }
}

extension View {
    /// 화면 폭을 꽉 채우는 바텀시트를 얹는다. 자세한 이유는 `BottomSheetHost` 주석 참조.
    ///
    /// ⚠ `.sheet` 가 아니라 `.fullScreenCover` 위에 직접 그린다 — 시스템 시트의 들여쓴
    /// 표현을 피하고 배경·모서리를 우리가 정하기 위해서다.
    /// - Parameter maxFraction: 높이 **상한**. 기본값을 그대로 쓰는 것이 정상이다 —
    ///   시트는 `SheetScrollingContent` 로 자기 자연 높이를 가지므로, 짧으면 알아서 작게 뜬다.
    ///   ⚠ **시트마다 다른 값을 주지 말 것**(`BottomSheetHost.maxFraction` 주석 참조).
    func bottomSheet<Content: View>(
        isPresented: Binding<Bool>,
        onDismiss: @escaping () -> Void,
        maxFraction: CGFloat = BottomSheetMetrics.maxFraction,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        fullScreenCover(isPresented: isPresented) {
            BottomSheetHost(onDismiss: onDismiss, maxFraction: maxFraction, content: content)
                .presentationBackground(.clear)
        }
        // ⚠ **커버 자체의 전환을 끈다.** `fullScreenCover` 는 내용을 통째로 아래에서
        // 밀어 올리는데, 스크림이 그 안에 있으니 **스크림까지 같이 밀려 올라온다** —
        // 실기 프레임에서 시트가 다 올라온 **뒤에야** 화면 위쪽이 어두워졌다
        // (2026-08-11 지적, 30fps 영상 f456~463 으로 확인). 배경은 제자리에서 서서히
        // 어두워지고 시트만 올라와야 한다. 전환을 끄면 `BottomSheetHost` 의
        // `appeared` 애니메이션(스크림 opacity + 시트 offset)이 그 일을 한다.
        .transaction { $0.disablesAnimations = true }
    }
}
